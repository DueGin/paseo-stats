import type { TimelineUnit } from "../shared/stats.ts";
import { localeTag, type Language } from "./locale.ts";

function trimFixed(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

export function compact(value: number): string {
  const abs = Math.abs(value);
  const scaled = (divisor: number, suffix: string) => {
    const v = value / divisor;
    const digits = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
    return trimFixed(v, digits) + suffix;
  };
  if (abs >= 1e9) return scaled(1e9, "B");
  if (abs >= 1e6) return scaled(1e6, "M");
  if (abs >= 1e3) return scaled(1e3, "K");
  return String(Math.round(value));
}

export function usd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  return (
    "$" +
    value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  const share = (part / whole) * 100;
  if (share > 0 && share < 0.1) return "<0.1%";
  return trimFixed(share, share >= 10 ? 0 : 1) + "%";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function dateTime(ms: number, language: Language): string {
  return new Date(ms).toLocaleString(localeTag(language), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function toInputValue(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function parseInputValue(text: string): number | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(
    text.trim(),
  );
  if (!match) return null;
  const [, y, mo, d, h = "0", mi = "0"] = match;
  const date = new Date(+y, +mo - 1, +d, +h, +mi);
  if (date.getMonth() !== +mo - 1 || date.getDate() !== +d) return null;
  if (+h > 23 || +mi > 59) return null;
  return date.getTime();
}

// Short money for chart axes: $0, $0.25, $12.5, $150, $1.5K. Axis midpoints
// are halves of round numbers, so keep the digit that makes them exact.
export function usdCompact(value: number): string {
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  if (abs >= 1000) return "$" + compact(value);
  return "$" + trimFixed(value, abs >= 100 ? 0 : abs >= 10 ? 1 : 2);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function format(
  ms: number,
  language: Language,
  options: Intl.DateTimeFormatOptions,
) {
  return new Date(ms).toLocaleString(localeTag(language), options);
}

// Axis label for a bucket. Hour labels add the date when it changes from the
// previous label.
export function bucketLabel(
  start: number,
  unit: TimelineUnit,
  language: Language,
  previous: number | null,
): string {
  if (unit !== "hour")
    return format(start, language, { month: "numeric", day: "numeric" });
  const time = format(start, language, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const sameDay =
    previous !== null &&
    new Date(previous).toDateString() === new Date(start).toDateString();
  return sameDay
    ? time
    : `${format(start, language, { month: "numeric", day: "numeric" })} ${time}`;
}

// The period a bucket covers, for its detail line.
export function bucketRange(
  start: number,
  unit: TimelineUnit,
  language: Language,
): string {
  if (unit === "hour") {
    const day = format(start, language, {
      month: "short",
      day: "numeric",
      weekday: "short",
    });
    const hour = (ms: number) =>
      format(ms, language, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    return `${day} ${hour(start)}–${hour(start + 60 * 60 * 1000)}`;
  }
  const day = (ms: number) =>
    format(ms, language, { month: "short", day: "numeric" });
  if (unit === "day")
    return format(start, language, {
      month: "short",
      day: "numeric",
      weekday: "short",
    });
  return `${day(start)} – ${day(start + 6 * DAY_MS)}`;
}
