/// <reference types="node" />
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PriceOverride } from "../shared/settings.ts";
import type { PricingStatus } from "../shared/stats.ts";
import type { UsageEvent } from "./types.ts";

export const LITELLM_PRICES_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20_000;

// USD per token.
export interface TokenPrice {
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  cacheWrite1h: number | null;
}

export type PriceTable = Record<string, TokenPrice>;

export interface ResolvedPrice {
  price: TokenPrice;
  source: string;
}

function rate(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

export function trimLiteLLM(raw: unknown): PriceTable {
  const table: PriceTable = {};
  if (raw === null || typeof raw !== "object") return table;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const input = rate(entry.input_cost_per_token);
    const output = rate(entry.output_cost_per_token);
    if (input === null && output === null) continue;
    table[key] = {
      input: input ?? 0,
      output: output ?? 0,
      cacheRead: rate(entry.cache_read_input_token_cost),
      cacheWrite: rate(entry.cache_creation_input_token_cost),
      cacheWrite1h: rate(entry.cache_creation_input_token_cost_above_1hr),
    };
  }
  return table;
}

const VENDORS: [RegExp, string[]][] = [
  [/^claude/, ["anthropic"]],
  [/^(gpt|o\d|codex|chatgpt)/, ["openai", "azure"]],
  [/^gemini/, ["gemini", "vertex_ai"]],
  [/^grok/, ["xai"]],
  [/^(kimi|moonshot)/, ["moonshot", "moonshotai"]],
  [/^glm/, ["zai", "zai-org", "zhipu"]],
  [/^deepseek/, ["deepseek", "deepseek-ai"]],
  [/^qwen/, ["dashscope", "qwen"]],
  [/^(minimax|abab)/, ["minimax"]],
];

// Relays rename models ("oai-glm-5.2", "fluxcode/kimi-k3"); try the names a
// public price list would use.
export function modelCandidates(model: string): string[] {
  const names: string[] = [];
  const add = (name: string) => {
    if (name && !names.includes(name)) names.push(name);
  };
  const base = model.trim().toLowerCase();
  add(base);
  const last = base.slice(base.lastIndexOf("/") + 1);
  add(last);
  add(last.replace(/^(oai|openai|anthropic|azure|aws|gcp)[-_]/, ""));
  for (const name of [...names]) {
    add(name.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, ""));
    add(name.replace(/-(free|latest|thinking)$/, ""));
  }
  return names;
}

function perToken(override: PriceOverride): TokenPrice {
  const scale = (value: number | null) => (value === null ? null : value / 1e6);
  return {
    input: override.input / 1e6,
    output: override.output / 1e6,
    cacheRead: scale(override.cacheRead),
    cacheWrite: scale(override.cacheWrite),
    cacheWrite1h: null,
  };
}

export class PriceBook {
  private readonly table: PriceTable;
  private readonly exact = new Map<string, string>();
  private readonly byName = new Map<string, string[]>();
  private readonly overrides = new Map<string, TokenPrice>();
  private readonly memo = new Map<string, ResolvedPrice | null>();

  constructor(table: PriceTable, overrides: readonly PriceOverride[] = []) {
    this.table = table;
    for (const [key, price] of Object.entries(table)) {
      const lower = key.toLowerCase();
      this.exact.set(lower, key);
      if (price.input === 0 && price.output === 0) continue;
      const name = lower.slice(lower.lastIndexOf("/") + 1);
      const keys = this.byName.get(name);
      if (keys) keys.push(key);
      else this.byName.set(name, [key]);
    }
    for (const override of overrides) {
      this.overrides.set(
        override.model.trim().toLowerCase(),
        perToken(override),
      );
    }
  }

  resolve(model: string): ResolvedPrice | null {
    if (this.memo.has(model)) return this.memo.get(model) ?? null;
    const resolved = this.lookup(model);
    this.memo.set(model, resolved);
    return resolved;
  }

