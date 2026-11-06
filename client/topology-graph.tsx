import type { PluginTheme } from "@getpaseo/plugin";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import {
  layoutGraph,
  segmentBox,
  type LayoutEdge,
  type LayoutNode,
  type PlacedEdge,
} from "./graph-layout";
import {
  curvePoints,
  edgeId,
  elbowPoints,
  type Highlight,
  type Point,
} from "./topology";

export interface GraphNodeView extends LayoutNode {
  title: string;
  subtitle?: string;
  dashed?: boolean;
  // 0..1, drawn as a bar along the bottom of the node.
  magnitude?: number;
  accessibilityLabel?: string;
}

export interface GraphEdgeView extends LayoutEdge {
  label?: string;
}

export interface TopologyGraphProps {
  nodes: readonly GraphNodeView[];
  edges: readonly GraphEdgeView[];
  mode: "layered" | "tree";
  columnTitle(column: number): string;
  selectedId?: string | null;
  onPressNode?(id: string): void;
  // The path drawn in the accent colour; everything else stays neutral.
  primary?: Highlight | null;
  // A lens or reach set that lights these and dims the rest.
  highlight?: Highlight | null;
  nodeWidth?: number;
  nodeHeight?: number;
  columnGap?: number;
  theme: PluginTheme;
}

const HEADER = 22;
const LABEL_WIDTH = 52;
const ARROW = 6;
const COLUMN_MS = 140;
const TOKEN = 8;
const nativeDriver = Platform.OS !== "web";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => live && setReduced(value))
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

function neighbours(edges: readonly LayoutEdge[], id: string): Highlight {
  const result: Highlight = { nodes: new Set([id]), edges: new Set() };
  for (const edge of edges) {
    if (edge.from === id || edge.to === id) {
      result.nodes.add(edge.from === id ? edge.to : edge.from);
      result.edges.add(edgeId(edge.from, edge.to));
    }
  }
  return result;
}

