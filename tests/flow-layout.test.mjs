import assert from "node:assert/strict";
import test from "node:test";

import { FLOW_LAYOUT, getFlowStageMeta, layoutFlowSpec, rankFlowStages } from "../lib/flow-layout.mjs";

test("rankFlowStages orders flow left-to-right by dependency", () => {
  const nodes = [{ id: "source" }, { id: "queue" }, { id: "process" }, { id: "sink" }];
  const edges = [
    { from: "source", to: "queue" },
    { from: "queue", to: "process" },
    { from: "process", to: "sink" },
  ];
  const ranks = rankFlowStages(nodes, edges);
  assert.equal(ranks.get("source"), 0);
  assert.equal(ranks.get("queue"), 1);
  assert.equal(ranks.get("process"), 2);
  assert.equal(ranks.get("sink"), 3);
});

test("layoutFlowSpec places parallel nodes top-to-bottom within the same stage", () => {
  const spec = layoutFlowSpec({
    nodes: [{ id: "source" }, { id: "a" }, { id: "b" }, { id: "sink" }],
    edges: [
      { from: "source", to: "a" },
      { from: "source", to: "b" },
      { from: "a", to: "sink" },
      { from: "b", to: "sink" },
    ],
  });
  const source = spec.nodes.find((node) => node.id === "source");
  const a = spec.nodes.find((node) => node.id === "a");
  const b = spec.nodes.find((node) => node.id === "b");
  const sink = spec.nodes.find((node) => node.id === "sink");

  assert.equal(source.x, FLOW_LAYOUT.startX);
  assert.equal(a.x, FLOW_LAYOUT.startX + FLOW_LAYOUT.stageGap);
  assert.equal(b.x, FLOW_LAYOUT.startX + FLOW_LAYOUT.stageGap);
  assert.equal(b.y, a.y + FLOW_LAYOUT.rowGap);
  assert.equal(sink.x, FLOW_LAYOUT.startX + FLOW_LAYOUT.stageGap * 2);
});

test("getFlowStageMeta returns lane labels for the canvas", () => {
  const { nodeMeta, lanes } = getFlowStageMeta(
    [{ id: "source" }, { id: "process" }],
    [{ from: "source", to: "process" }],
  );
  assert.equal(nodeMeta.get("source").label, "Stage 1");
  assert.equal(nodeMeta.get("process").label, "Stage 2");
  assert.equal(lanes.length, 2);
});
