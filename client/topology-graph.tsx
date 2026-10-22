import type { PluginTheme } from "@getpaseo/plugin";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import {
  layoutGraph,
  segmentBox,
  type LayoutEdge,
  type LayoutNode,
} from "./graph-layout";

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
  nodeWidth?: number;
  nodeHeight?: number;
  columnGap?: number;
  theme: PluginTheme;
}

const HEADER = 22;
const LABEL_WIDTH = 52;

export function TopologyGraph({
  nodes,
  edges,
  mode,
  columnTitle,
  selectedId = null,
  onPressNode,
  nodeWidth = 200,
  nodeHeight = 48,
  columnGap = 88,
  theme,
}: TopologyGraphProps) {
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
  const neighbours = useMemo(() => {
    if (!selectedId) return null;
    const ids = new Set([selectedId]);
    for (const edge of edges) {
      if (edge.from === selectedId) ids.add(edge.to);
      if (edge.to === selectedId) ids.add(edge.from);
    }
    return ids;
  }, [edges, selectedId]);
  const labels = useMemo(
    () => new Map(edges.map((edge) => [`${edge.from}>${edge.to}`, edge.label])),
    [edges],
  );
  const byId = useMemo(
    () => new Map(nodes.map((node) => [node.id, node])),
    [nodes],
  );
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
        backgroundColor: theme.colors.accent,
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
    }),
    [theme, nodeWidth, nodeHeight],
  );

  const edgeActive = (from: string, to: string) =>
    !selectedId || from === selectedId || to === selectedId;

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
          {layout.edges.map((edge) => {
            const box = segmentBox(edge);
            const active = edgeActive(edge.from, edge.to);
            return (
              <View
                key={`${edge.from}>${edge.to}`}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: box.centerX - box.length / 2,
                  top: box.centerY - edge.stroke / 2,
                  width: box.length,
                  height: edge.stroke,
                  borderRadius: edge.stroke / 2,
                  backgroundColor: theme.colors.accent,
                  opacity: !active ? 0.1 : selectedId ? 0.9 : 0.45,
                  transform: [{ rotate: `${box.angle}deg` }],
                }}
              />
            );
          })}
          {layout.edges.map((edge) => {
            const label = labels.get(`${edge.from}>${edge.to}`);
            if (!label || !edgeActive(edge.from, edge.to)) return null;
            return (
              <View
                key={`label:${edge.from}>${edge.to}`}
                pointerEvents="none"
                style={[
                  styles.label,
                  { left: edge.labelX - LABEL_WIDTH / 2, top: edge.labelY - 8 },
                ]}
              >
                <Text style={styles.labelText} numberOfLines={1}>
                  {label}
                </Text>
              </View>
            );
          })}
          {[...layout.nodes.values()].map((placed) => {
            const node = byId.get(placed.id);
            if (!node) return null;
            const selected = node.id === selectedId;
            const dimmed = neighbours !== null && !neighbours.has(node.id);
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
                style={[
                  styles.node,
                  {
                    left: placed.x,
                    top: placed.y,
                    borderStyle: node.dashed ? "dashed" : "solid",
                    borderColor: selected
                      ? theme.colors.accent
                      : theme.colors.border,
                    borderWidth: selected ? 2 : 1,
                    opacity: dimmed ? 0.4 : 1,
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
                      },
                    ]}
                  />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}
