/// <reference types="node" />
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { ParserCarry } from "./parsers.ts";
import type { CodexThreadMeta } from "./sessions.ts";
import type { AgentMeta, UsageEvent } from "./types.ts";

export interface FileCursor {
  offset: number;
  size: number;
  mtimeMs: number;
  carry: ParserCarry;
}

export interface LedgerState {
  version: 1;
  files: Record<string, FileCursor>;
  agents: Record<string, AgentMeta>;
  codexThreads: Record<string, CodexThreadMeta>;
  providerLabels: Record<string, string>;
  lastSyncAt: number | null;
}

interface StoredEvent {
  k: string;
  t: number;
  a: string;
  m: string;
  i: number;
  o: number;
  r: number;
  w: number;
  h?: number;
  c?: number;
  s: string;
  n?: 1;
}

function toStored(event: UsageEvent): StoredEvent {
  return {
    k: event.key,
    t: event.ts,
    a: event.agentId,
    m: event.model,
    i: event.input,
    o: event.output,
    r: event.cacheRead,
    w: event.cacheWrite,
    ...(event.cacheWrite1h > 0 ? { h: event.cacheWrite1h } : {}),
    ...(event.reportedCost !== null ? { c: event.reportedCost } : {}),
    s: event.session,
    ...(event.native ? { n: 1 as const } : {}),
  };
}

function fromStored(stored: StoredEvent): UsageEvent {
  return {
    key: stored.k,
    ts: stored.t,
    agentId: stored.a,
    model: stored.m,
    input: stored.i,
    output: stored.o,
    cacheRead: stored.r,
    cacheWrite: stored.w,
    cacheWrite1h: stored.h ?? 0,
    reportedCost: stored.c ?? null,
    session: stored.s,
    native: stored.n === 1,
  };
}

function emptyState(): LedgerState {
  return {
    version: 1,
    files: {},
    agents: {},
    codexThreads: {},
    providerLabels: {},
    lastSyncAt: null,
  };
}

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export class UsageStore {
  readonly dir: string;
  readonly events: UsageEvent[] = [];
  state: LedgerState = emptyState();
  private readonly keys = new Set<string>();

  private constructor(dir: string) {
    this.dir = dir;
  }

  static async open(dir: string): Promise<UsageStore> {
    const store = new UsageStore(dir);
    await mkdir(dir, { recursive: true });
    const state = await readOptional(join(dir, "state.json"));
    if (state) {
      const parsed = JSON.parse(state) as LedgerState;
      if (parsed.version === 1) store.state = { ...emptyState(), ...parsed };
    }
    const events = await readOptional(join(dir, "events.jsonl"));
    if (events && !events.endsWith("\n")) {
      await appendFile(join(dir, "events.jsonl"), "\n");
    }
    for (const line of events?.split("\n") ?? []) {
      if (!line) continue;
      try {
        store.remember(fromStored(JSON.parse(line) as StoredEvent));
      } catch {
        // A crash can leave one torn line at the end; the rest stays usable.
      }
    }
    return store;
  }

  private remember(event: UsageEvent): boolean {
    if (this.keys.has(event.key)) return false;
    this.keys.add(event.key);
    this.events.push(event);
    return true;
  }

  async append(events: readonly UsageEvent[]): Promise<number> {
    const fresh = events.filter((event) => this.remember(event));
    if (fresh.length === 0) return 0;
    const lines = fresh.map((event) => JSON.stringify(toStored(event)));
    await appendFile(join(this.dir, "events.jsonl"), lines.join("\n") + "\n");
    return fresh.length;
  }

  hasEventsFor(agentIds: ReadonlySet<string>): Set<string> {
    const found = new Set<string>();
    for (const event of this.events) {
      if (agentIds.has(event.agentId)) found.add(event.agentId);
    }
    return found;
  }

  async saveState(): Promise<void> {
    const path = join(this.dir, "state.json");
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(this.state));
    await rename(temp, path);
  }
}
