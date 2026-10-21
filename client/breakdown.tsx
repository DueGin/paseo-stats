import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { NO_PROJECT_KEY, type GroupRow } from "../shared/stats";
import { compact as short, percent, usd } from "./format";
import type { MessageKey, Translate } from "./i18n";
import { ShareBar, TABULAR, cardStyle } from "./ui";

export type Dimension = "provider" | "model" | "project";
export type SortKey = "cost" | "tokens";

const DIMENSIONS: { id: Dimension; label: MessageKey }[] = [
  { id: "provider", label: "tab.provider" },
  { id: "model", label: "tab.model" },
  { id: "project", label: "tab.project" },
];

const SORTS: { id: SortKey; label: MessageKey }[] = [
  { id: "cost", label: "sort.cost" },
  { id: "tokens", label: "sort.tokens" },
];

const NUMERIC_COLUMNS: {
  label: MessageKey;
  value: (row: GroupRow) => string;
}[] = [
  { label: "col.input", value: (row) => short(row.input) },
  { label: "col.output", value: (row) => short(row.output) },
  { label: "col.cacheRead", value: (row) => short(row.cacheRead) },
  { label: "col.cacheWrite", value: (row) => short(row.cacheWrite) },
  { label: "col.total", value: (row) => short(row.total) },
  { label: "col.cost", value: (row) => usd(row.costUsd) },
];

export interface BreakdownProps {
  rows: readonly GroupRow[];
  dimension: Dimension;
  onDimensionChange(dimension: Dimension): void;
  sort: SortKey;
  onSortChange(sort: SortKey): void;
  onPick(dimension: Dimension, key: string): void;
  theme: PluginTheme;
  compact: boolean;
  t: Translate;
}

export function rowLabel(row: GroupRow, dimension: Dimension, t: Translate) {
  return dimension === "project" && row.key === NO_PROJECT_KEY
    ? t("noProject")
    : row.label || row.key;
}

