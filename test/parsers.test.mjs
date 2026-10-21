import test from "node:test";
import assert from "node:assert/strict";
import { claudeParser, codexParser, piParser } from "../server/parsers.ts";

const state = (session = "s1", native = false) => ({
  session,
  native,
  carry: {},
});

function claudeLine(overrides = {}) {
  return JSON.stringify({
    type: "assistant",
    timestamp: "2026-10-21T08:00:00.000Z",
    requestId: "req_1",
    message: {
      id: "msg_1",
      model: "claude-opus-5-5",
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 300,
        cache_creation_input_tokens: 40,
        cache_creation: { ephemeral_1h_input_tokens: 40 },
      },
    },
    ...overrides,
  });
}

test("claude: maps usage, keys by message and request, keeps 1h cache writes", () => {
  const event = claudeParser.parse(claudeLine(), state());
  assert.deepEqual(event, {
    key: "claude:msg_1:req_1",
    ts: Date.parse("2026-10-21T08:00:00.000Z"),
    model: "claude-opus-5-5",
    input: 10,
    output: 20,
    cacheRead: 300,
    cacheWrite: 40,
    cacheWrite1h: 40,
    reportedCost: null,
    session: "s1",
    native: false,
  });
});

test("claude: skips synthetic, non-assistant and empty entries", () => {
  const synthetic = JSON.parse(claudeLine());
  synthetic.message.model = "<synthetic>";
  assert.equal(claudeParser.parse(JSON.stringify(synthetic), state()), null);
  assert.equal(claudeParser.parse(claudeLine({ type: "user" }), state()), null);
  assert.equal(claudeParser.parse("{not json", state()), null);
});

test("claude: inline sidechain messages count as provider subagents", () => {
  const event = claudeParser.parse(
    claudeLine({ isSidechain: true, agentId: "a7" }),
    state("s1"),
  );
  assert.equal(event.native, true);
  assert.equal(event.session, "s1/a7");
});

function codexTokenCount(total, last) {
  return JSON.stringify({
    timestamp: "2026-10-20T08:22:29.971Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: { total_tokens: total },
        last_token_usage: last,
      },
    },
  });
}

test("codex: uses last request usage, splits cached input, skips repeated totals", () => {
  const s = state("thread-1");
  codexParser.parse(
    JSON.stringify({ type: "turn_context", payload: { model: "gpt-6.1-sol" } }),
    s,
  );
  const last = {
    input_tokens: 1000,
    cached_input_tokens: 800,
    cache_write_input_tokens: 50,
    output_tokens: 30,
    reasoning_output_tokens: 10,
  };
  const event = codexParser.parse(codexTokenCount(1030, last), s);
  assert.equal(event.key, "codex:thread-1:1030");
  assert.equal(event.model, "gpt-6.1-sol");
  assert.equal(event.input, 150);
  assert.equal(event.cacheRead, 800);
  assert.equal(event.cacheWrite, 50);
  assert.equal(event.output, 30);
  assert.equal(codexParser.parse(codexTokenCount(1030, last), s), null);
  assert.equal(codexParser.parse(codexTokenCount(1030, null), state()), null);
});

test("pi: takes the cost the log reports and ignores zero usage", () => {
  const line = (usage) =>
    JSON.stringify({
      type: "message",
      id: "e1",
      timestamp: "2026-10-20T03:07:20.032Z",
      message: {
        role: "assistant",
        provider: "relay",
        model: "kimi-k3",
        usage,
      },
    });
  const event = piParser.parse(
    line({
      input: 5,
      output: 6,
      cacheRead: 7,
      cacheWrite: 8,
      cost: { total: 0.25 },
    }),
    state("p1"),
  );
  assert.equal(event.key, "pi:p1:e1");
  assert.equal(event.reportedCost, 0.25);
  assert.equal(
    event.input + event.output + event.cacheRead + event.cacheWrite,
    26,
  );
  const unpriced = piParser.parse(
    line({
      input: 5,
      output: 6,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { total: 0 },
    }),
    state("p1"),
  );
  assert.equal(unpriced.reportedCost, null);
  assert.equal(
    piParser.parse(
      line({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
      state(),
    ),
    null,
  );
});
