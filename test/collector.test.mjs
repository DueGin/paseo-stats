import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Collector } from "../server/collector.ts";
import { UsageStore } from "../server/store.ts";

const PARENT = "01a1574a-34d8-7841-9135-a4473d1a4a96";
const CHILD = "01a1574a-e4fd-7041-81fb-acce3326be3f";

const lines = (...entries) =>
  entries.map((e) => JSON.stringify(e)).join("\n") + "\n";

function claudeEntry(id, output, extra = {}) {
  return {
    type: "assistant",
    timestamp: "2026-10-21T08:00:00.000Z",
    requestId: `req_${id}`,
    message: {
      id,
      model: "claude-opus-5-5",
      usage: {
        input_tokens: 1,
        output_tokens: output,
        cache_read_input_tokens: 0,
      },
    },
    ...extra,
  };
}

function codexRollout(id, parent, total) {
  return lines(
    {
      type: "session_meta",
      payload: { id, ...(parent ? { parent_thread_id: parent } : {}) },
    },
    { type: "turn_context", payload: { model: "gpt-6.1-sol" } },
    {
      timestamp: "2026-10-20T08:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { total_tokens: total },
          last_token_usage: {
            input_tokens: total - 10,
            cached_input_tokens: 0,
            output_tokens: 10,
          },
        },
      },
    },
  );
}

function piMessage(id) {
  return {
    type: "message",
    id,
    timestamp: "2026-10-20T03:07:20.032Z",
    message: {
      role: "assistant",
      model: "kimi-k3",
      usage: {
        input: 3,
        output: 4,
        cacheRead: 0,
        cacheWrite: 0,
        cost: { total: 0.01 },
      },
    },
  };
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), "paseo-stats-collector-"));
  const claudeProject = join(root, "claude/projects/-repo-a");
  mkdirSync(join(claudeProject, "sess-c/subagents"), { recursive: true });
  writeFileSync(
    join(claudeProject, "sess-c.jsonl"),
    lines(claudeEntry("m1", 5), claudeEntry("m1", 9), claudeEntry("m2", 1)),
  );
  writeFileSync(
    join(claudeProject, "sess-c/subagents/agent-x.jsonl"),
    lines(claudeEntry("m3", 2, { isSidechain: true })),
  );
  const codexDay = join(root, "codex/sessions/2026/10/20");
  mkdirSync(codexDay, { recursive: true });
  writeFileSync(
    join(codexDay, `rollout-2026-10-20T10-00-00-${PARENT}.jsonl`),
    codexRollout(PARENT, null, 100),
  );
  writeFileSync(
    join(codexDay, `rollout-2026-10-20T10-05-00-${CHILD}.jsonl`),
    codexRollout(CHILD, PARENT, 50),
  );
  const piDir = join(root, "pi/sessions/--repo-a--");
  mkdirSync(piDir, { recursive: true });
  const piFile = join(piDir, "2026-10-20T03-07-00-430Z_pi-1.jsonl");
  writeFileSync(piFile, lines(piMessage("e1")));

  const roots = {
    claude: [join(root, "claude/projects")],
    codex: [
      join(root, "codex/sessions"),
      join(root, "codex/archived_sessions"),
    ],
    pi: [join(root, "pi/sessions")],
    omp: [join(root, "omp/sessions")],
  };
  return { root, roots, piFile, dataDir: join(root, "data") };
}

function entry(id, provider, sessionId, labels = {}) {
  return {
    agent: {
      id,
      provider,
      cwd: "/repo/a",
      title: id,
      model: null,
      createdAt: "2026-10-20T00:00:00.000Z",
      labels,
      persistence: sessionId ? { provider, sessionId } : null,
    },
    project: {
      projectKey: "prj_a",
      projectName: "alpha",
      checkout: { cwd: "/repo/a", mainRepoRoot: null, worktreeRoot: "/repo/a" },
    },
  };
}

const paseo = {
  agents: {
    list: async () => ({
      entries: [
        entry("claude-agent", "claude", "sess-c"),
        entry("codex-agent", "codex", PARENT, {
          "paseo.parent-agent-id": "claude-agent",
        }),
        entry("pi-agent", "pi", "pi-1"),
        entry("gone", "claude", "missing-session"),
        entry("grok-agent", "grok", "g-1"),
        entry("idle", "claude", null),
      ],
      pageInfo: { hasMore: false, nextCursor: null },
    }),
  },
  providers: {
    snapshot: async () => ({ entries: [{ provider: "pi", label: "Pi" }] }),
  },
};

test("collector links logs to agents, including provider subagents", async () => {
  const { roots, dataDir } = setup();
  const store = await UsageStore.open(dataDir);
  const collector = new Collector(store, roots);
  await collector.sync(paseo);
  assert.equal(collector.lastError, null);

  const byKey = Object.fromEntries(store.events.map((e) => [e.key, e]));
  assert.equal(store.events.length, 6);
  assert.equal(byKey["claude:m1:req_m1"].output, 9);
  assert.equal(byKey["claude:m3:req_m3"].native, true);
  assert.equal(byKey[`codex:${PARENT}:100`].native, false);
  assert.equal(byKey[`codex:${CHILD}:50`].native, true);
  assert.equal(byKey[`codex:${CHILD}:50`].agentId, "codex-agent");
  assert.equal(byKey["pi:pi-1:e1"].reportedCost, 0.01);

  assert.equal(collector.coverage.agents, 5);
  assert.equal(collector.coverage.agentsWithLogs, 3);
  assert.deepEqual(
    collector.coverage.missing
      .map((m) => `${m.provider}:${m.reason}:${m.count}`)
      .sort(),
    ["claude:not_found:1", "grok:unsupported:1"],
  );
  assert.equal(store.state.agents["codex-agent"].parentId, "claude-agent");
  assert.equal(store.state.agents["codex-agent"].projectPath, "/repo/a");
  assert.equal(store.state.providerLabels.pi, "Pi");
});

test("collector reads appended lines once and waits for partial lines", async () => {
  const { roots, dataDir, piFile } = setup();
  const store = await UsageStore.open(dataDir);
  const collector = new Collector(store, roots);
  await collector.sync(paseo);
  const before = store.events.length;

  const partial = JSON.stringify(piMessage("e2"));
  appendFileSync(piFile, partial.slice(0, 20));
  await collector.sync(paseo);
  assert.equal(store.events.length, before);

  appendFileSync(piFile, partial.slice(20) + "\n");
  await collector.sync(paseo);
  assert.equal(store.events.length, before + 1);

  const reopened = await UsageStore.open(dataDir);
  assert.equal(reopened.events.length, before + 1);
  const again = new Collector(reopened, roots);
  reopened.state.files = {};
  await again.sync(paseo);
  assert.equal(reopened.events.length, before + 1);
});
