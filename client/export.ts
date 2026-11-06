import type {
  Collaboration,
  GroupRow,
  StatsResult,
  Timeline,
} from "../shared/stats.ts";
import { NO_PROJECT_KEY } from "../shared/stats.ts";
import {
  bucketLabel,
  compact as short,
  dateTime,
  percent,
  usd,
} from "./format.ts";
import type { Language } from "./locale.ts";
import type { Translate } from "./i18n";
import {
  foldColumns,
  primaryPath,
  edgeId,
  type FoldedNode,
} from "./topology.ts";

type Text = Translate;

export interface ExportContext {
  data: StatsResult;
  range: { from: number; to: number };
  // Readable names of the active filters, already in the reader's language.
  filters: { label: string; values: string[] }[];
  language: Language;
  t: Text;
}

const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");

function table(head: string[], rows: string[][]): string {
  return [
    `| ${head.map(cell).join(" | ")} |`,
    `| ${head.map((_, i) => (i === 0 ? "---" : "---:")).join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

function rowName(row: GroupRow, project: boolean, t: Text) {
  return project && row.key === NO_PROJECT_KEY
    ? t("noProject")
    : row.label || row.key;
}

function breakdown(rows: readonly GroupRow[], project: boolean, t: Text) {
  const whole = rows.reduce((sum, row) => sum + row.costUsd, 0);
  return table(
    [
      t("col.name"),
      t("col.input"),
      t("col.output"),
      t("col.cacheRead"),
      t("col.cacheWrite"),
      t("col.total"),
      t("col.cost"),
      t("col.share"),
    ],
    [...rows]
      .sort((a, b) => b.costUsd - a.costUsd || b.total - a.total)
      .map((row) => [
        rowName(row, project, t),
        short(row.input),
        short(row.output),
        short(row.cacheRead),
        short(row.cacheWrite),
        short(row.total),
        usd(row.costUsd),
        percent(row.costUsd, whole),
      ]),
  );
}

export function rangeText(context: ExportContext): string {
  const { range, language, t } = context;
  const from = range.from > 0 ? range.from : firstBucket(context.data.timeline);
  return t("report.range", {
    from: dateTime(from ?? range.from, language),
    to: dateTime(range.to, language),
  });
}

function firstBucket(timeline: Timeline): number | null {
  return timeline.starts.length ? timeline.starts[0] : null;
}

export function markdownReport(context: ExportContext): string {
  const { data, filters, t } = context;
  const totals = data.totals;
  const c = data.collaboration;
  const active = filters.filter((filter) => filter.values.length > 0);
  const filterText = active.length
    ? active
        .map((filter) => `${filter.label} ${filter.values.join(", ")}`)
        .join("; ")
    : t("report.noFilters");
  const sections = [
    `# ${t("report.title")}`,
    `${rangeText(context)}  \n${t("report.filters", { filters: filterText })}`,
    `## ${t("report.summary")}`,
    table(
      [
        t("kpi.cost"),
        t("kpi.tokens"),
        t("kpi.cache"),
        t("kpi.requests"),
        t("kpi.agents"),
      ],
      [
        [
          usd(totals.costUsd),
          short(totals.total),
          short(totals.cacheRead + totals.cacheWrite),
          short(totals.requests),
          String(totals.agents),
        ],
      ],
    ),
    `## ${t("tab.provider")}`,
    breakdown(data.byProvider, false, t),
    `## ${t("tab.model")}`,
    breakdown(data.byModel, false, t),
    `## ${t("tab.project")}`,
    breakdown(data.byProject, true, t),
  ];
  if (c.trees > 0) {
    sections.push(
      `## ${t("collab.title")}`,
      t("report.collaboration", {
        count: c.trees,
        children: c.childAgents,
        share: percent(c.childCostUsd, totals.costUsd),
      }),
    );
    if (c.modelPairs.length) {
      sections.push(
        table(
          [t("collab.pairs"), t("collab.col.child"), t("col.cost")],
          c.modelPairs
            .slice(0, 10)
            .map((pair) => [
              `${pair.parent ?? t("collab.unknownModel")} → ${pair.child ?? t("collab.unknownModel")}`,
              `×${pair.count}`,
              usd(pair.costUsd),
            ]),
        ),
      );
    }
  }
  sections.push(`_${t("report.footer")}_`);
  return sections.join("\n\n") + "\n";
}

