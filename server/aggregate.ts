import {
  NO_PROJECT_KEY,
  type Collaboration,
  type CollaborationPair,
  type CollaborationTree,
  type GroupRow,
  type ModelRole,
  type Option,
  type StatsQuery,
  type StatsResult,
  type Totals,
  type TreeMember,
} from "../shared/stats.ts";
import { eventCost, type PriceBook } from "./pricing.ts";
import { eventTokens, type AgentMeta, type UsageEvent } from "./types.ts";

const TOP_TREES = 20;

export interface AggregateInput {
  events: readonly UsageEvent[];
  agents: Readonly<Record<string, AgentMeta>>;
  query: StatsQuery;
  prices: Pick<PriceBook, "resolve">;
  providerLabel: (provider: string) => string;
}

export type AggregateOutput = Omit<StatsResult, "generatedAt" | "coverage"> & {
  unpricedModels: string[];
};

function emptyTotals(): Totals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
    costUsd: 0,
    requests: 0,
    unpricedTokens: 0,
  };
}

function addEvent(totals: Totals, event: UsageEvent, cost: number | null) {
  const tokens = eventTokens(event);
  totals.input += event.input;
  totals.output += event.output;
  totals.cacheRead += event.cacheRead;
  totals.cacheWrite += event.cacheWrite;
  totals.total += tokens;
  totals.requests += 1;
  if (cost === null) totals.unpricedTokens += tokens;
  else totals.costUsd += cost;
}

interface Group {
  totals: Totals;
  agents: Set<string>;
  label: string;
  detail: Set<string>;
}

function bump(
  groups: Map<string, Group>,
  key: string,
  label: string,
  event: UsageEvent,
  cost: number | null,
  detail?: string,
) {
  let group = groups.get(key);
  if (!group) {
    group = {
      totals: emptyTotals(),
      agents: new Set(),
      label,
      detail: new Set(),
    };
    groups.set(key, group);
  }
  addEvent(group.totals, event, cost);
  group.agents.add(event.agentId);
  if (detail) group.detail.add(detail);
}

function byCost(a: Totals, b: Totals): number {
  return b.costUsd - a.costUsd || b.total - a.total;
}

function rows(groups: Map<string, Group>): GroupRow[] {
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      label: group.label,
      detail: group.detail.size > 0 ? [...group.detail].join(" · ") : null,
      agents: group.agents.size,
      ...group.totals,
    }))
    .sort(byCost);
}

function options(
  weights: Map<string, { label: string; tokens: number; hint: string | null }>,
): Option[] {
  return [...weights.entries()]
    .sort(
      (a, b) =>
        b[1].tokens - a[1].tokens || a[1].label.localeCompare(b[1].label),
    )
    .map(([value, { label, hint }]) => ({ value, label, hint }));
}

function weigh(
  weights: Map<string, { label: string; tokens: number; hint: string | null }>,
  key: string,
  label: string,
  tokens: number,
  hint: string | null = null,
) {
  const entry = weights.get(key);
  if (entry) entry.tokens += tokens;
  else weights.set(key, { label, tokens, hint });
}

export function projectKeyOf(agent: AgentMeta): string {
  return agent.projectKey ?? NO_PROJECT_KEY;
}

interface Spend {
  tokens: number;
  costUsd: number;
}

// An agent's spend on one model: its own requests, and those of the provider
// subagents (Codex threads, Claude subagents) it ran.
interface ModelUsage {
  own: Spend;
  native: Spend & { sessions: Set<string> };
}

interface AgentActivity {
  totals: Totals;
  models: Map<string, ModelUsage>;
  nativeSessions: Set<string>;
  first: number;
  last: number;
}

function addSpend(target: Spend, tokens: number, costUsd: number) {
  target.tokens += tokens;
  target.costUsd += costUsd;
}

// Pi-style providers configure "<provider>/<model>", but their logs name the
// bare model; strip the prefix so fallbacks and filters line up with usage.
export function configuredModel(agent: AgentMeta): string | null {
  const { provider, model } = agent;
  if (!model || (provider !== "pi" && provider !== "omp")) return model;
  const slash = model.indexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}

// The model doing most of the agent's own work in range, else its configured one.
export function primaryModel(
  entry: AgentActivity | undefined,
  fallback: string | null,
): string | null {
  let best: [string, ModelUsage] | null = null;
  for (const candidate of entry?.models ?? []) {
    const [, usage] = candidate;
    if (
      !best ||
      usage.own.tokens > best[1].own.tokens ||
      (usage.own.tokens === best[1].own.tokens &&
        usage.native.tokens > best[1].native.tokens)
    ) {
      best = candidate;
    }
  }
  return best?.[0] ?? fallback;
}

