/// <reference types="node" />
import { stat } from "node:fs/promises";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { readAppendedLines } from "./jsonl.ts";
import { PARSERS, type ParserState } from "./parsers.ts";
import {
  SUPPORTED_PROVIDERS,
  type LogProvider,
  type LogRoots,
} from "./paths.ts";
import { buildSessionIndex, type SessionFile } from "./sessions.ts";
import type { UsageStore } from "./store.ts";
import type { AgentMeta, UsageEvent } from "./types.ts";

type Paseo = PluginHandlerContext["paseo"];
type AgentEntry = Awaited<
  ReturnType<Paseo["agents"]["list"]>
>["entries"][number];

const PARENT_LABEL = "paseo.parent-agent-id";

export interface MissingLogs {
  provider: string;
  reason: "unsupported" | "not_found";
  count: number;
}

export interface CoverageSnapshot {
  agents: number;
  agentsWithLogs: number;
  missing: MissingLogs[];
}

export function toAgentMeta({ agent, project }: AgentEntry): AgentMeta {
  const createdAt = Date.parse(agent.createdAt);
  return {
    id: agent.id,
    provider: agent.provider,
    title: agent.title,
    cwd: agent.cwd,
    projectKey: project?.projectKey ?? null,
    projectName: project?.projectName ?? null,
    projectPath: project
      ? (project.checkout.mainRepoRoot ??
        project.checkout.worktreeRoot ??
        project.checkout.cwd)
      : null,
    parentId: agent.labels?.[PARENT_LABEL] ?? null,
    createdAt: Number.isFinite(createdAt) ? createdAt : null,
    model: agent.model,
    sessionId: agent.persistence?.sessionId ?? null,
  };
}