const csvField = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function csvBreakdown(data: StatsResult, t: Text): string {
  const head = [
    "dimension",
    "key",
    "name",
    "input",
    "output",
    "cache_read",
    "cache_write",
    "total_tokens",
    "cost_usd",
    "requests",
    "agents",
  ];
  const lines = [head.join(",")];
  const groups: [string, readonly GroupRow[]][] = [
    ["provider", data.byProvider],
    ["model", data.byModel],
    ["project", data.byProject],
  ];
  for (const [dimension, rows] of groups) {
    for (const row of rows) {
      lines.push(
        [
          dimension,
          row.key,
          rowName(row, dimension === "project", t),
          row.input,
          row.output,
          row.cacheRead,
          row.cacheWrite,
          row.total,
          row.costUsd.toFixed(6),
          row.requests,
          row.agents,
        ]
          .map(csvField)
          .join(","),
      );
    }
  }
  return lines.join("\n") + "\n";
}

type Dimension = "model" | "provider";
// SeeCode's faithful budget allows 24 nodes; four per layer keeps exports
// under it for the depths Paseo trees reach.
const EXPORT_COLUMN_LIMIT = 4;

function exportGraph(collaboration: Collaboration, dimension: Dimension) {
  const { nodes, edges } = foldColumns(
    collaboration.topology[dimension].nodes,
    collaboration.topology[dimension].edges,
    EXPORT_COLUMN_LIMIT,
  );
  const ids = new Map(nodes.map((node, index) => [node.id, `n${index}`]));
  return { nodes, edges, ids, primary: primaryPath(nodes, edges) };
}

function exportName(node: FoldedNode, t: Text) {
  if (node.folded) return t("topo.otherTitle");
  const key = node.key ?? t("collab.unknownModel");
  return node.native ? t("collab.nativeNode", { name: key }) : key;
}

function exportSummary(node: FoldedNode, t: Text) {
  return t(node.native ? "collab.nodeSessions" : "collab.nodeAgents", {
    count: node.count,
    cost: usd(node.costUsd),
  });
}

const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

export function mermaidTopology(
  collaboration: Collaboration,
  dimension: Dimension,
  t: Text,
): string | null {
  const { nodes, edges, ids, primary } = exportGraph(collaboration, dimension);
  if (nodes.length === 0) return null;
  const quote = (text: string) =>
    `"${text.replace(/"/g, "#quot;").replace(/[<>]/g, "")}"`;
  const lines = ["flowchart LR"];
  const depths = [...new Set(nodes.map((node) => node.depth))].sort(
    (a, b) => a - b,
  );
  for (const depth of depths) {
    lines.push(`  subgraph L${depth} [${quote(t("collab.layer", { depth }))}]`);
    for (const node of nodes.filter((entry) => entry.depth === depth)) {
      lines.push(
        `    ${ids.get(node.id)}[${quote(`${exportName(node, t)}<br/>${exportSummary(node, t)}`)}]`,
      );
    }
    lines.push("  end");
  }
  const primaryLinks: number[] = [];
  edges.forEach((edge, index) => {
    lines.push(
      `  ${ids.get(edge.from)} -->|${quote(`×${edge.count}`)}| ${ids.get(edge.to)}`,
    );
    if (primary.edges.has(edgeId(edge.from, edge.to))) primaryLinks.push(index);
  });
  const native = nodes.filter((node) => node.native).map((n) => ids.get(n.id));
  if (native.length) {
    lines.push("  classDef native stroke-dasharray: 4 3");
    lines.push(`  class ${native.join(",")} native`);
  }
  if (primaryLinks.length) {
    lines.push(`  linkStyle ${primaryLinks.join(",")} stroke-width:3px`);
  }
  return lines.join("\n") + "\n";
}