  private lookup(model: string): ResolvedPrice | null {
    const candidates = modelCandidates(model);
    for (const name of candidates) {
      const price = this.overrides.get(name);
      if (price) return { price, source: "override" };
    }
    for (const name of candidates) {
      const exact = this.exact.get(name);
      if (exact) return { price: this.table[exact], source: exact };
      const keys = this.byName.get(name);
      if (!keys) continue;
      const key = this.pick(name, keys);
      return { price: this.table[key], source: key };
    }
    return null;
  }

  private pick(name: string, keys: string[]): string {
    const vendors = VENDORS.find(([pattern]) => pattern.test(name))?.[1] ?? [];
    for (const vendor of vendors) {
      const direct = keys.find(
        (key) => key.toLowerCase() === `${vendor}/${name}`,
      );
      if (direct) return direct;
    }
    for (const vendor of vendors) {
      const nested = keys.find((key) =>
        key.toLowerCase().split("/").slice(0, -1).includes(vendor),
      );
      if (nested) return nested;
    }
    return [...keys].sort(
      (a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b),
    )[0];
  }
}

export function eventCost(event: UsageEvent, price: TokenPrice): number {
  const cacheRead = price.cacheRead ?? price.input;
  const cacheWrite = price.cacheWrite ?? price.input;
  // Anthropic bills one-hour cache writes at twice the input rate.
  const cacheWrite1h =
    price.cacheWrite1h ??
    (price.cacheWrite !== null ? price.input * 2 : cacheWrite);
  return (
    event.input * price.input +
    event.output * price.output +
    event.cacheRead * cacheRead +
    (event.cacheWrite - event.cacheWrite1h) * cacheWrite +
    event.cacheWrite1h * cacheWrite1h
  );
}

interface CachedPrices {
  fetchedAt: number;
  table: PriceTable;
}

type Fetch = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

export class PricingSource {
  private table: PriceTable | null = null;
  private fetchedAt: number | null = null;
  private fetchedOnline = false;
  private error: string | null = null;
  private lastAttemptAt = 0;
  private cacheRead = false;
  private refreshing: Promise<void> | null = null;
  private readonly path: string;
  private readonly fetchImpl: Fetch;

  constructor(dir: string, fetchImpl: Fetch = fetch) {
    this.path = join(dir, "pricing.json");
    this.fetchImpl = fetchImpl;
  }

  async load(
    online: boolean,
    waitMs: number,
  ): Promise<{ table: PriceTable; status: PricingStatus }> {
    if (!this.cacheRead) await this.readCache();
    const stale =
      this.fetchedAt === null || Date.now() - this.fetchedAt > MAX_AGE_MS;
    const mayRetry = Date.now() - this.lastAttemptAt > RETRY_AFTER_MS;
    if (online && stale && mayRetry && !this.refreshing) {
      this.refreshing = this.refresh().finally(() => {
        this.refreshing = null;
      });
    }
    if (this.refreshing && this.table === null) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.refreshing,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, waitMs);
        }),
      ]);
      clearTimeout(timer);
    }
    const source: PricingStatus["source"] = !online
      ? "disabled"
      : this.table === null
        ? "none"
        : this.fetchedOnline
          ? "online"
          : "cache";
    return {
      table: this.table ?? {},
      status: { source, updatedAt: this.fetchedAt, error: this.error },
    };
  }

  private async readCache(): Promise<void> {
    this.cacheRead = true;
    try {
      const cached = JSON.parse(
        await readFile(this.path, "utf8"),
      ) as CachedPrices;
      this.table = cached.table;
      this.fetchedAt = cached.fetchedAt;
    } catch {
      // No cache yet.
    }
  }

  private async refresh(): Promise<void> {
    this.lastAttemptAt = Date.now();
    try {
      const table = await withTimeout(
        this.fetchImpl(LITELLM_PRICES_URL).then(async (response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return trimLiteLLM(await response.json());
        }),
        FETCH_TIMEOUT_MS,
      );
      if (Object.keys(table).length === 0) throw new Error("empty price list");
      this.table = table;
      this.fetchedAt = Date.now();
      this.fetchedOnline = true;
      this.error = null;
      const temp = `${this.path}.${process.pid}.tmp`;
      await writeFile(
        temp,
        JSON.stringify({ fetchedAt: this.fetchedAt, table }),
      );
      await rename(temp, this.path);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }
}
