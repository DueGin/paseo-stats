import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const totalsShape = {
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  total: z.number(),
  costUsd: z.number(),
  requests: z.number(),
  unpricedTokens: z.number(),
};

export const TotalsSchema = z.object(totalsShape);
export type Totals = z.infer<typeof TotalsSchema>;

export const GroupRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  detail: z.string().nullable(),
  agents: z.number(),
  ...totalsShape,
});
export type GroupRow = z.infer<typeof GroupRowSchema>;

export const OptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  hint: z.string().nullable(),
});
export type Option = z.infer<typeof OptionSchema>;

export const TreeMemberSchema = z.object({
  agentId: z.string(),
  title: z.string(),
  provider: z.string(),
  model: z.string().nullable(),
  depth: z.number(),
  tokens: z.number(),
  costUsd: z.number(),
  nativeSessions: z.number(),
});
export type TreeMember = z.infer<typeof TreeMemberSchema>;

export const CollaborationTreeSchema = z.object({
  rootId: z.string(),
  title: z.string(),
  projectName: z.string().nullable(),
  agents: z.number(),
  depth: z.number(),
  providers: z.array(z.string()),
  models: z.array(z.string()),
  tokens: z.number(),
  costUsd: z.number(),
  firstActiveAt: z.number().nullable(),
  lastActiveAt: z.number().nullable(),
  members: z.array(TreeMemberSchema),
});
export type CollaborationTree = z.infer<typeof CollaborationTreeSchema>;

const SpendSchema = z.object({ tokens: z.number(), costUsd: z.number() });

// A null model means the agent has no usage in range and no configured model.
export const CollaborationPairSchema = SpendSchema.extend({
  parent: z.string().nullable(),
  child: z.string().nullable(),
  count: z.number(),
});
export type CollaborationPair = z.infer<typeof CollaborationPairSchema>;

// Usage of one model split by the role of the agent that spent it. Agents
// with children are orchestrators; native covers provider subagents.
export const ModelRoleSchema = z.object({
  model: z.string(),
  providers: z.array(z.string()),
  orchestrator: SpendSchema.extend({ agents: z.number() }),
  child: SpendSchema.extend({ agents: z.number() }),
  native: SpendSchema.extend({ sessions: z.number() }),
  solo: SpendSchema.extend({ agents: z.number() }),
  // Children launched by orchestrators whose main model is this one.
  delegated: SpendSchema.extend({
    orchestrators: z.number(),
    children: z.number(),
  }),
});
export type ModelRole = z.infer<typeof ModelRoleSchema>;

export const CollaborationSchema = z.object({
  activeAgents: z.number(),
  trees: z.number(),
  orchestrators: z.number(),
  childAgents: z.number(),
  maxDepth: z.number(),
  avgFanout: z.number(),
  maxFanout: z.number(),
  childTokens: z.number(),
  childCostUsd: z.number(),
  nativeSessions: z.number(),
  nativeTokens: z.number(),
  nativeCostUsd: z.number(),
  providerPairs: z.array(CollaborationPairSchema),
  modelPairs: z.array(CollaborationPairSchema),
  models: z.array(ModelRoleSchema),
  topTrees: z.array(CollaborationTreeSchema),
});
export type Collaboration = z.infer<typeof CollaborationSchema>;

export const PricingStatusSchema = z.object({
  source: z.enum(["online", "cache", "none", "disabled"]),
  updatedAt: z.number().nullable(),
  error: z.string().nullable(),
});
export type PricingStatus = z.infer<typeof PricingStatusSchema>;

export const CoverageSchema = z.object({
  agents: z.number(),
  agentsWithLogs: z.number(),
  missing: z.array(
    z.object({
      provider: z.string(),
      reason: z.enum(["unsupported", "not_found"]),
      count: z.number(),
    }),
  ),
  unpricedModels: z.array(z.string()),
  pricing: PricingStatusSchema,
  lastSyncAt: z.number().nullable(),
  syncing: z.boolean(),
  syncError: z.string().nullable(),
  events: z.number(),
  dataDir: z.string(),
});
export type Coverage = z.infer<typeof CoverageSchema>;

export const StatsQuerySchema = z.object({
  from: z.number(),
  to: z.number(),
  providers: z.array(z.string()),
  models: z.array(z.string()),
  projects: z.array(z.string()),
  refresh: z.boolean().optional(),
});
export type StatsQuery = z.infer<typeof StatsQuerySchema>;

export const StatsResultSchema = z.object({
  generatedAt: z.number(),
  totals: TotalsSchema.extend({ agents: z.number() }),
  byProvider: z.array(GroupRowSchema),
  byModel: z.array(GroupRowSchema),
  byProject: z.array(GroupRowSchema),
  options: z.object({
    providers: z.array(OptionSchema),
    models: z.array(OptionSchema),
    projects: z.array(OptionSchema),
  }),
  collaboration: CollaborationSchema,
  coverage: CoverageSchema,
});
export type StatsResult = z.infer<typeof StatsResultSchema>;

export const statsQueryRpc = defineRpc({
  name: "stats.query",
  input: StatsQuerySchema,
  output: StatsResultSchema,
});

export const NO_PROJECT_KEY = "__none__";
