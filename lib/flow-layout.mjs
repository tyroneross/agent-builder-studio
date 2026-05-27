export const FLOW_LAYOUT = {
  startX: 44,
  startY: 86,
  stageGap: 250,
  rowGap: 138,
  nodeWidth: 186,
  nodeHeight: 96,
};

export function rankFlowStages(nodes = [], edges = []) {
  const ids = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));

  for (const edge of edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
    incoming.get(edge.to).push(edge.from);
    outgoing.get(edge.from).push(edge.to);
  }

  const stages = new Map();
  const queue = nodes.filter((node) => incoming.get(node.id).length === 0).map((node) => node.id);
  for (const id of queue) stages.set(id, 0);

  while (queue.length) {
    const id = queue.shift();
    const nextStage = (stages.get(id) ?? 0) + 1;
    for (const target of outgoing.get(id) ?? []) {
      const sources = incoming.get(target) ?? [];
      if (!sources.every((source) => stages.has(source))) continue;
      stages.set(target, Math.max(...sources.map((source) => stages.get(source) ?? 0)) + 1);
      queue.push(target);
    }
  }

  for (const node of nodes) {
    if (stages.has(node.id)) continue;
    const sourceStages = (incoming.get(node.id) ?? []).map((source) => stages.get(source)).filter(Number.isFinite);
    stages.set(node.id, sourceStages.length ? Math.max(...sourceStages) + 1 : 0);
  }

  return stages;
}

export function getFlowStageMeta(nodes = [], edges = [], layout = FLOW_LAYOUT) {
  const stageRanks = rankFlowStages(nodes, edges);
  const grouped = new Map();
  for (const node of nodes) {
    const stage = stageRanks.get(node.id) ?? 0;
    if (!grouped.has(stage)) grouped.set(stage, []);
    grouped.get(stage).push(node);
  }

  const nodeMeta = new Map();
  const lanes = [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([stage, stageNodes]) => {
      stageNodes.forEach((node, row) => {
        nodeMeta.set(node.id, { stage, row, label: `Stage ${stage + 1}` });
      });
      return {
        stage,
        label: `Stage ${stage + 1}`,
        x: layout.startX + stage * layout.stageGap,
        width: layout.nodeWidth,
        count: stageNodes.length,
      };
    });

  return { nodeMeta, lanes };
}

export function layoutFlowSpec(spec = {}, layout = FLOW_LAYOUT) {
  const nodes = Array.isArray(spec.nodes) ? spec.nodes : [];
  const edges = Array.isArray(spec.edges) ? spec.edges : [];
  const { nodeMeta } = getFlowStageMeta(nodes, edges, layout);
  const rowCounters = new Map();

  return {
    ...spec,
    nodes: nodes.map((node, index) => {
      const meta = nodeMeta.get(node.id) ?? { stage: 0, row: index };
      const row = rowCounters.get(meta.stage) ?? 0;
      rowCounters.set(meta.stage, row + 1);
      return {
        ...node,
        x: layout.startX + meta.stage * layout.stageGap,
        y: layout.startY + row * layout.rowGap,
      };
    }),
  };
}
