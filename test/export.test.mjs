import test from "node:test";
import assert from "node:assert/strict";
import { aggregate } from "../server/aggregate.ts";
import { en } from "../client/messages.ts";
import {
  csvBreakdown,
  markdownReport,
  mermaidTopology,
  seecodeTopology,
  seecodeTrend,
} from "../client/export.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-06T12:00:00Z");

// A small i18next-like translator over the real English messages.
export function translate(key, params = {}) {
  const template =
    en[key] ??
    (Number(params.count) === 1 ? en[`${key}_one`] : en[`${key}_other`]);
  assert.ok(template, `unknown key ${key}`);
  return template.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    assert.ok(name in params, `${key} needs ${name}`);
    return String(params[name]);
  });
}

function agent(id, provider, extra = {}) {
  return {
    id,
    provider,
    title: id,
    cwd: "/repo",
    projectKey: "prj",
    projectName: "alpha | beta",
    projectPath: "/repo",
    parentId: null,
    createdAt: NOW - 20 * HOUR,
    model: null,
    sessionId: id,
    ...extra,
  };
}

const agents = Object.fromEntries(
  [
    agent("root", "claude"),
    agent("a", "codex", { parentId: "root" }),
    agent("b", "codex", { parentId: "root" }),
    agent("c", "pi", { parentId: "a" }),
    ...Array.from({ length: 8 }, (_, i) =>
      agent(`w${i}`, "pi", { parentId: "root" }),
    ),
  ].map((a) => [a.id, a]),
);

let seq = 0;
const event = (agentId, model, ts, extra = {}) => ({
  key: `k${seq++}`,
  ts,
  agentId,
  model,
  input: 1000,
  output: 100,
  cacheRead: 0,
  cacheWrite: 0,
  cacheWrite1h: 0,
  reportedCost: null,
  session: agentId,
  native: false,
  ...extra,
});

const events = [
  event("root", "claude-opus-5-5", NOW - 2 * HOUR),
  event("a", "gpt-6.1-sol", NOW - 3 * HOUR),
  event("a", "gpt-6.1-sol", NOW - 3 * HOUR, { native: true, session: "s1" }),
  event("b", "gpt-6.1-mini", NOW - 5 * HOUR),
  event("c", "kimi-k3", NOW - 4 * HOUR, { reportedCost: 0.5 }),
  ...Array.from({ length: 8 }, (_, i) =>
    event(`w${i}`, `model-${i}`, NOW - (6 + i) * HOUR),
  ),
];

const price = {
  source: "x",
  price: {
    input: 1e-5,
    output: 2e-5,
    cacheRead: null,
    cacheWrite: null,
    cacheWrite1h: null,
  },
};

const query = {
  from: NOW - 24 * HOUR,
  to: NOW,
  providers: [],
  models: [],
  projects: [],
  tzOffset: 0,
};
const result = aggregate({
  events,
  agents,
  query,
  prices: { resolve: () => price },
  providerLabel: (id) => id[0].toUpperCase() + id.slice(1),
});
const data = {
  generatedAt: NOW,
  ...result,
  coverage: {
    agents: 12,
    agentsWithLogs: 12,
    missing: [],
    unpricedModels: [],
    pricing: { source: "cache", updatedAt: NOW, error: null },
    lastSyncAt: NOW,
    syncing: false,
    syncError: null,
    events: events.length,
    dataDir: "/tmp",
  },
};
export const context = {
  data,
  range: { from: query.from, to: query.to },
  filters: [{ label: "Provider", values: ["Codex"] }],
  language: "en",
  t: translate,
};

test("the Markdown report has the summary and every breakdown table", () => {
  const report = markdownReport(context);
  assert.match(report, /^# Paseo usage report\n/);
  assert.match(report, /Filters: Provider Codex/);
  for (const heading of ["Summary", "By provider", "By model", "By project"]) {
    assert.ok(report.includes(`## ${heading}`), heading);
  }
  // Pipes in names are escaped so the table keeps its columns.
  assert.ok(report.includes("alpha \\| beta"));
  assert.match(report, /## Multi-agent collaboration/);
  assert.match(report, /claude-opus-5-5 → gpt-6\.1-sol/);
});

test("the CSV has one line per breakdown row, quoted where needed", () => {
  const csv = csvBreakdown(data, translate).trim().split("\n");
  assert.equal(
    csv.length,
    1 + data.byProvider.length + data.byModel.length + data.byProject.length,
  );
  assert.match(csv[0], /^dimension,key,name,/);
  assert.ok(csv.some((line) => line.startsWith("project,prj,alpha | beta,")));
});

test("Mermaid topology groups layers and styles the costliest path", () => {
  const mermaid = mermaidTopology(data.collaboration, "model", translate);
  assert.match(mermaid, /^flowchart LR\n/);
  assert.match(mermaid, /subgraph L0 \["Level 0"\]/);
  assert.match(mermaid, /subgraph L1 \["Level 1"\]/);
  assert.match(mermaid, /-->\|"×\d+"\|/);
  assert.match(mermaid, /linkStyle [\d,]+ stroke-width:3px/);
  assert.match(mermaid, /class n\d+(,n\d+)* native/);
  // Eleven children at level 1 fold into three named nodes and "Other".
  const level1 = mermaid.split("subgraph L1")[1].split("end")[0];
  assert.equal(level1.match(/\[/g).length - 1, 4);
});

test("SeeCode topology spec stays inside SeeCode's schema limits", () => {
  const spec = JSON.parse(seecodeTopology(context, "model"));
  assert.equal(spec.type, "architecture");
  assert.ok(spec.nodes.length <= 24);
  const ids = new Set(spec.nodes.map((node) => node.id));
  for (const node of spec.nodes) {
    assert.match(node.id, /^[A-Za-z_][A-Za-z0-9_.-]*$/);
    assert.ok(node.label.length <= 40 && node.sub.length <= 48);
  }
  for (const [from, to, label, kind] of spec.edges) {
    assert.ok(ids.has(from) && ids.has(to));
    assert.ok(label.length <= 28);
    assert.ok(["default", "primary", "async"].includes(kind));
  }
  assert.equal(spec.nodes.filter((node) => node.focal).length, 1);
  assert.ok(spec.edges.some((edge) => edge[3] === "primary"));
  assert.ok(spec.title.length <= 90);
});

test("SeeCode trend spec has one value per x label", () => {
  const spec = JSON.parse(seecodeTrend(context));
  assert.equal(spec.type, "line");
  assert.ok(spec.series.length >= 2 && spec.series.length <= 5);
  for (const series of spec.series) {
    assert.equal(series.values.length, spec.x.length);
    assert.ok(series.name.length <= 24);
  }
  assert.equal(spec.series.filter((s) => s.focal).length, 1);
});

test("exports with nothing to show return null", () => {
  const empty = aggregate({
    events: [],
    agents: {},
    query,
    prices: { resolve: () => price },
    providerLabel: (id) => id,
  });
  const quiet = { ...context, data: { ...data, ...empty } };
  assert.equal(mermaidTopology(empty.collaboration, "model", translate), null);
  assert.equal(seecodeTopology(quiet, "model"), null);
  assert.equal(seecodeTrend(quiet), null);
});
