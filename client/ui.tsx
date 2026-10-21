import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";

export const TABULAR = { fontVariant: ["tabular-nums" as const] };

export function cardStyle(theme: PluginTheme, compact: boolean) {
  return {
    backgroundColor: theme.colors.surface1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: compact ? 12 : 16,
    gap: 12,
  };
}

export function sectionTitleStyle(theme: PluginTheme) {
  return {
    color: theme.colors.foreground,
    fontSize: 15,
    fontWeight: "600" as const,
  };
}

export interface StatTileProps {
  label: string;
  value: string;
  detail?: string | null;
  basis?: number | `${number}%`;
  theme: PluginTheme;
  compact: boolean;
}

export function StatTile({
  label,
  value,
  detail,
  basis = 150,
  theme,
  compact,
}: StatTileProps) {
  const styles = useMemo(
    () => ({
      tile: {
        ...cardStyle(theme, compact),
        gap: 4,
        flexGrow: 1,
        flexBasis: compact ? ("46%" as const) : basis,
        minWidth: compact ? 130 : 150,
      },
      label: { color: theme.colors.foregroundMuted, fontSize: 12 },
      value: {
        color: theme.colors.foreground,
        fontSize: compact ? 20 : 22,
        fontWeight: "600" as const,
      },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12 },
    }),
    [theme, compact, basis],
  );
  return (
    <View style={styles.tile}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
      {detail ? (
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

export function ShareBar({
  share,
  theme,
}: {
  share: number;
  theme: PluginTheme;
}) {
  const width = `${Math.max(0, Math.min(100, share * 100))}%` as const;
  return (
    <View
      style={{
        height: 4,
        borderRadius: 2,
        backgroundColor: theme.colors.surface2,
        overflow: "hidden",
        flex: 1,
      }}
    >
      <View
        style={{
          height: 4,
          borderRadius: 2,
          width,
          minWidth: share > 0 ? 2 : 0,
          backgroundColor: theme.colors.accent,
        }}
      />
    </View>
  );
}
