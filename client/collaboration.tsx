import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Collaboration, CollaborationTree } from "../shared/stats";
import { compact as short, percent, usd } from "./format";
import type { Translate } from "./i18n";
import { ModelRoles, PairList } from "./collaboration-models";
import { CollaborationTopology } from "./collaboration-topology";
import { TopologyGraph, type GraphNodeView } from "./topology-graph";
import { StatTile, TABULAR, cardStyle, sectionTitleStyle } from "./ui";

export interface CollaborationSectionProps {
  collaboration: Collaboration;
  totalCostUsd: number;
  onPickModel(model: string): void;
  navigation: PluginScreenProps["navigation"];
  theme: PluginTheme;
  compact: boolean;
  t: Translate;
}

export function CollaborationSection({
  collaboration: c,
  totalCostUsd,
  onPickModel,
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

      <CollaborationTopology topology={c.topology} theme={theme} t={t} />

      <ModelRoles
        models={c.models}
        onPick={onPickModel}
        theme={theme}
        compact={compact}
        t={t}
      />

      <PairList
        modelPairs={c.modelPairs}
        providerPairs={c.providerPairs}
        theme={theme}
        t={t}
      />

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

type TreeView = "list" | "graph";

function TreeRow({ tree, open, onToggle, navigation, theme, t }: TreeRowProps) {
  const [view, setView] = useState<TreeView>("list");
  const graphNodes = useMemo<GraphNodeView[]>(() => {
    if (view !== "graph") return [];
    const maxCost = Math.max(0, ...tree.members.map((m) => m.costUsd));
    return tree.members.map((member) => ({
      id: member.agentId,
      column: member.depth,
      parentId: member.parentId,
      title: member.title,
      subtitle: [
        member.model ?? member.provider,
        usd(member.costUsd),
        member.nativeSessions > 0
          ? t("collab.memberNative", { count: member.nativeSessions })
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      magnitude: maxCost > 0 ? member.costUsd / maxCost : 0,
      accessibilityLabel: t("collab.openAgent", { title: member.title }),
    }));
  }, [tree.members, view, t]);
  const graphEdges = useMemo(
    () =>
      tree.members.flatMap((member) =>
        member.parentId
          ? [{ from: member.parentId, to: member.agentId, weight: 1 }]
          : [],
      ),
    [tree.members],
  );
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
      views: {
        flexDirection: "row" as const,
        gap: 4,
        paddingHorizontal: 10,
        paddingTop: 6,
        paddingBottom: 2,
      },
      viewTab: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
      viewTabActive: { backgroundColor: theme.colors.surface2 },
      viewText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      viewTextActive: {
        color: theme.colors.foreground,
        fontWeight: "600" as const,
      },
      graph: { paddingHorizontal: 10, paddingVertical: 8, gap: 6 },
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
  const models =
    tree.models.slice(0, 4).join(" / ") +
    (tree.models.length > 4 ? ` +${tree.models.length - 4}` : "");
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
          {tree.models.length > 0 ? (
            <Text style={styles.meta} numberOfLines={1}>
              {t("collab.treeModels", { models })}
            </Text>
          ) : null}
        </View>
        <View style={styles.numbers}>
          <Text style={styles.cost}>{usd(tree.costUsd)}</Text>
          <Text style={styles.tokens}>{short(tree.tokens)} tokens</Text>
        </View>
      </Pressable>
      {open ? (
        <View style={styles.views}>
          {(["list", "graph"] as const).map((id) => {
            const active = id === view;
            return (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setView(id)}
                style={[styles.viewTab, active ? styles.viewTabActive : null]}
              >
                <Text
                  style={[
                    styles.viewText,
                    active ? styles.viewTextActive : null,
                  ]}
                >
                  {t(`collab.view.${id}`)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {open && view === "graph" ? (
        <View style={styles.graph}>
          {navigation ? (
            <Text style={styles.meta}>{t("collab.openHint")}</Text>
          ) : null}
          <TopologyGraph
            nodes={graphNodes}
            edges={graphEdges}
            mode="tree"
            columnTitle={(column) => t("collab.layer", { depth: column })}
            onPressNode={
              navigation
                ? (agentId) => navigation.openAgent({ agentId })
                : undefined
            }
            nodeWidth={260}
            nodeHeight={44}
            columnGap={48}
            theme={theme}
          />
        </View>
      ) : null}
      {open && view === "list" ? (
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