export function aggregate(input: AggregateInput): AggregateOutput {
  const { events, agents, query, prices, providerLabel } = input;
  const providerFilter = query.providers.length
    ? new Set(query.providers)
    : null;
  const modelFilter = query.models.length ? new Set(query.models) : null;
  const projectFilter = query.projects.length ? new Set(query.projects) : null;
  const agentPasses = (agent: AgentMeta) =>
    (!providerFilter || providerFilter.has(agent.provider)) &&
    (!projectFilter || projectFilter.has(projectKeyOf(agent)));

  const providerOptions = new Map<
    string,
    { label: string; tokens: number; hint: string | null }
  >();
  const modelOptions = new Map<
    string,
    { label: string; tokens: number; hint: string | null }
  >();
  const projectOptions = new Map<
    string,
    { label: string; tokens: number; hint: string | null }
  >();
  for (const agent of Object.values(agents)) {
    weigh(providerOptions, agent.provider, providerLabel(agent.provider), 0);
    weigh(
      projectOptions,
      projectKeyOf(agent),
      agent.projectName ?? "",
      0,
      agent.projectPath ?? null,
    );
  }

  const totals = emptyTotals();
  const byProvider = new Map<string, Group>();
  const byModel = new Map<string, Group>();
  const byProject = new Map<string, Group>();
  const activity = new Map<string, AgentActivity>();
  const native = { tokens: 0, cost: 0, sessions: new Set<string>() };
  const unpriced = new Set<string>();

  for (const event of events) {
    const agent = agents[event.agentId];
    if (!agent) continue;
    const tokens = eventTokens(event);
    weigh(
      providerOptions,
      agent.provider,
      providerLabel(agent.provider),
      tokens,
    );
    weigh(modelOptions, event.model, event.model, tokens);
    weigh(projectOptions, projectKeyOf(agent), agent.projectName ?? "", tokens);

    if (event.ts < query.from || event.ts > query.to) continue;
    if (!agentPasses(agent)) continue;
    if (modelFilter && !modelFilter.has(event.model)) continue;

    const price =
      event.reportedCost === null ? prices.resolve(event.model) : null;
    const cost =
      event.reportedCost ?? (price ? eventCost(event, price.price) : null);
    if (cost === null) unpriced.add(event.model);

    addEvent(totals, event, cost);
    const providerName = providerLabel(agent.provider);
    bump(byProvider, agent.provider, providerName, event, cost);
    bump(byModel, event.model, event.model, event, cost, providerName);
    bump(
      byProject,
      projectKeyOf(agent),
      agent.projectName ?? "",
      event,
      cost,
      agent.projectPath ?? undefined,
    );

    let entry = activity.get(agent.id);
    if (!entry) {
      entry = {
        totals: emptyTotals(),
        models: new Map(),
        nativeSessions: new Set(),
        first: event.ts,
        last: event.ts,
      };
      activity.set(agent.id, entry);
    }
    addEvent(entry.totals, event, cost);
    let usage = entry.models.get(event.model);
    if (!usage) {
      usage = {
        own: { tokens: 0, costUsd: 0 },
        native: { tokens: 0, costUsd: 0, sessions: new Set() },
      };
      entry.models.set(event.model, usage);
    }
    addSpend(event.native ? usage.native : usage.own, tokens, cost ?? 0);
    if (event.native) usage.native.sessions.add(event.session);
    entry.first = Math.min(entry.first, event.ts);
    entry.last = Math.max(entry.last, event.ts);
    if (event.native) {
      entry.nativeSessions.add(event.session);
      native.sessions.add(`${agent.id}:${event.session}`);
      native.tokens += tokens;
      native.cost += cost ?? 0;
    }
  }

  const participants = new Set(activity.keys());
  for (const agent of Object.values(agents)) {
    if (participants.has(agent.id) || agent.createdAt === null) continue;
    if (agent.createdAt < query.from || agent.createdAt > query.to) continue;
    if (!agentPasses(agent)) continue;
    const model = configuredModel(agent);
    if (modelFilter && !(model && modelFilter.has(model))) continue;
    participants.add(agent.id);
  }

  return {
    totals: { ...totals, agents: activity.size },
    byProvider: rows(byProvider),
    byModel: rows(byModel),
    byProject: rows(byProject),
    options: {
      providers: options(providerOptions),
      models: options(modelOptions),
      projects: options(projectOptions),
    },
    collaboration: collaborate(
      agents,
      participants,
      activity,
      native,
      providerLabel,
    ),
    unpricedModels: [...unpriced].sort(),
  };
}

