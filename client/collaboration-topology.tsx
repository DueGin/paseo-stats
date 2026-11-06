import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Collaboration, TopologyEdge } from "../shared/stats";
import { percent, usd } from "./format";
import type { PlainKey, Translate } from "./i18n";
import {
  TopologyGraph,
  type GraphEdgeView,
  type GraphNodeView,
} from "./topology-graph";
import {
  foldColumns,
  primaryPath,
  reach,
  type FoldedNode,
  type Highlight,
} from "./topology";
import { TABULAR } from "./ui";

type Dimension = "model" | "provider";
type Lens = "all" | "primary" | "native";
type Direction = "up" | "down";

// SeeCode's budget: a column past this many nodes folds its long tail.
const COLUMN_LIMIT = 6;

const LENSES: { id: Lens; label: PlainKey }[] = [
  { id: "all", label: "topo.lens.all" },
  { id: "primary", label: "topo.lens.primary" },
  { id: "native", label: "topo.lens.native" },
];

function nodeName(node: FoldedNode | undefined, t: Translate) {
  if (node?.folded) return t("topo.otherTitle");
  const key = node?.key ?? t("collab.unknownModel");
  return node?.native ? t("collab.nativeNode", { name: key }) : key;
}

function nodeSummary(node: FoldedNode, t: Translate) {
  const summary = t(node.native ? "collab.nodeSessions" : "collab.nodeAgents", {
    count: node.count,
    cost: usd(node.costUsd),
  });
  return node.folded
    ? `${t("topo.other", { count: node.folded })} · ${summary}`
    : summary;
}

export interface CollaborationTopologyProps {
  topology: Collaboration["topology"];
  onPick(dimension: Dimension, key: string): void;
  theme: PluginTheme;
  t: Translate;
}

