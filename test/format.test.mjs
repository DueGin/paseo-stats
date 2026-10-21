import test from "node:test";
import assert from "node:assert/strict";
import {
  compact,
  parseInputValue,
  percent,
  toInputValue,
  usd,
} from "../client/format.ts";
import { presetRange } from "../client/time-range.ts";

test("compact numbers keep three significant digits", () => {
  assert.equal(compact(999), "999");
  assert.equal(compact(1234), "1.23K");
  assert.equal(compact(45_600_000), "45.6M");
  assert.equal(compact(3_309_312_303), "3.31B");
  assert.equal(compact(120_000), "120K");
});

test("usd and percent formats", () => {
  assert.equal(usd(0), "$0");
  assert.equal(usd(0.004), "<$0.01");
  assert.equal(usd(1234.5), "$1,234.50");
  assert.equal(percent(1, 3), "33%");
  assert.equal(percent(1, 10), "10%");
  assert.equal(percent(1, 30), "3.3%");
  assert.equal(percent(1, 10_000), "<0.1%");
  assert.equal(percent(1, 0), "0%");
});

test("custom range inputs round-trip local time and reject bad dates", () => {
  const ms = new Date(2026, 9, 21, 9, 5).getTime();
  assert.equal(toInputValue(ms), "2026-10-21 09:05");
  assert.equal(parseInputValue("2026-10-21 09:05"), ms);
  assert.equal(parseInputValue("2026-10-21"), new Date(2026, 9, 21).getTime());
  assert.equal(parseInputValue("2026-02-30 10:00"), null);
  assert.equal(parseInputValue("2026-10-21 24:00"), null);
  assert.equal(parseInputValue("yesterday"), null);
});

test("presets end now and default to the last 24 hours", () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(presetRange("24h", now), {
    from: now - 86_400_000,
    to: now,
  });
  assert.deepEqual(presetRange("all", now), { from: 0, to: now });
});