function collaborate(
  agents: Readonly<Record<string, AgentMeta>>,
  participants: ReadonlySet<string>,
  activity: ReadonlyMap<string, AgentActivity>,
  native: { tokens: number; cost: number; sessions: Set<string> },
  providerLabel: (provider: string) => string,
): Collaboration {
  const parentOf = (id: string): string | null => {
    const parent = agents[id]?.parentId ?? null;
    return parent && agents[parent] ? parent : null;
  };
  const lineage = (id: string): string[] => {
    const chain = [id];
    const seen = new Set(chain);
    let parent = parentOf(id);
    while (parent && !seen.has(parent)) {
      chain.push(parent);
      seen.add(parent);
      parent = parentOf(parent);
    }
    return chain;
  };

  const trees = new Map<string, Set<string>>();
  const depthOf = new Map<string, number>();
  for (const id of participants) {
    const chain = lineage(id);
    const root = chain[chain.length - 1];
    depthOf.set(id, chain.length - 1);
    const members = trees.get(root) ?? new Set<string>();
    for (const member of chain) members.add(member);
    trees.set(root, members);
  }

  const mainModel = (id: string) =>
    primaryModel(activity.get(id), configuredModel(agents[id]));
  const fanout = new Map<string, number>();
  const providerPairs = new Map<string, CollaborationPair>();
  const modelPairs = new Map<string, CollaborationPair>();
  const roles = new Map<string, RoleTally>();
  let childAgents = 0;
  let childTokens = 0;
  let childCostUsd = 0;
  for (const id of participants) {
    if (!agents[id].parentId) continue;
    childAgents += 1;
    const totals = activity.get(id)?.totals;
    const spend = { tokens: totals?.total ?? 0, costUsd: totals?.costUsd ?? 0 };
    childTokens += spend.tokens;
    childCostUsd += spend.costUsd;
    const parent = parentOf(id);
    if (!parent) continue;
    const first = !fanout.has(parent);
    fanout.set(parent, (fanout.get(parent) ?? 0) + 1);
    countPair(
      providerPairs,
      providerLabel(agents[parent].provider),
      providerLabel(agents[id].provider),
      spend,
    );
    const parentModel = mainModel(parent);
    countPair(modelPairs, parentModel, mainModel(id), spend);
    if (parentModel) {
      const { delegated } = tally(roles, parentModel);
      delegated.orchestrators += first ? 1 : 0;
      delegated.children += 1;
      addSpend(delegated, spend.tokens, spend.costUsd);
    }
  }

  for (const [id, entry] of activity) {
    const agent = agents[id];
    const role = fanout.has(id)
      ? "orchestrator"
      : agent.parentId
        ? "child"
        : "solo";
    for (const [model, usage] of entry.models) {
      const row = tally(roles, model);
      row.providers.add(providerLabel(agent.provider));
      if (usage.own.tokens > 0) {
        addSpend(row[role], usage.own.tokens, usage.own.costUsd);
        row[role].agents.add(id);
      }
      for (const session of usage.native.sessions) {
        row.native.sessions.add(`${id}:${session}`);
      }
      addSpend(row.native, usage.native.tokens, usage.native.costUsd);
    }
  }

  const collaborative: CollaborationTree[] = [];
  for (const [root, members] of trees) {
    if (members.size < 2) continue;
    collaborative.push(
      describeTree(root, members, agents, activity, providerLabel),
    );
  }
  collaborative.sort((a, b) => b.costUsd - a.costUsd || b.tokens - a.tokens);

  const fanouts = [...fanout.values()];
  return {
    activeAgents: participants.size,
    trees: collaborative.length,
    orchestrators: fanouts.length,
    childAgents,
    maxDepth: Math.max(0, ...depthOf.values()),
    avgFanout: fanouts.length
      ? fanouts.reduce((a, b) => a + b, 0) / fanouts.length
      : 0,
    maxFanout: Math.max(0, ...fanouts),
    childTokens,
    childCostUsd,
    nativeSessions: native.sessions.size,
    nativeTokens: native.tokens,
    nativeCostUsd: native.cost,
    providerPairs: sortPairs(providerPairs),
    modelPairs: sortPairs(modelPairs),
    models: modelRoles(roles),
    topTrees: collaborative.slice(0, TOP_TREES),
  };
}

interface RoleTally {
  providers: Set<string>;
  orchestrator: Spend & { agents: Set<string> };
  child: Spend & { agents: Set<string> };
  solo: Spend & { agents: Set<string> };
  native: Spend & { sessions: Set<string> };
  delegated: Spend & { orchestrators: number; children: number };
}

function tally(roles: Map<string, RoleTally>, model: string): RoleTally {
  let row = roles.get(model);
  if (!row) {
    const role = () => ({ tokens: 0, costUsd: 0, agents: new Set<string>() });
    row = {
      providers: new Set(),
      orchestrator: role(),
      child: role(),
      solo: role(),
      native: { tokens: 0, costUsd: 0, sessions: new Set() },
      delegated: { tokens: 0, costUsd: 0, orchestrators: 0, children: 0 },
    };
    roles.set(model, row);
  }
  return row;
}

