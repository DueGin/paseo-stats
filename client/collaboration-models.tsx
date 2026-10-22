import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { CollaborationPair, ModelRole } from "../shared/stats";
import { compact as short, percent, usd } from "./format";
import type { MessageKey, Translate } from "./i18n";
import { ShareBar, TABULAR } from "./ui";

const PAIR_LIMIT = 8;

function useCellStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      label: { color: theme.colors.foregroundMuted, fontSize: 12 },
      hint: { color: theme.colors.foregroundMuted, fontSize: 11 },
      headText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      name: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "500" as const,
      },
      value: { color: theme.colors.foreground, fontSize: 13, ...TABULAR },
      detail: { color: theme.colors.foregroundMuted, fontSize: 11, ...TABULAR },
      empty: { color: theme.colors.foregroundMuted, fontSize: 13 },
      rule: {
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      },
      link: { color: theme.colors.accent, fontSize: 12 },
    }),
    [theme],
  );
}

// Share of a model's spend that happened in collaboration (falls back to
// tokens when nothing is priced).
export function collaborativeShare(row: ModelRole): [number, number] {
  const cost =
    row.orchestrator.costUsd + row.child.costUsd + row.native.costUsd;
  const all = cost + row.solo.costUsd;
  if (all > 0) return [cost, all];
  const tokens = row.orchestrator.tokens + row.child.tokens + row.native.tokens;
  return [tokens, tokens + row.solo.tokens];
}

export interface ModelRolesProps {
  models: readonly ModelRole[];
  onPick(model: string): void;
  theme: PluginTheme;
  compact: boolean;
  t: Translate;
}

