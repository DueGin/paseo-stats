import test from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../server/aggregate.ts";
import { NO_PROJECT_KEY } from "../shared/stats.ts";

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

function agent(id, provider, extra = {}) {
  return {
    id,
    provider,
    title: id,
    cwd: "/repo/a",
    projectKey: "prj_a",
    projectName: "alpha",
    projectPath: "/repo/a",
    parentId: null,
    createdAt: NOW - 10 * HOUR,
    model: null,
    sessionId: id,
    ...extra,
  };
}

const agents = Object.fromEntries(
  [
    agent("root", "claude"),
    agent("child1", "codex", { parentId: "root" }),
    agent("grand", "pi", { parentId: "child1" }),
    agent("child2", "pi", { parentId: "root" }),
    agent("solo", "codex", {
      projectKey: "prj_b",
      projectName: "beta",
      projectPath: "/repo/b",
    }),
    agent("loose", "pi", {
      projectKey: null,
      projectName: null,
      projectPath: null,
    }),
  ].map((a) => [a.id, a]),
);

let seq = 0;
function event(agentId, model, ts, extra = {}) {
  return {
    key: `k${seq++}`,
    ts,
    agentId,
    model,
    input: 100,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
    cacheWrite1h: 0,
    reportedCost: null,
    session: agentId,
    native: false,
    ...extra,
  };
}

const events = [
  event("root", "claude-opus-5-5", NOW - 2 * HOUR),
  event("root", "claude-opus-5-5", NOW - 48 * HOUR),
  event("child1", "gpt-6.1-sol", NOW - 3 * HOUR),
  event("child1", "gpt-6.1-sol", NOW - 3 * HOUR, {
    native: true,
    session: "sub-1",
  }),
  event("grand", "kimi-k3", NOW - 4 * HOUR, { reportedCost: 0.5 }),
  event("child2", "mystery", NOW - 1 * HOUR),
  event("solo", "gpt-6.1-sol", NOW - 1 * HOUR),
  event("loose", "kimi-k3", NOW - 1 * HOUR),
];

const prices = {
  resolve: (model) =>
    model === "mystery"
      ? null
      : {
          source: model,
          price: {
            input: 1e-3,
            output: 1e-3,
            cacheRead: null,
            cacheWrite: null,
            cacheWrite1h: null,
          },
        },
};

const labels = { claude: "Claude", codex: "Codex", pi: "Pi" };

function run(query = {}) {
  return aggregate({
    events,
    agents,
    prices,
    providerLabel: (id) => labels[id] ?? id,
    query: {
      from: NOW - 24 * HOUR,
      to: NOW,
      providers: [],
      models: [],
      projects: [],
      ...query,
    },
  });
}

test("totals cover the range and separate unpriced tokens", () => {
  const result = run();
  assert.equal(result.totals.requests, 7);
  assert.equal(result.totals.total, 7 * 110);
  assert.equal(result.totals.unpricedTokens, 110);
  assert.ok(Math.abs(result.totals.costUsd - (5 * 0.11 + 0.5)) < 1e-9);
  assert.equal(result.totals.agents, 6);
  assert.deepEqual(result.unpricedModels, ["mystery"]);
});

test("rows group by provider, model and project", () => {
  const result = run();
  assert.deepEqual(
    result.byProvider.map((row) => [
      row.key,
      row.label,
      row.requests,
      row.agents,
    ]),
    [
      ["pi", "Pi", 3, 3],
      ["codex", "Codex", 3, 2],
      ["claude", "Claude", 1, 1],
    ],
  );
  const gpt = result.byModel.find((row) => row.key === "gpt-6.1-sol");
  assert.equal(gpt.detail, "Codex");
  assert.equal(
    result.byModel.find((row) => row.key === "kimi-k3").detail,
    "Pi",
  );
  const none = result.byProject.find((row) => row.key === NO_PROJECT_KEY);
  assert.equal(none.detail, null);
  assert.equal(
    result.byProject.find((row) => row.key === "prj_b").detail,
    "/repo/b",
  );
});

test("options list every known value, not just the range", () => {
  const result = run({ from: NOW - HOUR / 2 });
  assert.equal(result.totals.requests, 0);
  assert.deepEqual(result.options.providers.map((o) => o.value).sort(), [
    "claude",
    "codex",
    "pi",
  ]);
  assert.ok(result.options.models.some((o) => o.value === "claude-opus-5-5"));
  const beta = result.options.projects.find((o) => o.value === "prj_b");
  assert.deepEqual(beta, { value: "prj_b", label: "beta", hint: "/repo/b" });
});

test("filters combine provider, model and project", () => {
  assert.equal(run({ providers: ["codex"] }).totals.requests, 3);
  assert.equal(run({ models: ["kimi-k3"] }).totals.requests, 2);
  assert.equal(run({ projects: [NO_PROJECT_KEY] }).totals.requests, 1);
  assert.equal(
    run({ providers: ["pi"], projects: ["prj_a"] }).totals.requests,
    2,
  );
});

test("collaboration follows parent agents across providers", () => {
  const c = run().collaboration;
  assert.equal(c.trees, 1);
  assert.equal(c.childAgents, 3);
  assert.equal(c.orchestrators, 2);
  assert.equal(c.maxFanout, 2);
  assert.equal(c.avgFanout, 1.5);
  assert.equal(c.maxDepth, 2);
  assert.equal(c.nativeSessions, 1);
  assert.equal(c.nativeTokens, 110);
  assert.deepEqual(
    c.pairs.map((p) => `${p.parent}>${p.child}:${p.count}`).sort(),
    ["Claude>Codex:1", "Claude>Pi:1", "Codex>Pi:1"],
  );
  const [tree] = c.topTrees;
  assert.equal(tree.rootId, "root");
  assert.deepEqual(
    tree.members.map((m) => [m.agentId, m.depth]),
    [
      ["root", 0],
      ["child1", 1],
      ["grand", 2],
      ["child2", 1],
    ],
  );
  assert.deepEqual(tree.providers, ["Claude", "Codex", "Pi"]);
  assert.equal(tree.members[1].nativeSessions, 1);
});

test("a tree keeps an idle orchestrator so active children stay connected", () => {
  const c = run({ providers: ["pi"] }).collaboration;
  const tree = c.topTrees.find((t) => t.rootId === "root");
  assert.deepEqual(
    tree.members.map((m) => [m.agentId, m.tokens > 0]),
    [
      ["root", false],
      ["child1", false],
      ["grand", true],
      ["child2", true],
    ],
  );
});

test("agents created in range without usage still count as participants", () => {
  const withNew = {
    ...agents,
    fresh: agent("fresh", "claude", {
      parentId: "solo",
      createdAt: NOW - HOUR,
    }),
  };
  const result = aggregate({
    events,
    agents: withNew,
    prices,
    providerLabel: (id) => id,
    query: {
      from: NOW - 24 * HOUR,
      to: NOW,
      providers: [],
      models: [],
      projects: [],
    },
  });
  assert.equal(result.collaboration.trees, 2);
  assert.equal(result.collaboration.activeAgents, 7);
  assert.equal(result.totals.agents, 6);
});
