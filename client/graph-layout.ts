export interface LayoutNode {
  id: string;
  column: number;
  // Tree mode only: the node this one hangs from.
  parentId?: string | null;
}

export interface LayoutEdge {
  from: string;
  to: string;
  weight: number;
}

export interface LayoutOptions {
  // "layered" reorders columns to cut crossings; "tree" keeps the given
  // depth-first order, gives every leaf a row and centres parents on children.
  mode: "layered" | "tree";
  nodeWidth: number;
  nodeHeight: number;
  columnGap: number;
  rowGap: number;
  minStroke: number;
  maxStroke: number;
  // Minimum vertical distance between label centres in one column gap.
  labelGap?: number;
}

const LABEL_POSITION = 0.6;

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
}

export interface PlacedEdge {
  from: string;
  to: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: number;
  // Centre of the edge's count label, spaced so labels never overlap.
  labelX: number;
  labelY: number;
}

export interface GraphLayout {
  nodes: Map<string, PlacedNode>;
  edges: PlacedEdge[];
  columns: number[];
  width: number;
  height: number;
}

function columnsOf<T extends LayoutNode>(nodes: readonly T[]): T[][] {
  const columns: T[][] = [];
  for (const node of nodes) (columns[node.column] ??= []).push(node);
  return Array.from(columns, (column) => column ?? []);
}

function layered(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions,
): Map<string, number> {
  const step = options.nodeHeight + options.rowGap;
  const columns = columnsOf(nodes);
  const incoming = new Map<string, LayoutEdge[]>();
  for (const edge of edges) {
    const list = incoming.get(edge.to) ?? [];
    list.push(edge);
    incoming.set(edge.to, list);
  }
  const tallest = Math.max(0, ...columns.map((column) => column.length));
  const top = new Map<string, number>();
  for (const column of columns) {
    // Order by the weighted mean position of each node's parents.
    const ranked = column.map((node, index) => {
      let sum = 0;
      let weight = 0;
      for (const edge of incoming.get(node.id) ?? []) {
        const parent = top.get(edge.from);
        if (parent === undefined) continue;
        sum += parent * edge.weight;
        weight += edge.weight;
      }
      return { node, index, center: weight > 0 ? sum / weight : Infinity };
    });
    ranked.sort((a, b) => a.center - b.center || a.index - b.index);
    const offset = ((tallest - ranked.length) * step) / 2;
    ranked.forEach(({ node }, row) => top.set(node.id, offset + row * step));
  }
  return top;
}

function tree(
  nodes: readonly LayoutNode[],
  options: LayoutOptions,
): Map<string, number> {
  const step = options.nodeHeight + options.rowGap;
  const known = new Set(nodes.map((node) => node.id));
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const node of nodes) {
    const parent = node.parentId;
    if (parent && known.has(parent) && parent !== node.id) {
      const list = children.get(parent) ?? [];
      list.push(node.id);
      children.set(parent, list);
    } else {
      roots.push(node.id);
    }
  }
  const top = new Map<string, number>();
  let row = 0;
  const place = (id: string, seen: Set<string>): number => {
    seen.add(id);
    const kids = (children.get(id) ?? []).filter((kid) => !seen.has(kid));
    let y: number;
    if (kids.length === 0) {
      y = row * step;
      row += 1;
    } else {
      const placed = kids.map((kid) => place(kid, seen));
      y = (placed[0] + placed[placed.length - 1]) / 2;
    }
    top.set(id, y);
    return y;
  };
  const seen = new Set<string>();
  for (const id of roots) place(id, seen);
  return top;
}

export function layoutGraph(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayoutOptions,
): GraphLayout {
  const top =
    options.mode === "tree"
      ? tree(nodes, options)
      : layered(nodes, edges, options);
  const columnCount = Math.max(0, ...nodes.map((node) => node.column + 1));
  const columns = Array.from(
    { length: columnCount },
    (_, column) => column * (options.nodeWidth + options.columnGap),
  );
  const placed = new Map<string, PlacedNode>();
  for (const node of nodes) {
    placed.set(node.id, {
      id: node.id,
      x: columns[node.column],
      y: top.get(node.id) ?? 0,
    });
  }
  const heaviest = Math.max(0, ...edges.map((edge) => edge.weight));
  const middle = options.nodeHeight / 2;
  const lines: PlacedEdge[] = [];
  for (const edge of edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) continue;
    const share = heaviest > 0 ? Math.sqrt(edge.weight / heaviest) : 0;
    const x1 = from.x + options.nodeWidth;
    const y1 = from.y + middle;
    const x2 = to.x;
    const y2 = to.y + middle;
    lines.push({
      from: edge.from,
      to: edge.to,
      x1,
      y1,
      x2,
      y2,
      stroke:
        options.minStroke + (options.maxStroke - options.minStroke) * share,
      labelX: x1 + (x2 - x1) * LABEL_POSITION,
      labelY: y1 + (y2 - y1) * LABEL_POSITION,
    });
  }
  spreadLabels(lines, options.labelGap ?? 16);
  const bottom = Math.max(0, ...[...placed.values()].map((node) => node.y));
  return {
    nodes: placed,
    edges: lines,
    columns,
    width: columnCount ? columns[columnCount - 1] + options.nodeWidth : 0,
    height: placed.size ? bottom + options.nodeHeight : 0,
  };
}

// Labels between the same pair of columns share an x band; push them apart
// vertically, top to bottom, until neighbours are `gap` apart.
function spreadLabels(lines: PlacedEdge[], gap: number) {
  const bands = new Map<number, PlacedEdge[]>();
  for (const line of lines) {
    const band = bands.get(line.x1) ?? [];
    band.push(line);
    bands.set(line.x1, band);
  }
  for (const band of bands.values()) {
    band.sort((a, b) => a.labelY - b.labelY);
    for (let i = 1; i < band.length; i += 1) {
      band[i].labelY = Math.max(band[i].labelY, band[i - 1].labelY + gap);
    }
  }
}

// A straight segment drawn as a rotated bar centred on its midpoint.
export function segmentBox(edge: Pick<PlacedEdge, "x1" | "y1" | "x2" | "y2">) {
  const dx = edge.x2 - edge.x1;
  const dy = edge.y2 - edge.y1;
  const length = Math.hypot(dx, dy);
  return {
    length,
    centerX: (edge.x1 + edge.x2) / 2,
    centerY: (edge.y1 + edge.y2) / 2,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}
