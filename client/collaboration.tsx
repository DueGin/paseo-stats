import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Collaboration, CollaborationTree } from "../shared/stats";
import { compact as short, percent, usd } from "./format";
import type { Translate } from "./i18n";
import { StatTile, TABULAR, cardStyle, sectionTitleStyle } from "./ui";

export interface CollaborationSectionProps {
  collaboration: Collaboration;
  totalCostUsd: number;
  navigation: PluginScreenProps["navigation"];
  theme: PluginTheme;
  compact: boolean;
  t: Translate;
}

export function CollaborationSection({
  collaboration: c,
  totalCostUsd,
  navigation,
  theme,
  compact,
  t,
}: CollaborationSectionProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const styles = useMemo(
    () => ({
      card: cardStyle(theme, compact),
      title: sectionTitleStyle(theme),
      subtitle: { color: theme.colors.foregroundMuted, fontSize: 12 },
      tiles: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 12,
      },
      label: { color: theme.colors.foregroundMuted, fontSize: 12 },
      pairs: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
      },
      pair: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 999,
        backgroundColor: theme.colors.surface2,
      },
      pairText: { color: theme.colors.foreground, fontSize: 12 },
      pairCount: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        ...TABULAR,
      },
      empty: { color: theme.colors.foregroundMuted, fontSize: 13 },
    }),
    [theme, compact],
  );

  return (
    <View style={styles.card}>
      <View style={{ gap: 2 }}>
        <Text style={styles.title}>{t("collab.title")}</Text>
        <Text style={styles.subtitle}>{t("collab.subtitle")}</Text>
      </View>
      <View style={styles.tiles}>
        <StatTile
          label={t("collab.trees")}
          value={String(c.trees)}
          detail={t("collab.treesDetail", { agents: c.activeAgents })}
          basis="30%"
          theme={theme}
          compact={compact}
        />
        <StatTile
          label={t("collab.children")}
          value={String(c.childAgents)}
          detail={t("collab.childrenDetail", {
            orchestrators: c.orchestrators,
          })}
          basis="30%"
          theme={theme}
          compact={compact}
        />
        <StatTile
          label={t("collab.fanout")}
          value={c.avgFanout ? c.avgFanout.toFixed(1) : "0"}
          detail={t("collab.fanoutDetail", { max: c.maxFanout })}
          basis="30%"
          theme={theme}
          compact={compact}
        />
        <StatTile
          label={t("collab.depth")}
          value={String(c.maxDepth)}
          basis="30%"
          theme={theme}
          compact={compact}
        />
        <StatTile
          label={t("collab.childShare")}
          value={percent(c.childCostUsd, totalCostUsd)}
          detail={t("collab.spend", {
            cost: usd(c.childCostUsd),
            tokens: short(c.childTokens),
          })}
          basis="30%"
          theme={theme}
          compact={compact}
        />
        <StatTile
          label={t("collab.native")}
          value={String(c.nativeSessions)}
          detail={t("collab.spend", {
            cost: usd(c.nativeCostUsd),
            tokens: short(c.nativeTokens),
          })}
          basis="30%"
          theme={theme}
          compact={compact}
        />
      </View>

      {c.pairs.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={styles.label}>{t("collab.pairs")}</Text>
          <View style={styles.pairs}>
            {c.pairs.map((pair) => (
              <View key={`${pair.parent}>${pair.child}`} style={styles.pair}>
                <Text style={styles.pairText}>{pair.parent}</Text>
                <Icon
                  name="ArrowRight"
                  size={12}
                  color={theme.colors.foregroundMuted}
                />
                <Text style={styles.pairText}>{pair.child}</Text>
                <Text style={styles.pairCount}>
                  {t("collab.pairCount", { count: pair.count })}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <Text style={styles.label}>{t("collab.topTrees")}</Text>
        {c.topTrees.length === 0 ? (
          <Text style={styles.empty}>{t("collab.empty")}</Text>
        ) : (
          c.topTrees.map((tree) => (
            <TreeRow
              key={tree.rootId}
              tree={tree}
              open={expanded === tree.rootId}
              onToggle={() =>
                setExpanded((current) =>
                  current === tree.rootId ? null : tree.rootId,
                )
              }
              navigation={navigation}
              theme={theme}
              t={t}
            />
          ))
        )}
      </View>
    </View>
  );
}

interface TreeRowProps {
  tree: CollaborationTree;
  open: boolean;
  onToggle(): void;
  navigation: PluginScreenProps["navigation"];
  theme: PluginTheme;
  t: Translate;
}

function TreeRow({ tree, open, onToggle, navigation, theme, t }: TreeRowProps) {
  const styles = useMemo(
    () => ({
      box: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 10,
        backgroundColor: theme.colors.surface0,
      },
      head: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        padding: 10,
      },
      text: { flex: 1, minWidth: 0, gap: 2 },
      title: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "500" as const,
      },
      meta: { color: theme.colors.foregroundMuted, fontSize: 11 },
      numbers: { alignItems: "flex-end" as const, gap: 2 },
      cost: { color: theme.colors.foreground, fontSize: 13, ...TABULAR },
      tokens: { color: theme.colors.foregroundMuted, fontSize: 11, ...TABULAR },
      members: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        paddingVertical: 4,
      },
      member: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 10,
        paddingVertical: 6,
        paddingRight: 10,
      },
    }),
    [theme],
  );
  const meta = [
    tree.projectName,
    t("collab.treeMeta", {
      agents: tree.agents,
      depth: tree.depth,
      providers: tree.providers.join(" / "),
    }),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={styles.box}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("collab.expand", { title: tree.title })}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={styles.head}
      >
        <Icon
          name={open ? "ChevronDown" : "ChevronRight"}
          size={14}
          color={theme.colors.foregroundMuted}
        />
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={1}>
            {tree.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <View style={styles.numbers}>
          <Text style={styles.cost}>{usd(tree.costUsd)}</Text>
          <Text style={styles.tokens}>{short(tree.tokens)} tokens</Text>
        </View>
      </Pressable>
      {open ? (
        <View style={styles.members}>
          {tree.members.map((member) => {
            const details = [
              member.provider,
              member.model,
              member.nativeSessions > 0
                ? t("collab.memberNative", { count: member.nativeSessions })
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Pressable
                key={member.agentId}
                accessibilityRole={navigation ? "link" : "text"}
                accessibilityLabel={t("collab.openAgent", {
                  title: member.title,
                })}
                disabled={!navigation}
                onPress={() =>
                  navigation?.openAgent({ agentId: member.agentId })
                }
                style={[styles.member, { paddingLeft: 34 + member.depth * 16 }]}
              >
                <View style={styles.text}>
                  <Text style={styles.title} numberOfLines={1}>
                    {member.title}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {details}
                  </Text>
                </View>
                <View style={styles.numbers}>
                  <Text style={styles.cost}>{usd(member.costUsd)}</Text>
                  <Text style={styles.tokens}>
                    {short(member.tokens)} tokens
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
