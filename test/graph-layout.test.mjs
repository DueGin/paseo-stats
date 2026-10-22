import test from "node:test";
import assert from "node:assert/strict";
import { layoutGraph, segmentBox } from "../client/graph-layout.ts";

const options = {
  nodeWidth: 100,
  nodeHeight: 20,
  columnGap: 50,
  rowGap: 10,
  minStroke: 1,
  maxStroke: 5,
};

test("layered layout orders children by their parents to avoid crossings", () => {
  const layout = layoutGraph(
    [
      { id: "a", column: 0 },
      { id: "b", column: 0 },
      { id: "fromB", column: 1 },
      { id: "fromA", column: 1 },
    ],
    [
      { from: "a", to: "fromA", weight: 4 },
      { from: "b", to: "fromB", weight: 1 },
    ],
    { ...options, mode: "layered" },
  );
  const y = (id) => layout.nodes.get(id).y;
  assert.ok(y("fromA") < y("fromB"));
  assert.equal(layout.nodes.get("fromA").x, 150);
  assert.equal(layout.width, 250);
  assert.equal(layout.height, 50);
  const [heavy, light] = layout.edges;
  assert.equal(heavy.stroke, 5);
  assert.equal(light.stroke, 1 + 4 * Math.sqrt(1 / 4));
  assert.deepEqual([heavy.x1, heavy.y1, heavy.x2], [100, 10, 150]);
});

test("layered layout centres shorter columns", () => {
  const layout = layoutGraph(
    [
      { id: "root", column: 0 },
      { id: "x", column: 1 },
      { id: "y", column: 1 },
      { id: "z", column: 1 },
    ],
    [
      { from: "root", to: "x", weight: 1 },
      { from: "root", to: "y", weight: 1 },
      { from: "root", to: "z", weight: 1 },
    ],
    { ...options, mode: "layered" },
  );
  assert.equal(layout.nodes.get("root").y, 30);
  assert.deepEqual(
    ["x", "y", "z"].map((id) => layout.nodes.get(id).y),
    [0, 30, 60],
  );
});

test("tree layout gives leaves rows and centres parents on children", () => {
  const layout = layoutGraph(
    [
      { id: "root", column: 0, parentId: null },
      { id: "c1", column: 1, parentId: "root" },
      { id: "g1", column: 2, parentId: "c1" },
      { id: "g2", column: 2, parentId: "c1" },
      { id: "c2", column: 1, parentId: "root" },
    ],
    [
      { from: "root", to: "c1", weight: 1 },
      { from: "c1", to: "g1", weight: 1 },
      { from: "c1", to: "g2", weight: 1 },
      { from: "root", to: "c2", weight: 1 },
    ],
    { ...options, mode: "tree" },
  );
  const y = (id) => layout.nodes.get(id).y;
  assert.deepEqual([y("g1"), y("g2"), y("c2")], [0, 30, 60]);
  assert.equal(y("c1"), 15);
  assert.equal(y("root"), 37.5);
  assert.equal(layout.height, 80);
});

test("segmentBox describes a rotated bar between two points", () => {
  const box = segmentBox({ x1: 0, y1: 0, x2: 30, y2: 40 });
  assert.equal(box.length, 50);
  assert.deepEqual([box.centerX, box.centerY], [15, 20]);
  assert.ok(Math.abs(box.angle - 53.13) < 0.01);
  assert.equal(segmentBox({ x1: 0, y1: 5, x2: 10, y2: 5 }).angle, 0);
});

test("edge labels sit along their edge and never overlap within a gap", () => {
  const layout = layoutGraph(
    [
      { id: "a", column: 0 },
      { id: "b", column: 0 },
      { id: "x", column: 1 },
      { id: "y", column: 1 },
    ],
    [
      { from: "a", to: "y", weight: 1 },
      { from: "b", to: "x", weight: 1 },
    ],
    { ...options, mode: "layered", labelGap: 16 },
  );
  const [first, second] = [...layout.edges].sort((p, q) => p.labelY - q.labelY);
  assert.ok(second.labelY - first.labelY >= 16);
  const straight = layoutGraph(
    [
      { id: "a", column: 0 },
      { id: "b", column: 1 },
    ],
    [{ from: "a", to: "b", weight: 1 }],
    { ...options, mode: "layered" },
  ).edges[0];
  assert.equal(straight.labelX, 100 + 50 * 0.6);
  assert.equal(straight.labelY, 10);
});