export function Breakdown({
  rows,
  dimension,
  onDimensionChange,
  sort,
  onSortChange,
  onPick,
  theme,
  compact,
  t,
}: BreakdownProps) {
  const styles = useMemo(
    () => ({
      card: cardStyle(theme, compact),
      header: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
      },
      tabs: {
        flexDirection: "row" as const,
        gap: 4,
        flexWrap: "wrap" as const,
      },
      tab: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
      tabActive: { backgroundColor: theme.colors.surface2 },
      tabText: { color: theme.colors.foregroundMuted, fontSize: 13 },
      tabTextActive: {
        color: theme.colors.foreground,
        fontWeight: "600" as const,
      },
      sortText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      sortTextActive: {
        color: theme.colors.accent,
        fontWeight: "600" as const,
      },
      headRow: {
        flexDirection: "row" as const,
        gap: 12,
        paddingBottom: 6,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      headText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      compactRow: {
        gap: 6,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      line: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 12,
      },
      name: { flex: 2.4, minWidth: 0 },
      numeric: { flex: 1, textAlign: "right" as const },
      share: {
        flex: 1.4,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      label: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "500" as const,
      },
      detail: { color: theme.colors.foregroundMuted, fontSize: 11 },
      value: { color: theme.colors.foreground, fontSize: 13, ...TABULAR },
      shareText: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        width: 44,
        textAlign: "right" as const,
        ...TABULAR,
      },
      empty: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
        paddingVertical: 16,
      },
      hint: { color: theme.colors.foregroundMuted, fontSize: 11 },
    }),
    [theme, compact],
  );

  const metric = (row: GroupRow) => (sort === "cost" ? row.costUsd : row.total);
  const sorted = [...rows].sort(
    (a, b) =>
      metric(b) - metric(a) ||
      (sort === "cost" ? b.total - a.total : b.costUsd - a.costUsd),
  );
  const whole = sorted.reduce((sum, row) => sum + metric(row), 0);
  const describe = (row: GroupRow) =>
    [row.detail, t("table.agents", { count: row.agents })]
      .filter(Boolean)
      .join(" · ");

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {DIMENSIONS.map(({ id, label }) => {
            const active = id === dimension;
            return (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityLabel={t(label)}
                accessibilityState={{ selected: active }}
                onPress={() => onDimensionChange(id)}
                style={[styles.tab, active ? styles.tabActive : null]}
              >
                <Text
                  style={[styles.tabText, active ? styles.tabTextActive : null]}
                >
                  {t(label)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.tabs}>
          {SORTS.map(({ id, label }) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              accessibilityLabel={t(label)}
              accessibilityState={{ selected: id === sort }}
              onPress={() => onSortChange(id)}
              style={styles.tab}
            >
              <Text
                style={[
                  styles.sortText,
                  id === sort ? styles.sortTextActive : null,
                ]}
              >
                {t(label)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {sorted.length === 0 ? (
        <Text style={styles.empty}>{t("table.empty")}</Text>
      ) : compact ? (
        <View>
          {sorted.map((row) => {
            const label = rowLabel(row, dimension, t);
            return (
              <Pressable
                key={row.key}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => onPick(dimension, row.key)}
                style={styles.compactRow}
              >
                <View style={styles.line}>
                  <Text style={[styles.label, { flex: 1 }]} numberOfLines={1}>
                    {label}
                  </Text>
                  <Text style={styles.value}>{usd(row.costUsd)}</Text>
                </View>
                <View style={styles.line}>
                  <Text style={[styles.detail, { flex: 1 }]} numberOfLines={1}>
                    {t("table.rowDetail", {
                      input: short(row.input),
                      output: short(row.output),
                      cache: short(row.cacheRead + row.cacheWrite),
                    })}
                  </Text>
                  <Text style={[styles.detail, TABULAR]}>
                    {short(row.total)}
                  </Text>
                </View>
                <View style={styles.share}>
                  <ShareBar
                    share={whole > 0 ? metric(row) / whole : 0}
                    theme={theme}
                  />
                  <Text style={styles.shareText}>
                    {percent(metric(row), whole)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View>
          <View style={styles.headRow}>
            <Text style={[styles.headText, styles.name]}>{t("col.name")}</Text>
            {NUMERIC_COLUMNS.map((column) => (
              <Text
                key={column.label}
                style={[styles.headText, styles.numeric]}
              >
                {t(column.label)}
              </Text>
            ))}
            <Text
              style={[
                styles.headText,
                styles.share,
                { justifyContent: "flex-end" },
              ]}
            >
              {t("col.share")}
            </Text>
          </View>
          {sorted.map((row) => {
            const label = rowLabel(row, dimension, t);
            return (
              <Pressable
                key={row.key}
                accessibilityRole="button"
                accessibilityLabel={label}
                onPress={() => onPick(dimension, row.key)}
                style={({ pressed }) => [
                  styles.row,
                  pressed ? { backgroundColor: theme.colors.surface2 } : null,
                ]}
              >
                <View style={styles.name}>
                  <Text style={styles.label} numberOfLines={1}>
                    {label}
                  </Text>
                  <Text
                    style={styles.detail}
                    numberOfLines={1}
                    ellipsizeMode="middle"
                  >
                    {describe(row)}
                  </Text>
                </View>
                {NUMERIC_COLUMNS.map((column) => (
                  <Text
                    key={column.label}
                    style={[styles.value, styles.numeric]}
                  >
                    {column.value(row)}
                  </Text>
                ))}
                <View style={styles.share}>
                  <ShareBar
                    share={whole > 0 ? metric(row) / whole : 0}
                    theme={theme}
                  />
                  <Text style={styles.shareText}>
                    {percent(metric(row), whole)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
      {sorted.length > 0 ? (
        <Text style={styles.hint}>{t("table.hint")}</Text>
      ) : null}
    </View>
  );
}
