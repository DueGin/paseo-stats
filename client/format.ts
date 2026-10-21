import type { Language } from "./i18n";

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
  return new Date(ms).toLocaleString(language === "zh" ? "zh-CN" : "en-US", {
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
