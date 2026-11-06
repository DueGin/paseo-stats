import type { TimelineUnit } from "../shared/stats.ts";

const HOUR = 3_600_000;
export const BUCKET_MS: Record<TimelineUnit, number> = {
  hour: HOUR,
  day: 24 * HOUR,
  week: 7 * 24 * HOUR,
};

// Steps whose halves are round too, since the axis also labels its midpoint.
const NICE_STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

// The smallest nice step × 10^n at or above `value`, so the axis ends on a
// round number without leaving most of the plot empty.
export function niceCeil(value: number): number {
  if (!(value > 0)) return 0;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of NICE_STEPS) {
    if (value <= step * power * (1 + 1e-9)) return step * power;
  }
  return 10 * power;
}

// Evenly spaced bucket indexes for axis labels, always including the first.
export function labelIndexes(count: number, maxLabels: number): number[] {
  if (count <= 0) return [];
  const step = Math.max(1, Math.ceil(count / Math.max(1, maxLabels)));
  const result: number[] = [];
  for (let i = 0; i < count; i += step) result.push(i);
  return result;
}

// Left edge of a bucket's axis label, centred under the bucket but kept inside
// the plot (the left may borrow `inset` px of the y-axis gutter), so the first
// and last labels are never cut off by the card or the screen.
export function axisLabelLeft(
  index: number,
  count: number,
  width: number,
  labelWidth: number,
  inset = 0,
): number {
  const centre = ((index + 0.5) / count) * width;
  return Math.round(
    Math.max(-inset, Math.min(width - labelWidth, centre - labelWidth / 2)),
  );
}

export function peakIndex(values: readonly number[]): number {
  let best = -1;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > 0 && (best < 0 || values[i] > values[best])) best = i;
  }
  return best;
}
