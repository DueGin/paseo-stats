import type { TopologyEdge, TopologyNode } from "../shared/stats.ts";

export interface FoldedNode extends TopologyNode {
  // How many nodes this one stands for when it folds a column's long tail.
  folded: number;
}

export const OTHER_SUFFIX = ":other";
export const edgeId = (from: string, to: string) => `${from}>${to}`;

// Keeps the `limit - 1` costliest nodes of each column and folds the rest
// into one "other" node, merging their edges, so a wide layer stays legible.
export function foldColumns(
  nodes: readonly TopologyNode[],
  edges: readonly TopologyEdge[],
  limit: number,
): { nodes: FoldedNode[]; edges: TopologyEdge[] } {
  const columns = new Map<number, TopologyNode[]>();
  for (const node of nodes) {
    const column = columns.get(node.depth) ?? [];
    column.push(node);
    columns.set(node.depth, column);
  }
  const target = new Map<string, string>();
  const result: FoldedNode[] = [];
  for (const [depth, column] of [...columns].sort(([a], [b]) => a - b)) {
    if (column.length <= limit) {
      for (const node of column) {
        target.set(node.id, node.id);
        result.push({ ...node, folded: 0 });
      }
      continue;
    }
    const ranked = [...column].sort(
      (a, b) => b.costUsd - a.costUsd || b.count - a.count,
    );
    const kept = ranked.slice(0, limit - 1);
    const rest = ranked.slice(limit - 1);
    for (const node of kept) {
      target.set(node.id, node.id);
      result.push({ ...node, folded: 0 });
    }
    const other: FoldedNode = {
      id: `${depth}${OTHER_SUFFIX}`,
      key: null,
      depth,
      native: rest.every((node) => node.native),
      count: 0,
      tokens: 0,
      costUsd: 0,
      folded: rest.length,
    };
    for (const node of rest) {
      target.set(node.id, other.id);
      other.count += node.count;
      other.tokens += node.tokens;
      other.costUsd += node.costUsd;
    }
    result.push(other);
  }
  const merged = new Map<string, TopologyEdge>();
  for (const edge of edges) {
    const from = target.get(edge.from);
    const to = target.get(edge.to);
    if (!from || !to) continue;
    const id = edgeId(from, to);
    const found = merged.get(id);
    if (found) {
      found.count += edge.count;
      found.tokens += edge.tokens;
      found.costUsd += edge.costUsd;
    } else {
      merged.set(id, { ...edge, from, to });
    }
  }
  return { nodes: result, edges: [...merged.values()] };
}

export interface Highlight {
  nodes: Set<string>;
  edges: Set<string>;
}

// The chain the most money flowed down: the costliest root, then at each step
// the costliest outgoing edge. This is the one path the graph accents.
export function primaryPath(
  nodes: readonly Pick<TopologyNode, "id" | "depth" | "costUsd">[],
  edges: readonly Pick<TopologyEdge, "from" | "to" | "costUsd" | "count">[],
): Highlight {
  const path: Highlight = { nodes: new Set(), edges: new Set() };
  const targets = new Set(edges.map((edge) => edge.to));
  const roots = nodes.filter((node) => !targets.has(node.id));
  const outgoing = new Map<string, typeof edges>();
  for (const edge of edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
  }
  // Prefer the root whose whole downstream chain costs most.
  let start: string | null = null;
  let best = -1;
  for (const root of roots) {
    const spend =
      root.costUsd +
      (outgoing.get(root.id) ?? []).reduce((sum, e) => sum + e.costUsd, 0);
    if (spend > best) {
      best = spend;
      start = root.id;
    }
  }
  let current = start;
  while (current && !path.nodes.has(current)) {
    path.nodes.add(current);
    const next = [...(outgoing.get(current) ?? [])].sort(
      (a, b) => b.costUsd - a.costUsd || b.count - a.count,
    )[0];
    if (!next || path.nodes.has(next.to)) break;
    path.edges.add(edgeId(next.from, next.to));
    current = next.to;
  }
  return path;
}

export interface Reach extends Highlight {
  // Nodes reached, not counting the start.
  count: number;
  // Longest number of hops from the start.
  hops: number;
}

// Everything upstream or downstream of a node, as SeeCode's focus panel shows.
export function reach(
  edges: readonly Pick<TopologyEdge, "from" | "to">[],
  id: string,
  direction: "up" | "down",
): Reach {
  const depth = new Map([[id, 0]]);
  const seen = new Set<string>();
  const queue = [id];
  for (let i = 0; i < queue.length; i += 1) {
    for (const edge of edges) {
      const next =
        direction === "down"
          ? edge.from === queue[i]
            ? edge.to
            : null
          : edge.to === queue[i]
            ? edge.from
            : null;
      if (next === null) continue;
      seen.add(edgeId(edge.from, edge.to));
      if (!depth.has(next)) {
        depth.set(next, (depth.get(queue[i]) ?? 0) + 1);
        queue.push(next);
      }
    }
  }
  return {
    nodes: new Set(depth.keys()),
    edges: seen,
    count: depth.size - 1,
    hops: Math.max(0, ...depth.values()),
  };
}

export interface Point {
  x: number;
  y: number;
}

// A smooth S-curve with horizontal ends, sampled into short straight pieces
// (React Native draws lines as rotated views, not paths).
export function curvePoints(from: Point, to: Point, maxStep = 14): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dy) < 0.5) return [from, to];
  const steps = Math.max(
    4,
    Math.min(24, Math.ceil(Math.hypot(dx, dy) / maxStep)),
  );
  const c1 = { x: from.x + dx / 2, y: from.y };
  const c2 = { x: to.x - dx / 2, y: to.y };
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    points.push({
      x:
        u * u * u * from.x +
        3 * u * u * t * c1.x +
        3 * u * t * t * c2.x +
        t * t * t * to.x,
      y:
        u * u * u * from.y +
        3 * u * u * t * c1.y +
        3 * u * t * t * c2.y +
        t * t * t * to.y,
    });
  }
  return points;
}

// A right-angled connector for trees: out, down the trunk, then in.
export function elbowPoints(from: Point, to: Point, trunk = 0.5): Point[] {
  if (Math.abs(to.y - from.y) < 0.5) return [from, to];
  const x = from.x + (to.x - from.x) * trunk;
  return [from, { x, y: from.y }, { x, y: to.y }, to];
}

export function polylineLength(points: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    length += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  }
  return length;
}