// A SeeCode architecture spec: layers become columns, the costliest path is
// the primary path, and the costliest agent node is the focal one.
export function seecodeTopology(
  context: ExportContext,
  dimension: Dimension,
): string | null {
  const { data, language, t } = context;
  const { nodes, edges, ids, primary } = exportGraph(
    data.collaboration,
    dimension,
  );
  if (nodes.length === 0) return null;
  // Centre each layer on the tallest one, as the in-app graph does.
  const sizes = new Map<number, number>();
  for (const node of nodes) {
    sizes.set(node.depth, (sizes.get(node.depth) ?? 0) + 1);
  }
  const tallest = Math.max(...sizes.values());
  const rows = new Map(
    [...sizes].map(([depth, size]) => [
      depth,
      Math.floor((tallest - size) / 2),
    ]),
  );
  const focal = [...nodes]
    .filter((node) => !node.native && !node.folded)
    .sort((a, b) => b.costUsd - a.costUsd)[0]?.id;
  const spec = {
    type: "architecture",
    title: clip(
      t("report.topologyTitle", { by: t(`collab.pairsBy.${dimension}`) }),
      90,
    ),
    subtitle: clip(rangeText(context), 160),
    lang: language === "zh" ? "zh-CN" : "en",
    dir: "LR",
    motion: "trace",
    budget: "faithful",
    nodes: nodes.map((node) => {
      const row = rows.get(node.depth) ?? 0;
      rows.set(node.depth, row + 1);
      return {
        id: ids.get(node.id) as string,
        label: clip(exportName(node, t), 40),
        sub: clip(exportSummary(node, t), 48),
        ...(node.folded
          ? { kind: "muted" }
          : node.native
            ? { kind: "optional" }
            : {}),
        ...(node.id === focal ? { focal: true } : {}),
        row: Math.min(row, 40),
        col: Math.min(node.depth, 40),
      };
    }),
    edges: edges.map((edge) => [
      ids.get(edge.from) as string,
      ids.get(edge.to) as string,
      clip(`×${edge.count}`, 28),
      primary.edges.has(edgeId(edge.from, edge.to))
        ? "primary"
        : nodes.find((node) => node.id === edge.to)?.native
          ? "async"
          : "default",
    ]),
  };
  return JSON.stringify(spec, null, 2) + "\n";
}

// A SeeCode line chart of spend per bucket, one line per provider.
export function seecodeTrend(context: ExportContext): string | null {
  const { data, language, t } = context;
  const timeline = data.timeline;
  if (timeline.costUsd.every((value) => value === 0)) return null;
  const round = (value: number) => Math.round(value * 100) / 100;
  const series = timeline.byProvider.length > 1 ? timeline.byProvider : [];
  const x = timeline.starts.map((start, index) =>
    bucketLabel(
      start,
      timeline.unit,
      language,
      index > 0 ? timeline.starts[index - 1] : null,
    ),
  );
  const spec = {
    type: "line",
    title: clip(t("report.trendTitle"), 90),
    subtitle: clip(rangeText(context), 160),
    lang: language === "zh" ? "zh-CN" : "en",
    unit: "$",
    x,
    series: (series.length
      ? series.map((entry, index) => ({
          name: clip(entry.key === null ? t("trend.other") : entry.label, 24),
          values: entry.costUsd.map(round),
          ...(index === 0 ? { focal: true } : {}),
        }))
      : [
          {
            name: clip(t("trend.stack.none"), 24),
            values: timeline.costUsd.map(round),
            focal: true,
          },
        ]
    ).slice(0, 5),
  };
  return JSON.stringify(spec, null, 2) + "\n";
}
