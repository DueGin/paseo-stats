import type { PluginTheme } from "@getpaseo/plugin";

// Categorical colours for stacked series. These are the first three slots of
// a validated palette: any two stay distinguishable for colour-blind readers
// in both modes, whatever their order (checked against Paseo's #fafafa and
// #1f1f22 cards). Light slots 2 and 3 sit under 3:1 on light cards, so values
// are always shown beside them in the legend and the bar detail.
const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a"],
  dark: ["#3987e5", "#d95926", "#199e70"],
} as const;

export const SERIES_SLOTS = SERIES.light.length;

function channels(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const value =
      hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16)) as [
      number,
      number,
      number,
    ];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(color.trim());
  return rgb ? [+rgb[1], +rgb[2], +rgb[3]] : null;
}

// Relative luminance, 0 (black) to 1 (white); null for colours it can't read.
export function luminance(color: string): number | null {
  const rgb = channels(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isDarkTheme(theme: PluginTheme): boolean {
  return (luminance(theme.colors.surface0) ?? 1) < 0.4;
}

export function seriesColors(theme: PluginTheme): readonly string[] {
  return isDarkTheme(theme) ? SERIES.dark : SERIES.light;
}

// Gives each series a colour slot that follows the entity rather than its
// rank: an entity keeps the slot of its place in `stableOrder` (the filter
// options, ordered by all-time usage) when that slot exists and is free, so
// changing the range or filters rarely repaints a series. Others take the
// lowest free slot. Keys beyond the slots get -1.
export function assignSlots(
  keys: readonly string[],
  stableOrder: readonly string[],
  slots: number = SERIES_SLOTS,
): Map<string, number> {
  const result = new Map<string, number>();
  const used = new Set<number>();
  for (const key of keys) {
    const preferred = stableOrder.indexOf(key);
    if (preferred >= 0 && preferred < slots && !used.has(preferred)) {
      result.set(key, preferred);
      used.add(preferred);
    }
  }
  for (const key of keys) {
    if (result.has(key)) continue;
    let slot = 0;
    while (used.has(slot)) slot += 1;
    result.set(key, slot < slots ? slot : -1);
    if (slot < slots) used.add(slot);
  }
  return result;
}
