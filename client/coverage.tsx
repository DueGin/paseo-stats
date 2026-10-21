import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { Coverage } from "../shared/stats";
import { dateTime } from "./format";
import type { Language, Translate } from "./i18n";
import { cardStyle, sectionTitleStyle } from "./ui";

export interface CoverageNoteProps {
  coverage: Coverage;
  providerLabel(provider: string): string;
  theme: PluginTheme;
  compact: boolean;
  language: Language;
  t: Translate;
}

export function CoverageNote({
  coverage,
  providerLabel,
  theme,
  compact,
  language,
  t,
}: CoverageNoteProps) {
  const styles = useMemo(
    () => ({
      card: { ...cardStyle(theme, compact), gap: 6 },
      title: sectionTitleStyle(theme),
      line: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        lineHeight: 18,
      },
      warning: {
        color: theme.colors.statusWarning,
        fontSize: 12,
        lineHeight: 18,
      },
    }),
    [theme, compact],
  );
  const { pricing } = coverage;
  const pricingLine =
    (pricing.source === "online" || pricing.source === "cache") &&
    pricing.updatedAt
      ? t(`coverage.pricing.${pricing.source}`, {
          time: dateTime(pricing.updatedAt, language),
        })
      : t(
          pricing.source === "disabled"
            ? "coverage.pricing.disabled"
            : "coverage.pricing.none",
        );
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t("coverage.title")}</Text>
      {coverage.syncError ? (
        <Text style={styles.warning}>
          {t("coverage.syncError", { error: coverage.syncError })}
        </Text>
      ) : null}
      <Text style={styles.line}>{t("coverage.estimate")}</Text>
      <Text style={styles.line}>
        {pricingLine}
        {pricing.error
          ? t("coverage.pricingError", { error: pricing.error })
          : ""}
      </Text>
      {coverage.agents > 0 ? (
        <Text style={styles.line}>
          {t("coverage.logs", {
            found: coverage.agentsWithLogs,
            total: coverage.agents,
          })}
        </Text>
      ) : null}
      {coverage.missing.map((missing) => (
        <Text key={`${missing.reason}:${missing.provider}`} style={styles.line}>
          {"· "}
          {t(
            missing.reason === "unsupported"
              ? "coverage.unsupported"
              : "coverage.not_found",
            {
              provider: providerLabel(missing.provider),
              count: missing.count,
            },
          )}
        </Text>
      ))}
      {coverage.unpricedModels.length > 0 ? (
        <Text style={styles.warning}>
          {t("coverage.unpriced", {
            models: coverage.unpricedModels.join(", "),
          })}
        </Text>
      ) : null}
      <Text style={styles.line}>
        {t("coverage.ledger", {
          events: coverage.events,
          dir: coverage.dataDir,
        })}
      </Text>
    </View>
  );
}