export function TopologyGraph({
  nodes,
  edges,
  mode,
  columnTitle,
  selectedId = null,
  onPressNode,
  primary = null,
  highlight = null,
  nodeWidth = 200,
  nodeHeight = 48,
  columnGap = 88,
  theme,
}: TopologyGraphProps) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();
  const layout = useMemo(
    () =>
      layoutGraph(nodes, edges, {
        mode,
        nodeWidth,
        nodeHeight,
        columnGap,
        rowGap: mode === "tree" ? 8 : 14,
        minStroke: 1.5,
        maxStroke: mode === "tree" ? 1.5 : 7,
      }),
    [nodes, edges, mode, nodeWidth, nodeHeight, columnGap],
  );
  const paths = useMemo(() => {
    const result = new Map<string, Point[]>();
    for (const edge of layout.edges) {
      const from = { x: edge.x1, y: edge.y1 };
      const to = { x: edge.x2 - ARROW, y: edge.y2 };
      result.set(
        edgeId(edge.from, edge.to),
        mode === "tree" ? elbowPoints(from, to, 0.5) : curvePoints(from, to),
      );
    }
    return result;
  }, [layout, mode]);
  const labels = useMemo(
    () =>
      new Map(edges.map((edge) => [edgeId(edge.from, edge.to), edge.label])),
    [edges],
  );
  const byId = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
  const columns = layout.columns.length;

  // Hover traces a node's links; otherwise a lens or reach set; otherwise the
  // selected node's links. Null means nothing is in focus.
  const focusId = hoverId ?? (highlight ? null : selectedId);
  const focus = useMemo<Highlight | null>(
    () =>
      hoverId
        ? neighbours(edges, hoverId)
        : highlight
          ? highlight
          : selectedId
            ? neighbours(edges, selectedId)
            : null,
    [edges, hoverId, highlight, selectedId],
  );

  // Columns fade and rise in from the root outward, then one token runs the
  // primary path. Reduced motion shows the end frame.
  const reveal = useRef(new Animated.Value(columns)).current;
  const token = useRef(new Animated.Value(0)).current;
  const signature = `${mode}:${nodes.map((n) => n.id).join(",")}`;
  const tokenRoute = useMemo(() => {
    if (!primary || primary.edges.size === 0) return null;
    const points: Point[] = [];
    const ordered = layout.edges
      .filter((edge) => primary.edges.has(edgeId(edge.from, edge.to)))
      .sort((a, b) => a.x1 - b.x1);
    for (const edge of ordered) {
      const route = paths.get(edgeId(edge.from, edge.to)) ?? [];
      points.push(...route, { x: edge.x2, y: edge.y2 });
    }
    if (points.length < 2) return null;
    const lengths = [0];
    for (let i = 1; i < points.length; i += 1) {
      lengths.push(
        lengths[i - 1] +
          Math.hypot(
            points[i].x - points[i - 1].x,
            points[i].y - points[i - 1].y,
          ),
      );
    }
    const total = lengths[lengths.length - 1];
    if (total <= 0) return null;
    // Interpolation needs strictly increasing input; drop repeated points.
    const input: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    points.forEach((point, i) => {
      const at = lengths[i] / total;
      if (input.length && at <= input[input.length - 1]) return;
      input.push(at);
      xs.push(point.x - TOKEN / 2);
      ys.push(point.y - TOKEN / 2);
    });
    return input.length >= 2
      ? { input, xs, ys, duration: Math.max(1200, total * 2.5) }
      : null;
  }, [primary, layout, paths]);

  useEffect(() => {
    if (reducedMotion) {
      reveal.setValue(columns);
      token.setValue(1);
      return;
    }
    reveal.setValue(0);
    token.setValue(0);
    const sequence = Animated.sequence([
      Animated.timing(reveal, {
        toValue: columns,
        duration: Math.max(1, columns) * COLUMN_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: nativeDriver,
      }),
      Animated.timing(token, {
        toValue: 1,
        duration: tokenRoute?.duration ?? 0,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: nativeDriver,
      }),
    ]);
    sequence.start();
    return () => sequence.stop();
    // Replays only when the graph itself changes.
  }, [signature, reducedMotion]);

  const columnStyle = (column: number) => ({
    opacity: reveal.interpolate({
      inputRange: [column, column + 1],
      outputRange: [0, 1],
      extrapolate: "clamp" as const,
    }),
    transform: [
      {
        translateY: reveal.interpolate({
          inputRange: [column, column + 1],
          outputRange: [6, 0],
          extrapolate: "clamp" as const,
        }),
      },
    ],
  });

  const styles = useMemo(
    () => ({
      columnTitle: {
        position: "absolute" as const,
        top: 0,
        width: nodeWidth,
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },
      node: {
        position: "absolute" as const,
        width: nodeWidth,
        height: nodeHeight,
        borderRadius: 8,
        borderWidth: 1,
        paddingHorizontal: 10,
        justifyContent: "center" as const,
        overflow: "hidden" as const,
        backgroundColor: theme.colors.surface1,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      subtitle: { color: theme.colors.foregroundMuted, fontSize: 11 },
      magnitude: {
        position: "absolute" as const,
        left: 0,
        bottom: 0,
        height: 3,
      },
      label: {
        position: "absolute" as const,
        width: LABEL_WIDTH,
        alignItems: "center" as const,
      },
      labelText: {
        color: theme.colors.foreground,
        fontSize: 10,
        paddingHorizontal: 5,
        paddingVertical: 1,
        borderRadius: 8,
        overflow: "hidden" as const,
        backgroundColor: theme.colors.surface2,
      },
      layer: {
        position: "absolute" as const,
        top: 0,
        left: 0,
        width: layout.width,
        height: layout.height,
      },
    }),
    [theme, nodeWidth, nodeHeight, layout.width, layout.height],
  );

  // How an edge is drawn: colour and opacity.
  const edgeLook = (edge: PlacedEdge) => {
    const id = edgeId(edge.from, edge.to);
    const isPrimary = primary?.edges.has(id) ?? false;
    if (!focus) {
      return isPrimary
        ? { color: theme.colors.accent, opacity: 0.9, lit: true }
        : { color: theme.colors.foregroundMuted, opacity: 0.4, lit: false };
    }
    if (!focus.edges.has(id)) {
      return { color: theme.colors.foregroundMuted, opacity: 0.1, lit: false };
    }
    // Hover and selection trace direction: outgoing in the accent, incoming
    // in the text colour. A lens or reach set lights its edges in the accent.
    const incoming = focusId !== null && edge.to === focusId;
    return {
      color: incoming ? theme.colors.foreground : theme.colors.accent,
      opacity: 0.95,
      lit: true,
    };
  };

  const edgesByColumn = (column: number) =>
    layout.edges.filter(
      (edge) => (layout.nodes.get(edge.to)?.x ?? -1) === layout.columns[column],
    );

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <View style={{ width: layout.width, height: HEADER + layout.height }}>
        {layout.columns.map((x, column) => (
          <Text
            key={column}
            style={[styles.columnTitle, { left: x }]}
            numberOfLines={1}
          >
            {columnTitle(column)}
          </Text>
        ))}
        <View
          style={{
            position: "absolute",
            top: HEADER,
            left: 0,
            width: layout.width,
            height: layout.height,
          }}
        >
          {layout.columns.map((_, column) => (
            <Animated.View
              key={`edges:${column}`}
              pointerEvents="none"
              style={[styles.layer, columnStyle(column)]}
            >
              {edgesByColumn(column).map((edge) => {
                const id = edgeId(edge.from, edge.to);
                const look = edgeLook(edge);
                const points = paths.get(id) ?? [];
                const stroke = look.lit
                  ? Math.max(edge.stroke, 2)
                  : edge.stroke;
                const tip = points[points.length - 1];
                return (
                  <View
                    key={id}
                    needsOffscreenAlphaCompositing
                    style={[styles.layer, { opacity: look.opacity }]}
                  >
                    {points.slice(1).map((point, i) => {
                      const box = segmentBox({
                        x1: points[i].x,
                        y1: points[i].y,
                        x2: point.x,
                        y2: point.y,
                      });
                      // Overlap neighbours by the stroke so joints stay round.
                      const length = box.length + stroke;
                      return (
                        <View
                          key={i}
                          style={{
                            position: "absolute",
                            left: box.centerX - length / 2,
                            top: box.centerY - stroke / 2,
                            width: length,
                            height: stroke,
                            borderRadius: stroke / 2,
                            backgroundColor: look.color,
                            transform: [{ rotate: `${box.angle}deg` }],
                          }}
                        />
                      );
                    })}
                    {tip ? (
                      <View
                        style={{
                          position: "absolute",
                          left: tip.x - 1,
                          top: tip.y - ARROW * 0.7,
                          width: 0,
                          height: 0,
                          borderTopWidth: ARROW * 0.7,
                          borderBottomWidth: ARROW * 0.7,
                          borderLeftWidth: ARROW + 1,
                          borderTopColor: "transparent",
                          borderBottomColor: "transparent",
                          borderLeftColor: look.color,
                        }}
                      />
                    ) : null}
                  </View>
                );
              })}
              {edgesByColumn(column).map((edge) => {
                const id = edgeId(edge.from, edge.to);
                const label = labels.get(id);
                if (!label) return null;
                if (focus && !focus.edges.has(id)) return null;
                return (
                  <View
                    key={`label:${id}`}
                    style={[
                      styles.label,
                      {
                        left: edge.labelX - LABEL_WIDTH / 2,
                        top: edge.labelY - 8,
                      },
                    ]}
                  >
                    <Text style={styles.labelText} numberOfLines={1}>
                      {label}
                    </Text>
                  </View>
                );
              })}
            </Animated.View>
          ))}
          {tokenRoute && !reducedMotion && !focus ? (
            <Animated.View
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: TOKEN,
                height: TOKEN,
                borderRadius: TOKEN / 2,
                borderWidth: 2,
                borderColor: theme.colors.surface1,
                backgroundColor: theme.colors.accent,
                opacity: token.interpolate({
                  inputRange: [0, 0.02, 0.95, 1],
                  outputRange: [0, 1, 1, 0],
                }),
                transform: [
                  {
                    translateX: token.interpolate({
                      inputRange: tokenRoute.input,
                      outputRange: tokenRoute.xs,
                    }),
                  },
                  {
                    translateY: token.interpolate({
                      inputRange: tokenRoute.input,
                      outputRange: tokenRoute.ys,
                    }),
                  },
                ],
              }}
            />
          ) : null}
          {layout.columns.map((x, column) => (
            <Animated.View
              key={`nodes:${column}`}
              pointerEvents="box-none"
              style={[styles.layer, columnStyle(column)]}
            >
              {[...layout.nodes.values()]
                .filter((placed) => placed.x === x)
                .map((placed) => {
                  const node = byId.get(placed.id);
                  if (!node) return null;
                  const selected = node.id === selectedId;
                  const hovered = node.id === hoverId;
                  const onPrimary = primary?.nodes.has(node.id) ?? false;
                  const dimmed = focus !== null && !focus.nodes.has(node.id);
                  return (
                    <Pressable
                      key={node.id}
                      accessibilityRole="button"
                      accessibilityLabel={
                        node.accessibilityLabel ??
                        [node.title, node.subtitle].filter(Boolean).join(", ")
                      }
                      accessibilityState={{ selected }}
                      disabled={!onPressNode}
                      onPress={() => onPressNode?.(node.id)}
                      onHoverIn={() => setHoverId(node.id)}
                      onHoverOut={() =>
                        setHoverId((current) =>
                          current === node.id ? null : current,
                        )
                      }
                      style={[
                        styles.node,
                        {
                          left: placed.x,
                          top: placed.y,
                          borderStyle: node.dashed ? "dashed" : "solid",
                          borderColor:
                            selected || hovered
                              ? theme.colors.accent
                              : theme.colors.border,
                          borderWidth: selected ? 2 : 1,
                          opacity: dimmed ? 0.35 : 1,
                        },
                      ]}
                    >
                      <Text style={styles.title} numberOfLines={1}>
                        {node.title}
                      </Text>
                      {node.subtitle ? (
                        <Text style={styles.subtitle} numberOfLines={1}>
                          {node.subtitle}
                        </Text>
                      ) : null}
                      {node.magnitude ? (
                        <View
                          style={[
                            styles.magnitude,
                            {
                              width: `${Math.max(4, Math.min(100, node.magnitude * 100))}%`,
                              backgroundColor: onPrimary
                                ? theme.colors.accent
                                : theme.colors.foregroundMuted,
                              opacity: onPrimary ? 1 : 0.45,
                            },
                          ]}
                        />
                      ) : null}
                    </Pressable>
                  );
                })}
            </Animated.View>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
