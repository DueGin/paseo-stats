import test from "node:test";
import assert from "node:assert/strict";
import {
  curvePoints,
  elbowPoints,
  foldColumns,
  polylineLength,
  primaryPath,
  reach,
} from "../client/topology.ts";
import { assignSlots, luminance } from "../client/palette.ts";
import {
  axisLabelLeft,
  labelIndexes,
  niceCeil,
  peakIndex,
} from "../client/chart.ts";

const node = (id, depth, costUsd, extra = {}) => ({
  id,
  key: id,
  depth,
  native: false,
  count: 1,
  tokens: 0,
  costUsd,
  ...extra,
});
const edge = (from, to, costUsd, count = 1) => ({
  from,
  to,
  count,
  tokens: 0,
  costUsd,
});

test("wide columns fold their cheapest nodes into one, merging edges", () => {
  const nodes = [
    node("root", 0, 10),
    ...[5, 4, 3, 2, 1].map((cost, i) => node(`c${i}`, 1, cost)),
  ];
  const edges = nodes.slice(1).map((n) => edge("root", n.id, n.costUsd, 2));
  const folded = foldColumns(nodes, edges, 3);
  const level1 = folded.nodes.filter((n) => n.depth === 1);
  assert.deepEqual(
    level1.map((n) => n.id),
    ["c0", "c1", "1:other"],
  );
  const other = level1[2];
  assert.equal(other.folded, 3);
  assert.equal(other.costUsd, 6);
  assert.equal(other.count, 3);
  const otherEdge = folded.edges.find((e) => e.to === "1:other");
  assert.equal(otherEdge.count, 6);
  assert.equal(otherEdge.costUsd, 6);
  assert.equal(folded.edges.length, 3);
  // Narrow columns pass through untouched.
  assert.equal(foldColumns(nodes, edges, 10).nodes.length, nodes.length);
});

test("the primary path follows the costliest edge from the costliest root", () => {
  const nodes = [
    node("a", 0, 1),
    node("b", 0, 1),
    node("a1", 1, 1),
    node("a2", 1, 1),
    node("a2x", 2, 1),
    node("b1", 1, 1),
  ];
  const edges = [
    edge("a", "a1", 2),
    edge("a", "a2", 8),
    edge("a2", "a2x", 3),
    edge("b", "b1", 4),
  ];
  const path = primaryPath(nodes, edges);
  assert.deepEqual([...path.nodes], ["a", "a2", "a2x"]);
  assert.deepEqual([...path.edges], ["a>a2", "a2>a2x"]);
  assert.equal(primaryPath([], []).nodes.size, 0);
});

test("reach walks upstream and downstream and counts hops", () => {
  const edges = [edge("a", "b", 0), edge("b", "c", 0), edge("b", "d", 0)];
  const down = reach(edges, "a", "down");
  assert.equal(down.count, 3);
  assert.equal(down.hops, 2);
  assert.deepEqual([...down.edges].sort(), ["a>b", "b>c", "b>d"]);
  const up = reach(edges, "d", "up");
  assert.deepEqual([...up.nodes].sort(), ["a", "b", "d"]);
  assert.equal(reach(edges, "c", "down").count, 0);
  // Cycles terminate.
  assert.equal(
    reach([edge("x", "y", 0), edge("y", "x", 0)], "x", "down").count,
    1,
  );
});

test("curves leave and enter horizontally; elbows turn at the trunk", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 100, y: 60 };
  const curve = curvePoints(from, to);
  assert.deepEqual(curve[0], from);
  assert.deepEqual(curve.at(-1), to);
  assert.ok(
    Math.abs(curve[1].y - curve[0].y) < Math.abs(curve[1].x - curve[0].x),
  );
  assert.ok(polylineLength(curve) > Math.hypot(100, 60));
  assert.deepEqual(curvePoints(from, { x: 100, y: 0 }), [
    from,
    { x: 100, y: 0 },
  ]);
  assert.deepEqual(elbowPoints(from, to), [
    from,
    { x: 50, y: 0 },
    { x: 50, y: 60 },
    to,
  ]);
});

test("series keep the colour slot of their stable order", () => {
  const order = ["claude", "codex", "pi", "omp"];
  assert.deepEqual(
    [...assignSlots(["codex", "pi"], order)],
    [
      ["codex", 1],
      ["pi", 2],
    ],
  );
  // An entity beyond the slots takes the lowest free one.
  assert.deepEqual(
    [...assignSlots(["omp", "codex"], order)],
    [
      ["codex", 1],
      ["omp", 0],
    ],
  );
  assert.equal(assignSlots(["a", "b", "c", "d"], []).get("d"), -1);
});

test("luminance tells light and dark surfaces apart", () => {
  assert.ok(luminance("#fafafa") > 0.9);
  assert.ok(luminance("#1f1f22") < 0.05);
  assert.equal(luminance("#fff"), 1);
  assert.ok(luminance("rgb(24, 24, 27)") < 0.05);
  assert.equal(luminance("var(--x)"), null);
});

test("axes end on round numbers and labels spread evenly", () => {
  assert.equal(niceCeil(0), 0);
  assert.equal(niceCeil(7.3), 8);
  assert.equal(niceCeil(13), 15);
  assert.equal(niceCeil(0.42), 0.5);
  assert.equal(niceCeil(2400), 2500);
  assert.equal(niceCeil(100), 100);
  // A 1.08B peak tops out at 1.2B rather than leaving half the plot empty.
  assert.equal(niceCeil(1.08e9), 1.2e9);
  assert.equal(niceCeil(1.6), 2);
  // Date labels stay inside the plot: centred in the middle, pushed in at the
  // right edge, and allowed to borrow the y-axis gutter at the left.
  assert.equal(axisLabelLeft(5, 10, 400, 80, 40), 180);
  assert.equal(axisLabelLeft(9, 10, 400, 80, 40), 320);
  assert.equal(axisLabelLeft(0, 10, 400, 80, 40), -20);
  assert.equal(axisLabelLeft(0, 100, 400, 80, 30), -30);
  assert.deepEqual(labelIndexes(25, 5), [0, 5, 10, 15, 20]);
  assert.deepEqual(labelIndexes(3, 6), [0, 1, 2]);
  assert.deepEqual(labelIndexes(0, 6), []);
  assert.equal(peakIndex([0, 3, 9, 9, 1]), 2);
  assert.equal(peakIndex([0, 0]), -1);
});