async function listAgents(paseo: Paseo): Promise<AgentMeta[]> {
  const agents: AgentMeta[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({
      filter: {
        includeArchived: true,
        includeInternal: true,
        includeBackground: true,
      },
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    for (const entry of page.entries) agents.push(toAgentMeta(entry));
    cursor = page.pageInfo.hasMore
      ? (page.pageInfo.nextCursor ?? undefined)
      : undefined;
  } while (cursor);
  return agents;
}

function isLogProvider(provider: string): provider is LogProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(provider);
}

function mergeMax(target: UsageEvent, next: UsageEvent): void {
  target.input = Math.max(target.input, next.input);
  target.output = Math.max(target.output, next.output);
  target.cacheRead = Math.max(target.cacheRead, next.cacheRead);
  target.cacheWrite = Math.max(target.cacheWrite, next.cacheWrite);
  target.cacheWrite1h = Math.max(target.cacheWrite1h, next.cacheWrite1h);
}

export class Collector {
  lastSyncAt: number | null;
  lastError: string | null = null;
  coverage: CoverageSnapshot = { agents: 0, agentsWithLogs: 0, missing: [] };
  private running: Promise<void> | null = null;
  private labelsLoaded = false;
  private readonly store: UsageStore;
  private readonly roots: LogRoots;

  constructor(store: UsageStore, roots: LogRoots) {
    this.store = store;
    this.roots = roots;
    this.lastSyncAt = store.state.lastSyncAt;
  }

  get syncing(): boolean {
    return this.running !== null;
  }

  sync(paseo: Paseo): Promise<void> {
    if (!this.running) {
      this.running = this.run(paseo)
        .then(() => {
          this.lastError = null;
        })
        .catch((error: unknown) => {
          this.lastError =
            error instanceof Error ? error.message : String(error);
          console.error("[paseo-stats] sync failed", error);
        })
        .finally(() => {
          this.running = null;
        });
    }
    return this.running;
  }

  // Waits for a fresh sync up to `waitMs`; a slow first sync keeps running and
  // the caller reports partial data until it lands.
  async ensureFresh(paseo: Paseo, maxAgeMs: number, waitMs: number) {
    if (!this.labelsLoaded) await this.refreshProviderLabels(paseo);
    const stale =
      this.lastSyncAt === null || Date.now() - this.lastSyncAt > maxAgeMs;
    const pending = stale || this.running ? this.sync(paseo) : null;
    if (!pending) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      pending,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, waitMs);
      }),
    ]);
    clearTimeout(timer);
  }

  private async run(paseo: Paseo): Promise<void> {
    const { state } = this.store;
    const [agents] = await Promise.all([
      listAgents(paseo),
      this.refreshProviderLabels(paseo),
    ]);
    for (const agent of agents) state.agents[agent.id] = agent;

    const index = await buildSessionIndex(this.roots, state.codexThreads);
    const targets: {
      agentId: string;
      provider: LogProvider;
      file: SessionFile;
    }[] = [];
    const missing = new Map<string, MissingLogs>();
    const withoutFiles = new Set<string>();
    let expected = 0;
    let found = 0;
    for (const agent of Object.values(state.agents)) {
      if (!agent.sessionId) continue;
      expected += 1;
      if (!isLogProvider(agent.provider)) {
        const key = `unsupported:${agent.provider}`;
        const entry = missing.get(key) ?? {
          provider: agent.provider,
          reason: "unsupported" as const,
          count: 0,
        };
        entry.count += 1;
        missing.set(key, entry);
        continue;
      }
      const files = index.find(agent.provider, agent.sessionId);
      if (files.length === 0) {
        withoutFiles.add(agent.id);
        continue;
      }
      found += 1;
      for (const file of files) {
        targets.push({ agentId: agent.id, provider: agent.provider, file });
      }
    }
    const recorded = this.store.hasEventsFor(withoutFiles);
    for (const agentId of withoutFiles) {
      if (recorded.has(agentId)) {
        found += 1;
        continue;
      }
      const provider = state.agents[agentId].provider;
      const key = `not_found:${provider}`;
      const entry = missing.get(key) ?? {
        provider,
        reason: "not_found" as const,
        count: 0,
      };
      entry.count += 1;
      missing.set(key, entry);
    }

    for (const target of targets) {
      await this.ingest(target.agentId, target.provider, target.file);
    }

    this.coverage = {
      agents: expected,
      agentsWithLogs: found,
      missing: [...missing.values()].sort((a, b) => b.count - a.count),
    };
    this.lastSyncAt = Date.now();
    state.lastSyncAt = this.lastSyncAt;
    await this.store.saveState();
  }

  private async ingest(
    agentId: string,
    provider: LogProvider,
    file: SessionFile,
  ) {
    const { state } = this.store;
    const cursor = state.files[file.path];
    let info;
    try {
      info = await stat(file.path);
    } catch {
      return;
    }
    if (
      cursor &&
      cursor.size === info.size &&
      cursor.mtimeMs === info.mtimeMs
    ) {
      return;
    }
    const restart = !cursor || info.size < cursor.offset;
    const parserState: ParserState = {
      session: file.session,
      native: file.native,
      carry: restart ? {} : { ...cursor.carry },
    };
    const parser = PARSERS[provider];
    const batch = new Map<string, UsageEvent>();
    const result = await readAppendedLines(
      file.path,
      restart ? 0 : cursor.offset,
      parser.needles,
      (line) => {
        const parsed = parser.parse(line, parserState);
        if (!parsed) return;
        const event = { ...parsed, agentId };
        const existing = batch.get(event.key);
        if (existing) mergeMax(existing, event);
        else batch.set(event.key, event);
      },
    );
    await this.store.append([...batch.values()]);
    state.files[file.path] = {
      offset: result.offset,
      size: result.size,
      mtimeMs: result.mtimeMs,
      carry: parserState.carry,
    };
  }

  private async refreshProviderLabels(paseo: Paseo): Promise<void> {
    try {
      const snapshot = await paseo.providers.snapshot();
      for (const entry of snapshot.entries) {
        if (entry.label) {
          this.store.state.providerLabels[entry.provider] = entry.label;
        }
      }
      this.labelsLoaded = true;
    } catch {
      // Labels are cosmetic; ids still identify providers.
    }
  }
}