function modelRoles(roles: Map<string, RoleTally>): ModelRole[] {
  const counted = (role: Spend & { agents: Set<string> }) => ({
    tokens: role.tokens,
    costUsd: role.costUsd,
    agents: role.agents.size,
  });
  const collaborative = (row: ModelRole) =>
    row.orchestrator.costUsd + row.child.costUsd + row.native.costUsd;
  const collaborativeTokens = (row: ModelRole) =>
    row.orchestrator.tokens + row.child.tokens + row.native.tokens;
  return [...roles.entries()]
    .map(([model, row]) => ({
      model,
      providers: [...row.providers].sort(),
      orchestrator: counted(row.orchestrator),
      child: counted(row.child),
      solo: counted(row.solo),
      native: {
        tokens: row.native.tokens,
        costUsd: row.native.costUsd,
        sessions: row.native.sessions.size,
      },
      delegated: { ...row.delegated },
    }))
    .filter((row) => collaborativeTokens(row) > 0 || row.delegated.children > 0)
    .sort(
      (a, b) =>
        collaborative(b) - collaborative(a) ||
        collaborativeTokens(b) - collaborativeTokens(a),
    );
}

function countPair(
  pairs: Map<string, CollaborationPair>,
  parent: string | null,
  child: string | null,
  spend: Spend,
) {
  const key = `${parent ?? ""}\u0000${child ?? ""}`;
  let pair = pairs.get(key);
  if (!pair) {
    pair = { parent, child, count: 0, tokens: 0, costUsd: 0 };
    pairs.set(key, pair);
  }
  pair.count += 1;
  addSpend(pair, spend.tokens, spend.costUsd);
}

function sortPairs(pairs: Map<string, CollaborationPair>) {
  return [...pairs.values()].sort(
    (a, b) => b.count - a.count || b.costUsd - a.costUsd,
  );
}

function describeTree(
  root: string,
  members: ReadonlySet<string>,
  agents: Readonly<Record<string, AgentMeta>>,
  activity: ReadonlyMap<string, AgentActivity>,
  providerLabel: (provider: string) => string,
): CollaborationTree {
  const children = new Map<string, string[]>();
  for (const id of members) {
    const parent = agents[id].parentId;
    if (id === root || !parent || !members.has(parent)) continue;
    const siblings = children.get(parent) ?? [];
    siblings.push(id);
    children.set(parent, siblings);
  }
  const startOf = (id: string) =>
    activity.get(id)?.first ?? agents[id].createdAt ?? Number.MAX_SAFE_INTEGER;

  const ordered: TreeMember[] = [];
  const modelTokens = new Map<string, number>();
  const visit = (id: string, depth: number) => {
    const agent = agents[id];
    const entry = activity.get(id);
    for (const [model, usage] of entry?.models ?? []) {
      modelTokens.set(
        model,
        (modelTokens.get(model) ?? 0) + usage.own.tokens + usage.native.tokens,
      );
    }
    ordered.push({
      agentId: id,
      title: agent.title?.trim() || id.slice(0, 8),
      provider: providerLabel(agent.provider),
      model: primaryModel(entry, configuredModel(agent)),
      depth,
      tokens: entry?.totals.total ?? 0,
      costUsd: entry?.totals.costUsd ?? 0,
      nativeSessions: entry?.nativeSessions.size ?? 0,
    });
    const kids = [...(children.get(id) ?? [])].sort(
      (a, b) => startOf(a) - startOf(b),
    );
    for (const kid of kids) visit(kid, depth + 1);
  };
  visit(root, 0);

  const stamps = ordered.flatMap((member) => {
    const entry = activity.get(member.agentId);
    return entry ? [entry.first, entry.last] : [];
  });
  return {
    rootId: root,
    title: ordered[0].title,
    projectName: agents[root].projectName,
    agents: ordered.length,
    depth: Math.max(...ordered.map((member) => member.depth)),
    providers: [...new Set(ordered.map((member) => member.provider))],
    models: [
      ...new Set([
        ...[...modelTokens.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([model]) => model),
        // Members whose logs are gone still name their configured model.
        ...ordered.flatMap((member) => (member.model ? [member.model] : [])),
      ]),
    ],
    tokens: ordered.reduce((sum, member) => sum + member.tokens, 0),
    costUsd: ordered.reduce((sum, member) => sum + member.costUsd, 0),
    firstActiveAt: stamps.length ? Math.min(...stamps) : null,
    lastActiveAt: stamps.length ? Math.max(...stamps) : null,
    members: ordered,
  };
}
