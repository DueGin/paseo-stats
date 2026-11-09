import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kimiParser } from "../server/parsers.ts";
import { indexKimi } from "../server/sessions.ts";

const state = (session = "session_1", native = false) => ({
  session,
  native,
  carry: {},
});

function usageLine(overrides = {}) {
  return JSON.stringify({
    type: "usage.record",
    agentId: "main",
    model: "kimi-code/k3.1-pro",
    usage: {
      inputOther: 10,
      output: 20,
      inputCacheRead: 300,
      inputCacheCreation: 40,
    },
    usageScope: "turn",
    time: 1794238164913,
    ...overrides,
  });
}

test("kimi: maps request usage and cache tokens", () => {
  assert.deepEqual(kimiParser.parse(usageLine(), state()), {
    key: "kimi:session_1:1794238164913",
    ts: 1794238164913,
    model: "kimi-code/k3.1-pro",
    input: 10,
    output: 20,
    cacheRead: 300,
    cacheWrite: 40,
    cacheWrite1h: 0,
    reportedCost: null,
    session: "session_1",
    native: false,
  });
});

test("kimi: skips other events, malformed entries and empty usage", () => {
  assert.equal(
    kimiParser.parse(JSON.stringify({ type: "llm.request" }), state()),
    null,
  );
  assert.equal(kimiParser.parse("{not json", state()), null);
  assert.equal(
    kimiParser.parse(
      usageLine({
        usage: {
          inputOther: 0,
          output: 0,
          inputCacheRead: 0,
          inputCacheCreation: 0,
        },
      }),
      state(),
    ),
    null,
  );
});

test("kimi: indexes main and native agent wire logs by session id", async () => {
  const root = mkdtempSync(join(tmpdir(), "paseo-stats-kimi-"));
  const sessionDir = join(root, "wd_project", "session_abc");
  for (const agent of ["main", "worker"]) {
    const agentDir = join(sessionDir, "agents", agent);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "wire.jsonl"), "");
  }
  mkdirSync(join(sessionDir, "agents", "empty"), { recursive: true });

  const sessions = await indexKimi([root]);
  assert.deepEqual(sessions.get("session_abc"), [
    {
      path: join(sessionDir, "agents", "main", "wire.jsonl"),
      session: "session_abc",
      native: false,
    },
    {
      path: join(sessionDir, "agents", "worker", "wire.jsonl"),
      session: "session_abc/worker",
      native: true,
    },
  ]);
});