export function CollaborationTopology({
  topology,
  onPick,
  theme,
  t,
}: CollaborationTopologyProps) {
  const [dimension, setDimension] = useState<Dimension>("model");
  const [selected, setSelected] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("all");
  const [direction, setDirection] = useState<Direction | null>(null);
  const { nodes, edges } = useMemo(
    () =>
      foldColumns(
        topology[dimension].nodes,
        topology[dimension].edges,
        COLUMN_LIMIT,
      ),
    [topology, dimension],
  );
  const primary = useMemo(() => primaryPath(nodes, edges), [nodes, edges]);
  const byId = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const collaborationCost = useMemo(
    () => nodes.reduce((sum, node) => sum + node.costUsd, 0),
    [nodes],
  );

  const styles = useMemo(
    () => ({
      header: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
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
      legend: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 14,
      },
      legendItem: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      detail: {
        gap: 6,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      detailHead: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: 8,
      },
      detailTitle: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      detailLine: { color: theme.colors.foreground, fontSize: 12, ...TABULAR },
      reachRow: { flexDirection: "row" as const, gap: 8 },
      reach: {
        flex: 1,
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: theme.colors.border,
      },
      reachOn: { borderColor: theme.colors.accent },
      reachCount: {
        color: theme.colors.accent,
        fontSize: 12,
        fontWeight: "600" as const,
        ...TABULAR,
      },
      link: { color: theme.colors.accent, fontSize: 12 },
      relation: { paddingVertical: 2 },
      empty: { color: theme.colors.foregroundMuted, fontSize: 13 },
    }),
    [theme],
  );

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
  const reachOf = useMemo(
    () =>
      focus
        ? {
            up: reach(edges, focus.id, "up"),
            down: reach(edges, focus.id, "down"),
          }
        : null,
    [edges, focus],
  );
  const highlight = useMemo<Highlight | null>(() => {
    if (focus && direction && reachOf) return reachOf[direction];
    if (lens === "primary") return primary;
    if (lens === "native") {
      const ids = new Set(nodes.filter((n) => n.native).map((n) => n.id));
      const lit: Highlight = { nodes: new Set(ids), edges: new Set() };
      for (const edge of edges) {
        if (ids.has(edge.to)) {
          lit.edges.add(`${edge.from}>${edge.to}`);
          lit.nodes.add(edge.from);
        }
      }
      return lit;
    }
    return null;
  }, [focus, direction, reachOf, lens, primary, nodes, edges]);

  const switchTo = (next: Dimension) => {
    setDimension(next);
    setSelected(null);
    setDirection(null);
  };
  const select = (id: string | null) => {
    setSelected((current) => (current === id ? null : id));
    setDirection(null);
  };

  const relations = (kind: "in" | "out") =>
    focus
      ? edges.filter((edge) =>
          kind === "in" ? edge.to === focus.id : edge.from === focus.id,
        )
      : [];

  const relationRow = (edge: TopologyEdge, kind: "in" | "out") => {
    const other = byId.get(kind === "in" ? edge.from : edge.to);
    return (
      <Pressable
        key={`${edge.from}>${edge.to}`}
        accessibilityRole="button"
        onPress={() => other && select(other.id)}
        style={styles.relation}
      >
        <Text style={styles.detailLine}>
          {kind === "in" ? "← " : "→ "}
          {t("collab.detailEdge", {
            name: nodeName(other, t),
            count: edge.count,
            cost: usd(edge.costUsd),
          })}
        </Text>
      </Pressable>
    );
  };

  const swatch = (kind: "weight" | "primary" | "native" | "spend") => {
    switch (kind) {
      case "weight":
        return (
          <View style={{ gap: 2 }}>
            <View
              style={{
                width: 18,
                height: 1.5,
                borderRadius: 1,
                backgroundColor: theme.colors.foregroundMuted,
              }}
            />
            <View
              style={{
                width: 18,
                height: 5,
                borderRadius: 3,
                backgroundColor: theme.colors.foregroundMuted,
              }}
            />
          </View>
        );
      case "primary":
        return (
          <View
            style={{
              width: 18,
              height: 3,
              borderRadius: 2,
              backgroundColor: theme.colors.accent,
            }}
          />
        );
      case "native":
        return (
          <View
            style={{
              width: 16,
              height: 11,
              borderRadius: 3,
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: theme.colors.foregroundMuted,
            }}
          />
        );
      case "spend":
        return (
          <View
            style={{
              width: 16,
              height: 11,
              borderRadius: 3,
              borderWidth: 1,
              borderColor: theme.colors.border,
              justifyContent: "flex-end",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                width: 10,
                height: 2,
                backgroundColor: theme.colors.foregroundMuted,
              }}
            />
          </View>
        );
    }
  };

  const legend: { kind: Parameters<typeof swatch>[0]; label: PlainKey }[] = [
    { kind: "primary", label: "topo.legendPrimary" },
    { kind: "weight", label: "topo.legendWeight" },
    { kind: "native", label: "topo.legendNative" },
    { kind: "spend", label: "topo.legendSpend" },
  ];

  const pickable =
    focus && !focus.folded && focus.key !== null && !focus.native;

  return (
    <View style={{ gap: 8 }}>
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

      <View style={styles.legend}>
        {legend.map((item) => (
          <View key={item.kind} style={styles.legendItem}>
            {swatch(item.kind)}
            <Text style={styles.hint}>{t(item.label)}</Text>
          </View>
        ))}
      </View>

      {nodes.length === 0 ? (
        <Text style={styles.empty}>{t("collab.empty")}</Text>
      ) : (
        <>
          <View style={styles.header}>
            <Text style={styles.hint}>{t("topo.hoverHint")}</Text>
            <View style={styles.tabs} accessibilityRole="radiogroup">
              <Text style={[styles.hint, { alignSelf: "center" }]}>
                {t("topo.lensLabel")}
              </Text>
              {LENSES.map(({ id, label }) => {
                const active = id === lens;
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active }}
                    onPress={() => {
                      setLens(id);
                      setDirection(null);
                    }}
                    style={[styles.tab, active ? styles.tabActive : null]}
                  >
                    <Text
                      style={[
                        styles.tabText,
                        active ? styles.tabTextActive : null,
                      ]}
                    >
                      {t(label)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <TopologyGraph
            nodes={graphNodes}
            edges={graphEdges}
            mode="layered"
            nodeWidth={220}
            columnTitle={(column) => t("collab.layer", { depth: column })}
            selectedId={focus ? selected : null}
            onPressNode={(id) => select(id)}
            primary={primary}
            highlight={highlight}
            theme={theme}
          />
        </>
      )}

      {focus && reachOf ? (
        <View style={styles.detail}>
          <View style={styles.detailHead}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.detailTitle}>
                {nodeName(focus, t)} ·{" "}
                {t("collab.layer", { depth: focus.depth })}
              </Text>
              <Text style={styles.hint}>
                {nodeSummary(focus, t)}
                {collaborationCost > 0
                  ? ` · ${t("topo.share", {
                      share: percent(focus.costUsd, collaborationCost),
                    })}`
                  : ""}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("topo.close")}
              onPress={() => select(null)}
            >
              <Text style={styles.link}>{t("topo.close")}</Text>
            </Pressable>
          </View>
          <View style={styles.reachRow}>
            {(["up", "down"] as const).map((id) => {
              const result = reachOf[id];
              const on = direction === id;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: on,
                    disabled: result.count === 0,
                  }}
                  disabled={result.count === 0}
                  onPress={() => setDirection(on ? null : id)}
                  style={[
                    styles.reach,
                    on ? styles.reachOn : null,
                    { opacity: result.count === 0 ? 0.45 : 1 },
                  ]}
                >
                  <Text style={styles.detailLine}>
                    {t(id === "up" ? "topo.reachUp" : "topo.reachDown")}
                  </Text>
                  <Text style={styles.reachCount}>{result.count}</Text>
                </Pressable>
              );
            })}
          </View>
          {direction && reachOf[direction].count > 0 ? (
            <Text style={styles.hint}>
              {t("topo.reachSummary", {
                count: reachOf[direction].count,
                hops: reachOf[direction].hops,
              })}
            </Text>
          ) : null}
          {(["in", "out"] as const).map((kind) => {
            const links = relations(kind);
            if (links.length === 0) return null;
            return (
              <View key={kind} style={{ gap: 2 }}>
                <Text style={styles.label}>
                  {t(kind === "in" ? "collab.detailIn" : "collab.detailOut")}
                </Text>
                {links.map((edge) => relationRow(edge, kind))}
              </View>
            );
          })}
          {pickable ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onPick(dimension, focus.key as string)}
            >
              <Text style={styles.link}>
                {t("topo.filter", { name: focus.key as string })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
