export type RangePreset = "24h" | "7d" | "30d" | "90d" | "all" | "custom";

const DAY_MS = 24 * 60 * 60 * 1000;

const SPANS: Record<Exclude<RangePreset, "all" | "custom">, number> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS,
  "90d": 90 * DAY_MS,
};

export const RANGE_PRESETS: readonly RangePreset[] = [
  "24h",
  "7d",
  "30d",
  "90d",
  "all",
  "custom",
];

export interface TimeRange {
  from: number;
  to: number;
}

export function presetRange(
  preset: Exclude<RangePreset, "custom">,
  now: number,
): TimeRange {
  return preset === "all"
    ? { from: 0, to: now }
    : { from: now - SPANS[preset], to: now };
}
