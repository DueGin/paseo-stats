import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { StatsResult } from "../shared/stats";
import { compact as short, usd } from "./format";
import type { Translate } from "./i18n";
import { StatTile, cardStyle } from "./ui";

export interface SummaryProps {
  totals: StatsResult["totals"];
  theme: PluginTheme;
  compact: boolean;
  t: Translate;
}

export function Summary({ totals, theme, compact, t }: SummaryProps) {
  const styles = useMemo(
    () => ({
      row: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 12,
      },
      hero: {
        ...cardStyle(theme, compact),
        gap: 4,
        flexGrow: 1,
        flexBasis: compact ? ("100%" as const) : 280,
      },
      heroLabel: { color: theme.colors.foregroundMuted, fontSize: 12 },
      heroValue: {
        color: theme.colors.foreground,
        fontWeight: "600" as const,
      },
      heroDetail: { color: theme.colors.foregroundMuted, fontSize: 12 },
    }),
    [theme, compact],
  );
  const cache = totals.cacheRead + totals.cacheWrite;
  const cost = usd(totals.costUsd);
  // Web ignores adjustsFontSizeToFit, so long amounts step down explicitly.
  const heroSize = (compact ? 36 : 48) * (cost.length > 9 ? 0.75 : 1);
  return (
    <View style={styles.row}>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>{t("kpi.cost")}</Text>
        <Text
          style={[styles.heroValue, { fontSize: heroSize }]}
          numberOfLines={1}
        >
          {cost}
        </Text>
        <Text style={styles.heroDetail}>
          {totals.unpricedTokens > 0
            ? `${t("kpi.costEstimate")} · ${t("kpi.unpriced", {
                tokens: short(totals.unpricedTokens),
              })}`
            : t("kpi.costEstimate")}
        </Text>
      </View>
      <StatTile
        label={t("kpi.tokens")}
        value={short(totals.total)}
        detail={t("kpi.tokensDetail", {
          input: short(totals.input),
          output: short(totals.output),
        })}
        theme={theme}
        compact={compact}
      />
      <StatTile
        label={t("kpi.cache")}
        value={short(cache)}
        detail={t("kpi.cacheDetail", {
          read: short(totals.cacheRead),
          write: short(totals.cacheWrite),
        })}
        theme={theme}
        compact={compact}
      />
      <StatTile
        label={t("kpi.requests")}
        value={short(totals.requests)}
        theme={theme}
        compact={compact}
      />
      <StatTile
        label={t("kpi.agents")}
        value={String(totals.agents)}
        detail={t("kpi.agentsDetail")}
        theme={theme}
        compact={compact}
      />
    </View>
  );
}
