import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Collaboration, TopologyNode } from "../shared/stats";
import { usd } from "./format";
import type { Translate } from "./i18n";
import {
  TopologyGraph,
  type GraphEdgeView,
  type GraphNodeView,
} from "./topology-graph";
import { TABULAR } from "./ui";

type Dimension = "model" | "provider";

function nodeName(node: TopologyNode | undefined, t: Translate) {
  const key = node?.key ?? t("collab.unknownModel");
  return node?.native ? t("collab.nativeNode", { name: key }) : key;
}

function nodeSummary(node: TopologyNode, t: Translate) {
  return t(node.native ? "collab.nodeSessions" : "collab.nodeAgents", {
    count: node.count,
    cost: usd(node.costUsd),
  });
}

export interface CollaborationTopologyProps {
  topology: Collaboration["topology"];
  theme: PluginTheme;
  t: Translate;
}

export function CollaborationTopology({
  topology,
  theme,
  t,
}: CollaborationTopologyProps) {
  const [dimension, setDimension] = useState<Dimension>("model");
  const [selected, setSelected] = useState<string | null>(null);
  const { nodes, edges } = topology[dimension];
  const styles = useMemo(
    () => ({
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 8,
      },
      label: { color: theme.colors.foregroundMuted, fontSize: 12 },
      hint: { color: theme.colors.foregroundMuted, fontSize: 11 },
      tabs: { flexDirection: "row" as const, gap: 4 },
      tab: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
      tabActive: { backgroundColor: theme.colors.surface2 },
      tabText: { color: theme.colors.foregroundMuted, fontSize: 12 },
      tabTextActive: {
        color: theme.colors.foreground,
        fontWeight: "600" as const,
      },
      detail: {
        gap: 4,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      detailTitle: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      detailLine: { color: theme.colors.foreground, fontSize: 12, ...TABULAR },
      empty: { color: theme.colors.foregroundMuted, fontSize: 13 },
    }),
    [theme],
  );

  const byId = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const name = (node: TopologyNode | undefined) => nodeName(node, t);

  const graphNodes = useMemo<GraphNodeView[]>(() => {
    const maxCost = Math.max(0, ...nodes.map((node) => node.costUsd));
    const maxCount = Math.max(0, ...nodes.map((node) => node.count));
    return nodes.map((node) => ({
      id: node.id,
      column: node.depth,
      title: nodeName(node, t),
      subtitle: nodeSummary(node, t),
      dashed: node.native,
      magnitude:
        maxCost > 0
          ? node.costUsd / maxCost
          : maxCount > 0
            ? node.count / maxCount
            : 0,
    }));
  }, [nodes, t]);
  const graphEdges = useMemo<GraphEdgeView[]>(
    () =>
      edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        weight: edge.count,
        label: t("collab.pairCount", { count: edge.count }),
      })),
    [edges, t],
  );

  const focus = selected ? byId.get(selected) : undefined;
  const switchTo = (next: Dimension) => {
    setDimension(next);
    setSelected(null);
  };

  return (
    <View style={{ gap: 6 }}>
      <View style={styles.header}>
        <Text style={styles.label}>{t("collab.topology")}</Text>
        <View style={styles.tabs}>
          {(["model", "provider"] as const).map((id) => {
            const active = id === dimension;
            return (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityLabel={`${t("collab.topology")}: ${t(`collab.pairsBy.${id}`)}`}
                accessibilityState={{ selected: active }}
                onPress={() => switchTo(id)}
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
      <Text style={styles.hint}>{t("collab.topologyHint")}</Text>
      {nodes.length === 0 ? (
        <Text style={styles.empty}>{t("collab.empty")}</Text>
      ) : (
        <TopologyGraph
          nodes={graphNodes}
          edges={graphEdges}
          mode="layered"
          nodeWidth={220}
          columnTitle={(column) => t("collab.layer", { depth: column })}
          selectedId={focus ? selected : null}
          onPressNode={(id) =>
            setSelected((current) => (current === id ? null : id))
          }
          theme={theme}
        />
      )}
      {focus ? (
        <View style={styles.detail}>
          <Text style={styles.detailTitle}>
            {name(focus)} · {t("collab.layer", { depth: focus.depth })} ·{" "}
            {nodeSummary(focus, t)}
          </Text>
          {(["in", "out"] as const).map((direction) => {
            const links = edges.filter((edge) =>
              direction === "in"
                ? edge.to === focus.id
                : edge.from === focus.id,
            );
            if (links.length === 0) return null;
            return (
              <View key={direction} style={{ gap: 2 }}>
                <Text style={styles.label}>
                  {t(
                    direction === "in" ? "collab.detailIn" : "collab.detailOut",
                  )}
                </Text>
                {links.map((edge) => (
                  <Text
                    key={`${edge.from}>${edge.to}`}
                    style={styles.detailLine}
                  >
                    {t("collab.detailEdge", {
                      name: name(
                        byId.get(direction === "in" ? edge.from : edge.to),
                      ),
                      count: edge.count,
                      cost: usd(edge.costUsd),
                    })}
                  </Text>
                ))}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
