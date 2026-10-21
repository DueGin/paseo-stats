/// <reference types="node" />
import type {
  PluginHandlerContext,
  PluginSettings,
} from "@getpaseo/plugin/server";
import { statsSettings, type PriceOverride } from "../shared/settings.ts";
import type { StatsQuery, StatsResult } from "../shared/stats.ts";
import { aggregate } from "./aggregate.ts";
import { Collector } from "./collector.ts";
import { resolveDataDir, resolveLogRoots, type LogRoots } from "./paths.ts";
import { PriceBook, PricingSource, type PriceTable } from "./pricing.ts";
import { UsageStore } from "./store.ts";
import { Updater } from "./updater.ts";

type Paseo = PluginHandlerContext["paseo"];
type Settings = PluginSettings<typeof statsSettings.schema>;

const SYNC_MAX_AGE_MS = 30_000;
const QUERY_WAIT_MS = 6_000;
const PRICING_WAIT_MS = 8_000;
const TURN_SYNC_DELAY_MS = 5_000;
const BACKGROUND_SYNC_MS = 10 * 60_000;
const AUTO_UPDATE_DELAY_MS = 2 * 60_000;
const AUTO_UPDATE_MS = 6 * 60 * 60_000;

export class StatsService {
  private readonly settings: Settings;
  private readonly ready: Promise<{ store: UsageStore; collector: Collector }>;
  private readonly pricing: PricingSource;
  private readonly dataDir: string;
  private paseo: Paseo | null = null;
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly interval: ReturnType<typeof setInterval>;
  private readonly updateTimers: ReturnType<typeof setTimeout>[];
  readonly updater: Updater;
  private book: {
    table: PriceTable;
    overrides: string;
    book: PriceBook;
  } | null = null;

  constructor(
    settings: Settings,
    dataDir: string = resolveDataDir(),
    roots: LogRoots = resolveLogRoots(),
  ) {
    this.settings = settings;
    this.dataDir = dataDir;
    this.ready = UsageStore.open(dataDir).then((store) => ({
      store,
      collector: new Collector(store, roots),
    }));
    this.pricing = new PricingSource(dataDir);
    // Provider logs can be pruned; collecting in the background keeps the ledger
    // complete even when nobody opens the screen.
    this.interval = setInterval(() => {
      if (this.paseo) void this.syncNow(this.paseo);
    }, BACKGROUND_SYNC_MS);
    this.updater = new Updater(dataDir);
    this.updateTimers = [
      setTimeout(() => void this.autoUpdate(), AUTO_UPDATE_DELAY_MS),
      setInterval(() => void this.autoUpdate(), AUTO_UPDATE_MS),
    ];
  }

  private async autoUpdate(): Promise<void> {
    try {
      if (!(await this.readSettings()).autoUpdate) return;
      const status = await this.updater.check(true);
      if (status.updateAvailable && !status.blocked && status.latestTag) {
        await this.updater.apply(status.latestTag);
      }
    } catch (error) {
      console.error("[paseo-stats] auto update failed", error);
    }
  }

  scheduleSync(paseo: Paseo): void {
    this.paseo = paseo;
    if (this.turnTimer) return;
    this.turnTimer = setTimeout(() => {
      this.turnTimer = null;
      void this.syncNow(paseo);
    }, TURN_SYNC_DELAY_MS);
  }

  private async syncNow(paseo: Paseo): Promise<void> {
    const { collector } = await this.ready;
    await collector.sync(paseo);
  }

  private async readSettings() {
    const state = await this.settings.read();
    return state.status === "ready"
      ? state.values
      : statsSettings.schema.parse({});
  }

  private priceBook(table: PriceTable, overrides: readonly PriceOverride[]) {
    const key = JSON.stringify(overrides);
    if (this.book?.table !== table || this.book.overrides !== key) {
      this.book = {
        table,
        overrides: key,
        book: new PriceBook(table, overrides),
      };
    }
    return this.book.book;
  }

  async query(query: StatsQuery, paseo: Paseo): Promise<StatsResult> {
    this.paseo = paseo;
    const { store, collector } = await this.ready;
    const settings = await this.readSettings();
    const [, pricing] = await Promise.all([
      collector.ensureFresh(
        paseo,
        query.refresh ? 0 : SYNC_MAX_AGE_MS,
        QUERY_WAIT_MS,
      ),
      this.pricing.load(settings.onlinePricing, PRICING_WAIT_MS),
    ]);
    const { unpricedModels, ...result } = aggregate({
      events: store.events,
      agents: store.state.agents,
      query,
      prices: this.priceBook(pricing.table, settings.priceOverrides),
      providerLabel: (id) => store.state.providerLabels[id] ?? id,
    });
    return {
      generatedAt: Date.now(),
      ...result,
      coverage: {
        ...collector.coverage,
        unpricedModels,
        pricing: pricing.status,
        lastSyncAt: collector.lastSyncAt,
        syncing: collector.syncing,
        syncError: collector.lastError,
        events: store.events.length,
        dataDir: this.dataDir,
      },
    };
  }

  dispose(): void {
    clearInterval(this.interval);
    for (const timer of this.updateTimers) clearTimeout(timer);
    if (this.turnTimer) clearTimeout(this.turnTimer);
  }
}