export function ModelRoles({
  models,
  onPick,
  theme,
  compact,
  t,
}: ModelRolesProps) {
  const cell = useCellStyles(theme);
  const styles = useMemo(
    () => ({
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 12,
        paddingVertical: 8,
        ...cell.rule,
      },
      compactRow: { gap: 4, paddingVertical: 10, ...cell.rule },
      line: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 12,
      },
      model: { flex: 2, minWidth: 0 },
      numeric: { flex: 1.2, alignItems: "flex-end" as const },
      share: {
        flex: 1.4,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
      },
      shareText: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        width: 44,
        textAlign: "right" as const,
        ...TABULAR,
      },
    }),
    [theme, cell],
  );

  const roleCell = (spend: { tokens: number; costUsd: number }, sub: string) =>
    spend.tokens > 0 ? (
      <>
        <Text style={cell.value}>{usd(spend.costUsd)}</Text>
        <Text style={cell.detail} numberOfLines={1}>
          {sub}
        </Text>
      </>
    ) : (
      <Text style={cell.detail}>—</Text>
    );

  const fanout = (row: ModelRole) =>
    row.delegated.orchestrators
      ? (row.delegated.children / row.delegated.orchestrators).toFixed(1)
      : "0";

  const header = (
    <View style={[styles.row, { paddingTop: 0, paddingBottom: 6 }]}>
      <Text style={[cell.headText, styles.model]}>{t("collab.col.model")}</Text>
      {(
        [
          "collab.col.orchestrator",
          "collab.col.child",
          "collab.col.native",
          "collab.col.delegated",
        ] as MessageKey[]
      ).map((key) => (
        <Text
          key={key}
          style={[cell.headText, styles.numeric, { textAlign: "right" }]}
        >
          {t(key)}
        </Text>
      ))}
      <Text style={[cell.headText, styles.share]}>{t("collab.col.share")}</Text>
    </View>
  );

  return (
    <View style={{ gap: 6 }}>
      <View style={{ gap: 2 }}>
        <Text style={cell.label}>{t("collab.models")}</Text>
        <Text style={cell.hint}>{t("collab.modelsHint")}</Text>
      </View>
      {models.length === 0 ? (
        <Text style={cell.empty}>{t("collab.modelsEmpty")}</Text>
      ) : (
        <View>
          {compact ? null : header}
          {models.map((row) => {
            const [part, whole] = collaborativeShare(row);
            const share = (
              <View style={styles.share}>
                <ShareBar share={whole > 0 ? part / whole : 0} theme={theme} />
                <Text style={styles.shareText}>
                  {whole > 0 ? percent(part, whole) : "—"}
                </Text>
              </View>
            );
            const providers = row.providers.join(" / ");
            if (compact) {
              return (
                <Pressable
                  key={row.model}
                  accessibilityRole="button"
                  accessibilityLabel={row.model}
                  onPress={() => onPick(row.model)}
                  style={styles.compactRow}
                >
                  <View style={styles.line}>
                    <Text style={[cell.name, { flex: 1 }]} numberOfLines={1}>
                      {row.model}
                    </Text>
                    <Text style={cell.detail}>{providers}</Text>
                  </View>
                  <Text style={cell.detail}>
                    {t("collab.compactRoles", {
                      orchestrator: usd(row.orchestrator.costUsd),
                      child: usd(row.child.costUsd),
                      native: usd(row.native.costUsd),
                    })}
                  </Text>
                  {row.delegated.children > 0 ? (
                    <Text style={cell.detail}>
                      {t("collab.compactDelegated", {
                        count: row.delegated.children,
                        cost: usd(row.delegated.costUsd),
                      })}
                    </Text>
                  ) : null}
                  {share}
                </Pressable>
              );
            }
            return (
              <Pressable
                key={row.model}
                accessibilityRole="button"
                accessibilityLabel={row.model}
                onPress={() => onPick(row.model)}
                style={({ pressed }) => [
                  styles.row,
                  pressed ? { backgroundColor: theme.colors.surface2 } : null,
                ]}
              >
                <View style={styles.model}>
                  <Text style={cell.name} numberOfLines={1}>
                    {row.model}
                  </Text>
                  <Text style={cell.detail} numberOfLines={1}>
                    {providers}
                  </Text>
                </View>
                <View style={styles.numeric}>
                  {roleCell(
                    row.orchestrator,
                    t("collab.roleAgents", {
                      tokens: short(row.orchestrator.tokens),
                      count: row.orchestrator.agents,
                    }),
                  )}
                </View>
                <View style={styles.numeric}>
                  {roleCell(
                    row.child,
                    t("collab.roleAgents", {
                      tokens: short(row.child.tokens),
                      count: row.child.agents,
                    }),
                  )}
                </View>
                <View style={styles.numeric}>
                  {roleCell(
                    row.native,
                    t("collab.roleSessions", {
                      tokens: short(row.native.tokens),
                      count: row.native.sessions,
                    }),
                  )}
                </View>
                <View style={styles.numeric}>
                  {row.delegated.children > 0 ? (
                    <>
                      <Text style={cell.value}>
                        {t("collab.delegatedValue", {
                          count: row.delegated.children,
                        })}
                      </Text>
                      <Text style={cell.detail} numberOfLines={1}>
                        {t("collab.delegatedDetail", {
                          cost: usd(row.delegated.costUsd),
                          fanout: fanout(row),
                        })}
                      </Text>
                    </>
                  ) : (
                    <Text style={cell.detail}>—</Text>
                  )}
                </View>
                {share}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

type PairDimension = "model" | "provider";

export interface PairListProps {
  modelPairs: readonly CollaborationPair[];
  providerPairs: readonly CollaborationPair[];
  theme: PluginTheme;
  t: Translate;
}

export function PairList({
  modelPairs,
  providerPairs,
  theme,
  t,
}: PairListProps) {
  const [dimension, setDimension] = useState<PairDimension>("model");
  const [showAll, setShowAll] = useState(false);
  const cell = useCellStyles(theme);
  const styles = useMemo(
    () => ({
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
      },
      tabs: { flexDirection: "row" as const, gap: 4 },
      tab: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
      tabActive: { backgroundColor: theme.colors.surface2 },
      tabText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      tabTextActive: {
        color: theme.colors.foreground,
        fontWeight: "600" as const,
      },
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingVertical: 7,
        ...cell.rule,
      },
      route: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      count: { color: theme.colors.foreground, fontSize: 12, ...TABULAR },
      numbers: { alignItems: "flex-end" as const, minWidth: 96 },
    }),
    [theme, cell],
  );
  const pairs = dimension === "model" ? modelPairs : providerPairs;
  if (modelPairs.length === 0 && providerPairs.length === 0) return null;
  const visible = showAll ? pairs : pairs.slice(0, PAIR_LIMIT);
  const name = (value: string | null) => value ?? t("collab.unknownModel");
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.header}>
        <Text style={cell.label}>{t("collab.pairs")}</Text>
        <View style={styles.tabs}>
          {(["model", "provider"] as const).map((id) => {
            const active = id === dimension;
            return (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityLabel={`${t("collab.pairs")}: ${t(`collab.pairsBy.${id}`)}`}
                accessibilityState={{ selected: active }}
                onPress={() => setDimension(id)}
                style={[styles.tab, active ? styles.tabActive : null]}
              >
                <Text
                  style={[styles.tabText, active ? styles.tabTextActive : null]}
                >
                  {t(`collab.pairsBy.${id}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Text style={cell.hint}>{t(`collab.pairsHint.${dimension}`)}</Text>
      <View>
        {visible.map((pair) => (
          <View key={`${pair.parent}>${pair.child}`} style={styles.row}>
            <View style={styles.route}>
              <Text style={[cell.name, { flexShrink: 1 }]} numberOfLines={1}>
                {name(pair.parent)}
              </Text>
              <Icon
                name="ArrowRight"
                size={12}
                color={theme.colors.foregroundMuted}
              />
              <Text style={[cell.name, { flexShrink: 1 }]} numberOfLines={1}>
                {name(pair.child)}
              </Text>
              <Text style={styles.count}>
                {t("collab.pairCount", { count: pair.count })}
              </Text>
            </View>
            <View style={styles.numbers}>
              <Text style={cell.value}>{usd(pair.costUsd)}</Text>
              <Text style={cell.detail}>{short(pair.tokens)} tokens</Text>
            </View>
          </View>
        ))}
      </View>
      {pairs.length > PAIR_LIMIT ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setShowAll((value) => !value)}
          style={{ paddingVertical: 4 }}
        >
          <Text style={cell.link}>
            {showAll
              ? t("collab.showLess")
              : t("collab.showAll", { count: pairs.length })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
