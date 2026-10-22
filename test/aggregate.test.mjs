import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, configuredModel } from "../server/aggregate.ts";
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
    c.providerPairs.map((p) => `${p.parent}>${p.child}:${p.count}`).sort(),
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
  assert.deepEqual(tree.models, [
    "gpt-6.1-sol",
    "claude-opus-5-5",
    "kimi-k3",
    "mystery",
  ]);
  assert.equal(tree.members[1].nativeSessions, 1);
  assert.equal(tree.members[1].model, "gpt-6.1-sol");
});

const money = (value) => Math.round(value * 1000) / 1000;

test("model pairs link each parent's main model to its child's", () => {
  const pairs = run().collaboration.modelPairs.map((p) => [
    `${p.parent}>${p.child}`,
    p.count,
    p.tokens,
    money(p.costUsd),
  ]);
  assert.deepEqual(pairs.sort(), [
    ["claude-opus-5-5>gpt-6.1-sol", 1, 220, 0.22],
    ["claude-opus-5-5>mystery", 1, 110, 0],
    ["gpt-6.1-sol>kimi-k3", 1, 110, 0.5],
  ]);
});

test("model roles split spend by orchestrator, child, subagent and solo use", () => {
  const models = run().collaboration.models;
  assert.deepEqual(
    models.map((row) => row.model),
    ["kimi-k3", "gpt-6.1-sol", "claude-opus-5-5", "mystery"],
  );
  const byModel = Object.fromEntries(models.map((row) => [row.model, row]));

  // child1 is a child but also launched grand, so it counts as orchestrator.
  const gpt = byModel["gpt-6.1-sol"];
  assert.deepEqual(gpt.providers, ["Codex"]);
  assert.deepEqual(
    [gpt.orchestrator.agents, gpt.orchestrator.tokens, gpt.child.agents],
    [1, 110, 0],
  );
  assert.deepEqual([gpt.native.sessions, gpt.native.tokens], [1, 110]);
  assert.deepEqual([gpt.solo.agents, gpt.solo.tokens], [1, 110]);
  assert.deepEqual(
    [
      gpt.delegated.orchestrators,
      gpt.delegated.children,
      money(gpt.delegated.costUsd),
    ],
    [1, 1, 0.5],
  );

  const kimi = byModel["kimi-k3"];
  assert.deepEqual([kimi.child.agents, money(kimi.child.costUsd)], [1, 0.5]);
  assert.deepEqual([kimi.solo.agents, kimi.delegated.children], [1, 0]);

  const claude = byModel["claude-opus-5-5"];
  assert.equal(claude.orchestrator.agents, 1);
  assert.deepEqual(
    [claude.delegated.orchestrators, claude.delegated.children],
    [1, 2],
  );
  assert.equal(claude.delegated.tokens, 330);
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
  assert.deepEqual(c.modelPairs.map((p) => `${p.parent}>${p.child}`).sort(), [
    "null>kimi-k3",
    "null>mystery",
  ]);
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

test("configuredModel drops the provider prefix Pi adds", () => {
  const model = (provider, value) =>
    configuredModel(agent("x", provider, { model: value }));
  assert.equal(model("pi", "agent2api/kimi-k3"), "kimi-k3");
  assert.equal(
    model("omp", "openrouter/anthropic/claude-x"),
    "anthropic/claude-x",
  );
  assert.equal(model("claude", "claude-opus-5-5"), "claude-opus-5-5");
  assert.equal(model("codex", null), null);
});

test("pairs fall back to the normalized configured model without usage", () => {
  const withIdle = {
    ...agents,
    idle: agent("idle", "pi", {
      parentId: "root",
      model: "relay/kimi-k3",
      createdAt: NOW - HOUR,
    }),
  };
  const result = aggregate({
    events,
    agents: withIdle,
    prices,
    providerLabel: (id) => id,
    query: {
      from: NOW - 24 * HOUR,
      to: NOW,
      providers: [],
      models: ["kimi-k3"],
      projects: [],
    },
  });
  assert.ok(
    result.collaboration.modelPairs.some(
      (p) => p.parent === null && p.child === "kimi-k3" && p.count === 2,
    ),
  );
  assert.ok(
    result.collaboration.topTrees[0].members.some(
      (m) => m.agentId === "idle" && m.model === "kimi-k3",
    ),
  );
});
