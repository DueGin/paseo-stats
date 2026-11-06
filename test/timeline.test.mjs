import test from "node:test";
import assert from "node:assert/strict";
import {
  TIMELINE_SERIES,
  bucketStart,
  buildTimeline,
  timelineUnit,
} from "../server/timeline.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const label = (id) => id.toUpperCase();

test("bucket size follows the length of the range", () => {
  assert.equal(timelineUnit(DAY), "hour");
  assert.equal(timelineUnit(3 * DAY), "hour");
  assert.equal(timelineUnit(7 * DAY), "day");
  assert.equal(timelineUnit(90 * DAY), "day");
  assert.equal(timelineUnit(365 * DAY), "week");
});

test("buckets start at the reader's local hour, midnight and Monday", () => {
  const ts = Date.parse("2026-11-06T02:30:00Z");
  // UTC+8: 10:30 local on Friday 6 November.
  assert.equal(
    bucketStart(ts, "hour", 480),
    Date.parse("2026-11-06T02:00:00Z"),
  );
  assert.equal(bucketStart(ts, "day", 480), Date.parse("2026-11-05T16:00:00Z"));
  assert.equal(
    bucketStart(ts, "week", 480),
    Date.parse("2026-11-01T16:00:00Z"),
  );
  // UTC-5: still Thursday 5 November locally.
  assert.equal(
    bucketStart(ts, "day", -300),
    Date.parse("2026-11-05T05:00:00Z"),
  );
  assert.equal(
    bucketStart(Date.parse("2026-11-02T00:00:00Z"), "week", 0),
    Date.parse("2026-11-02T00:00:00Z"),
  );
});

test("timeline fills empty buckets and sums each one", () => {
  const to = Date.parse("2026-11-06T12:00:00Z");
  const from = to - DAY;
  const timeline = buildTimeline(
    [
      { ts: from + HOUR, provider: "claude", model: "m1", tokens: 10, cost: 1 },
      {
        ts: from + HOUR,
        provider: "codex",
        model: "m2",
        tokens: 5,
        cost: null,
      },
      { ts: to - HOUR, provider: "claude", model: "m1", tokens: 20, cost: 2 },
    ],
    { from, to, tzOffset: 0 },
    label,
  );
  assert.equal(timeline.unit, "hour");
  assert.equal(timeline.starts.length, 25);
  assert.equal(timeline.starts[1] - timeline.starts[0], HOUR);
  assert.equal(timeline.costUsd[1], 1);
  assert.equal(timeline.tokens[1], 15);
  assert.equal(timeline.requests[1], 2);
  assert.equal(timeline.tokens[2], 0);
  assert.equal(timeline.tokens[23], 20);
  assert.equal(
    timeline.costUsd.reduce((a, b) => a + b, 0),
    3,
  );
  assert.deepEqual(
    timeline.byProvider.map((s) => [s.key, s.label]),
    [
      ["claude", "CLAUDE"],
      ["codex", "CODEX"],
    ],
  );
  assert.equal(timeline.byModel[0].tokens[23], 20);
});

test("an open-ended range starts at the first event", () => {
  const to = Date.parse("2026-11-06T12:00:00Z");
  const timeline = buildTimeline(
    [{ ts: to - 10 * DAY, provider: "pi", model: "m", tokens: 1, cost: 0 }],
    { from: 0, to, tzOffset: 0 },
    label,
  );
  assert.equal(timeline.unit, "day");
  assert.equal(timeline.starts.length, 11);
  assert.equal(timeline.tokens[0], 1);
});

test("no usage gives a short empty timeline", () => {
  const to = Date.parse("2026-11-06T12:00:00Z");
  const timeline = buildTimeline([], { from: 0, to }, label);
  assert.equal(timeline.starts.length, 1);
  assert.deepEqual(timeline.tokens, [0]);
  assert.deepEqual(timeline.byModel, []);
});

test("smaller series fold into one keyless series", () => {
  const to = Date.parse("2026-11-06T12:00:00Z");
  const entries = Array.from({ length: TIMELINE_SERIES + 2 }, (_, i) => ({
    ts: to - HOUR,
    provider: "p",
    model: `m${i}`,
    tokens: 100 - i,
    cost: 10 - i,
  }));
  const timeline = buildTimeline(entries, { from: to - DAY, to }, label);
  assert.equal(timeline.byModel.length, TIMELINE_SERIES + 1);
  const other = timeline.byModel.at(-1);
  assert.equal(other.key, null);
  assert.equal(
    other.costUsd.reduce((a, b) => a + b, 0),
    10 - TIMELINE_SERIES + (10 - TIMELINE_SERIES - 1),
  );
  assert.equal(timeline.byModel[0].key, "m0");
});
