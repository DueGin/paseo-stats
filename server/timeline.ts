import type {
  StatsQuery,
  Timeline,
  TimelineSeries,
  TimelineUnit,
} from "../shared/stats.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MAX_OFFSET = 14 * 60;
// Series beyond this many fold into one. Three is the most categorical colours
// that stay distinguishable in every pairing, light and dark, with colour
// vision deficiency (see client/palette.ts).
export const TIMELINE_SERIES = 3;

const SIZE: Record<TimelineUnit, number> = { hour: HOUR, day: DAY, week: WEEK };

export interface TimelineEntry {
  ts: number;
  provider: string;
  model: string;
  tokens: number;
  // Null when the model has no price; counts as 0 in the chart.
  cost: number | null;
}

// Hourly up to three days, daily up to half a year, then weekly.
export function timelineUnit(span: number): TimelineUnit {
  if (span <= 3 * DAY) return "hour";
  if (span <= 180 * DAY) return "day";
  return "week";
}

// Start of the bucket holding `ts`, in the reader's time zone. Weeks start on
// Monday; the epoch was a Thursday, hence the three-day shift.
export function bucketStart(
  ts: number,
  unit: TimelineUnit,
  offsetMinutes: number,
): number {
  const offset = offsetMinutes * MINUTE;
  const shift = unit === "week" ? 3 * DAY : 0;
  const local = ts + offset + shift;
  const size = SIZE[unit];
  return Math.floor(local / size) * size - shift - offset;
}

function clampOffset(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, Math.round(value)));
}

interface Accumulator {
  label: string;
  costUsd: number[];
  tokens: number[];
  totalCost: number;
  totalTokens: number;
}

function topSeries(
  groups: Map<string, Accumulator>,
  length: number,
): TimelineSeries[] {
  const ranked = [...groups.entries()].sort(
    ([, a], [, b]) =>
      b.totalCost - a.totalCost || b.totalTokens - a.totalTokens,
  );
  const series: TimelineSeries[] = ranked
    .slice(0, TIMELINE_SERIES)
    .map(([key, group]) => ({
      key,
      label: group.label,
      costUsd: group.costUsd,
      tokens: group.tokens,
    }));
  const rest = ranked.slice(TIMELINE_SERIES);
  if (rest.length > 0) {
    const other: TimelineSeries = {
      key: null,
      label: "",
      costUsd: new Array(length).fill(0),
      tokens: new Array(length).fill(0),
    };
    for (const [, group] of rest) {
      for (let i = 0; i < length; i += 1) {
        other.costUsd[i] += group.costUsd[i];
        other.tokens[i] += group.tokens[i];
      }
    }
    series.push(other);
  }
  return series;
}

// Buckets the usage that passed the page's range and filters. A bounded range
// keeps its empty edges; an open-ended one ("all time", from 0) starts at the
// first event.
export function buildTimeline(
  entries: readonly TimelineEntry[],
  query: Pick<StatsQuery, "from" | "to" | "tzOffset">,
  providerLabel: (provider: string) => string,
): Timeline {
  const offset = clampOffset(query.tzOffset);
  let first = Infinity;
  for (const entry of entries) first = Math.min(first, entry.ts);
  const start =
    query.from > 0 ? query.from : Number.isFinite(first) ? first : query.to;
  const unit = timelineUnit(query.to - start);
  const size = SIZE[unit];
  const firstBucket = bucketStart(start, unit, offset);
  const lastBucket = bucketStart(query.to, unit, offset);
  const starts: number[] = [];
  for (let at = firstBucket; at <= lastBucket; at += size) starts.push(at);
  const length = starts.length;
  const zeros = () => new Array<number>(length).fill(0);
  const costUsd = zeros();
  const tokens = zeros();
  const requests = zeros();
  const providers = new Map<string, Accumulator>();
  const models = new Map<string, Accumulator>();
  const add = (
    groups: Map<string, Accumulator>,
    key: string,
    label: string,
    index: number,
    entry: TimelineEntry,
  ) => {
    let group = groups.get(key);
    if (!group) {
      group = {
        label,
        costUsd: zeros(),
        tokens: zeros(),
        totalCost: 0,
        totalTokens: 0,
      };
      groups.set(key, group);
    }
    const cost = entry.cost ?? 0;
    group.costUsd[index] += cost;
    group.tokens[index] += entry.tokens;
    group.totalCost += cost;
    group.totalTokens += entry.tokens;
  };
  for (const entry of entries) {
    const index = Math.round(
      (bucketStart(entry.ts, unit, offset) - firstBucket) / size,
    );
    if (index < 0 || index >= length) continue;
    costUsd[index] += entry.cost ?? 0;
    tokens[index] += entry.tokens;
    requests[index] += 1;
    add(providers, entry.provider, providerLabel(entry.provider), index, entry);
    add(models, entry.model, entry.model, index, entry);
  }
  return {
    unit,
    starts,
    costUsd,
    tokens,
    requests,
    byProvider: topSeries(providers, length),
    byModel: topSeries(models, length),
  };
}
