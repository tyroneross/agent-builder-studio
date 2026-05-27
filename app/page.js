"use client";

import {
  AlertTriangle,
  Braces,
  Check,
  ChevronRight,
  Database,
  FileText,
  FileCode2,
  Link2,
  ListChecks,
  Maximize2,
  Minimize2,
  MousePointer2,
  Play,
  Plus,
  RotateCcw,
  Shield,
  Sparkles,
  Trash2,
  Workflow,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AGENT_STRUCTURES } from "../agent-structures/index.js";
import { FLOW_LAYOUT, getFlowStageMeta, layoutFlowSpec } from "../lib/flow-layout.mjs";
import { buildAgentArtifacts } from "../lib/generator.js";
import { FRAMEWORKS, PATTERNS, SOURCE_REGISTRY } from "../lib/patterns.js";

const BUILT_STRUCTURES_STORAGE_KEY = "agent-builder-built-structures-v1";

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function createSpec(pattern) {
  const source = pattern.spec ?? pattern;
  return layoutFlowSpec({
    projectName: source.projectName ?? source.name,
    description: source.description,
    patternId: source.patternId ?? source.id,
    structureId: source.structureId,
    runtime: source.runtime ?? source.defaultRuntime,
    framework: source.framework ?? source.recommendedFrameworks?.[0],
    modelProvider: source.modelProvider ?? source.defaultProvider,
    sandbox: source.sandbox ?? "workspace-write",
    autonomy: source.autonomy,
    nodes: clone(source.nodes),
    edges: clone(source.edges),
    inputs: clone(source.inputs),
    outputs: clone(source.outputs),
    tools: clone(source.tools),
    memory: clone(source.memory),
    permissions: clone(source.permissions),
    evals: clone(source.evals),
    learning: clone(source.learning),
    modelProfiles: clone(source.modelProfiles),
    sources: clone(source.sources),
  });
}

function findPattern(id) {
  return PATTERNS.find((pattern) => pattern.id === id) ?? PATTERNS[0];
}

function nodeClass(kind) {
  if (kind === "guardrail" || kind === "approval") return "flow-node is-policy";
  if (kind === "tool" || kind === "executor") return "flow-node is-tool";
  if (kind === "memory" || kind === "state") return "flow-node is-memory";
  if (kind === "eval" || kind === "verifier") return "flow-node is-eval";
  return "flow-node";
}

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function PatternButton({ pattern, active, onClick }) {
  return (
    <button className={`pattern-button ${active ? "is-active" : ""}`} onClick={onClick}>
      <span className="pattern-head">
        <Workflow size={16} />
        <strong>{pattern.name}</strong>
      </span>
      <span>{pattern.short}</span>
      <small>{pattern.type} · {pattern.nodeCount} nodes</small>
    </button>
  );
}

function StructureButton({ structure, active, onClick }) {
  return (
    <button className={`pattern-button ${active ? "is-active" : ""}`} onClick={onClick}>
      <span className="pattern-head">
        <Sparkles size={16} />
        <strong>{structure.label}</strong>
      </span>
      <span>{structure.short}</span>
      <small>{structure.category} · {structure.spec.nodes.length} nodes{structure.outputDir ? ` · ${structure.outputDir}` : ""}</small>
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function slugFromName(value) {
  return String(value ?? "agent")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "agent";
}

function builtStructureFromSpec(spec, buildResult = {}) {
  const slug = buildResult.slug ?? slugFromName(spec.projectName);
  return {
    id: `generated:${slug}`,
    label: spec.projectName,
    short: spec.description || "Generated installable agent package.",
    category: "generated",
    outputDir: buildResult.installableDir ?? buildResult.outputDir ?? `generated/agents/${slug}`,
    spec: layoutFlowSpec({ ...clone(spec), structureId: `generated:${slug}` }),
  };
}

function mergeStructures(...groups) {
  const merged = new Map();
  for (const group of groups) {
    for (const item of group ?? []) merged.set(item.id, item);
  }
  return [...merged.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function readBuiltStructures() {
  try {
    const stored = JSON.parse(localStorage.getItem(BUILT_STRUCTURES_STORAGE_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored.map((item) => ({ ...item, spec: layoutFlowSpec(item.spec ?? {}) }));
  } catch {
    return [];
  }
}

function FlowCanvas({
  spec,
  selectedNode,
  connectingFrom,
  expanded = false,
  onCanvasPointerMove,
  onCanvasPointerUp,
  onNodePointerDown,
  onNodeClick,
}) {
  const { nodeMeta, lanes } = useMemo(() => getFlowStageMeta(spec.nodes, spec.edges), [spec.nodes, spec.edges]);
  const maxX = Math.max(...spec.nodes.map((node) => Number(node.x) || 0), 0);
  const maxY = Math.max(...spec.nodes.map((node) => Number(node.y) || 0), 0);
  const canvasWidth = Math.max(900, maxX + FLOW_LAYOUT.nodeWidth + 120, (lanes.length + 1) * FLOW_LAYOUT.stageGap);
  const canvasHeight = Math.max(expanded ? 720 : 590, maxY + FLOW_LAYOUT.nodeHeight + 120);
  const markerId = expanded ? "arrow-expanded" : "arrow";

  return (
    <div
      className={`flow-canvas ${expanded ? "is-expanded" : ""}`}
      style={{ minWidth: canvasWidth, minHeight: canvasHeight }}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onPointerCancel={onCanvasPointerUp}
    >
      <div className="stage-lane-layer" aria-hidden="true">
        {lanes.map((lane) => (
          <div className="stage-lane" key={lane.stage} style={{ left: lane.x - 14, width: FLOW_LAYOUT.nodeWidth + 28 }}>
            <span>{lane.label}</span>
          </div>
        ))}
      </div>

      <svg className="edge-layer" aria-hidden="true">
        <defs>
          <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        {spec.edges.map((edge, index) => {
          const from = spec.nodes.find((node) => node.id === edge.from);
          const to = spec.nodes.find((node) => node.id === edge.to);
          if (!from || !to) return null;
          const x1 = from.x + FLOW_LAYOUT.nodeWidth - 4;
          const y1 = from.y + 48;
          const x2 = to.x + 4;
          const y2 = to.y + 48;
          const bend = Math.max(44, Math.abs(x2 - x1) / 2);
          return (
            <path
              key={`${edge.from}-${edge.to}-${index}`}
              className="edge-path"
              d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
              markerEnd={`url(#${markerId})`}
            />
          );
        })}
      </svg>

      {spec.nodes.map((node) => {
        const meta = nodeMeta.get(node.id);
        return (
          <button
            key={node.id}
            className={`${nodeClass(node.kind)} ${node.id === selectedNode?.id ? "is-selected" : ""} ${connectingFrom === node.id ? "is-connecting" : ""}`}
            style={{ left: node.x, top: node.y }}
            onPointerDown={(event) => onNodePointerDown(event, node)}
            onClick={() => onNodeClick(node)}
          >
            <span className="node-kind">{meta?.label ?? "Stage"} · {node.kind}</span>
            <strong>{node.title}</strong>
            <span>{node.description}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function Home() {
  const [spec, setSpec] = useState(() => createSpec(PATTERNS[0]));
  const [selectedNodeId, setSelectedNodeId] = useState(spec.nodes[0]?.id);
  const [dragState, setDragState] = useState(null);
  const [connectingFrom, setConnectingFrom] = useState(null);
  const [buildState, setBuildState] = useState({ status: "idle" });
  const [previewMode, setPreviewMode] = useState("files");
  const [builtStructures, setBuiltStructures] = useState([]);
  const [flowExpanded, setFlowExpanded] = useState(false);

  const activePattern = findPattern(spec.patternId);
  const selectedNode = spec.nodes.find((node) => node.id === selectedNodeId) ?? spec.nodes[0];
  const artifacts = useMemo(() => buildAgentArtifacts(spec, { createdAt: "preview" }), [spec]);
  const manifestPreview = artifacts.files.find((file) => file.path === "manifest.json")?.content ?? "";
  const yamlPreview = artifacts.files.find((file) => file.path === "agent.yaml")?.content ?? "";
  const framework = FRAMEWORKS.find((item) => item.id === spec.framework);

  useEffect(() => {
    let cancelled = false;
    const local = readBuiltStructures();
    setBuiltStructures(local);
    fetch("/api/generated-agents")
      .then((response) => response.json())
      .then((body) => {
        if (cancelled || !body.ok) return;
        setBuiltStructures((current) => mergeStructures(current, local, body.structures));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function persistBuiltStructure(structure) {
    setBuiltStructures((current) => {
      const next = mergeStructures(current, [structure]);
      localStorage.setItem(BUILT_STRUCTURES_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function replaceSpecFromPattern(pattern) {
    const next = createSpec(pattern);
    setSpec(next);
    setSelectedNodeId(next.nodes[0]?.id);
    setConnectingFrom(null);
    setBuildState({ status: "idle" });
  }

  function updateSpec(patch) {
    setSpec((current) => ({ ...current, ...patch }));
  }

  function updateSelectedNode(patch) {
    if (!selectedNode) return;
    setSpec((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        node.id === selectedNode.id ? { ...node, ...patch } : node,
      ),
    }));
  }

  function orderFlow() {
    setSpec((current) => layoutFlowSpec(current));
  }

  function addNode() {
    const { nodeMeta } = getFlowStageMeta(spec.nodes, spec.edges);
    const selectedMeta = selectedNode ? nodeMeta.get(selectedNode.id) : null;
    const stage = selectedMeta ? selectedMeta.stage + 1 : 0;
    const stageCount = spec.nodes.filter((node) => (nodeMeta.get(node.id)?.stage ?? 0) === stage).length;
    const id = `agent-${Date.now().toString(36)}`;
    const nextNode = {
      id,
      title: "New stage",
      kind: "agent",
      description: "Define the stage contract, inputs, outputs, and constraints.",
      x: FLOW_LAYOUT.startX + stage * FLOW_LAYOUT.stageGap,
      y: FLOW_LAYOUT.startY + stageCount * FLOW_LAYOUT.rowGap,
      tools: [],
      inputs: ["user_request"],
      outputs: ["agent_result"],
      permission: "ask-first",
      model: "inherit",
    };
    setSpec((current) => ({
      ...current,
      nodes: [...current.nodes, nextNode],
      edges: selectedNode ? [...current.edges, { from: selectedNode.id, to: id, label: "handoff" }] : current.edges,
    }));
    setSelectedNodeId(id);
  }

  function removeNode(id) {
    setSpec((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== id),
      edges: current.edges.filter((edge) => edge.from !== id && edge.to !== id),
    }));
    const remaining = spec.nodes.filter((node) => node.id !== id);
    setSelectedNodeId(remaining[0]?.id);
    if (connectingFrom === id) setConnectingFrom(null);
  }

  function handleNodePointerDown(event, node) {
    const rect = event.currentTarget.getBoundingClientRect();
    setSelectedNodeId(node.id);
    setDragState({
      id: node.id,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event) {
    if (!dragState) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(12, Math.min(rect.width - FLOW_LAYOUT.nodeWidth, event.clientX - rect.left - dragState.dx));
    const y = Math.max(12, Math.min(rect.height - 100, event.clientY - rect.top - dragState.dy));
    setSpec((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === dragState.id ? { ...node, x, y } : node)),
    }));
  }

  function handleNodeClick(node) {
    setSelectedNodeId(node.id);
    if (!connectingFrom || connectingFrom === node.id) return;
    const exists = spec.edges.some((edge) => edge.from === connectingFrom && edge.to === node.id);
    if (!exists) {
      setSpec((current) => ({
        ...current,
        edges: [...current.edges, { from: connectingFrom, to: node.id, label: "handoff" }],
      }));
    }
    setConnectingFrom(null);
  }

  async function buildAgent() {
    setBuildState({ status: "building" });
    try {
      const response = await fetch("/api/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) {
        throw new Error(body.error ?? "Build failed");
      }
      setBuildState({ status: "built", ...body });
      persistBuiltStructure(builtStructureFromSpec(spec, body));
    } catch (error) {
      setBuildState({
        status: "error",
        error: error instanceof Error ? error.message : "Build failed",
      });
    }
  }

  return (
    <main className="shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Agent Builder</p>
          <h1>Design the harness first. Build the files second.</h1>
        </div>
        <div className="topbar-actions">
          <a className="ghost-button" href="/cos">
            <Play size={16} />
            Run Chief of Staff
          </a>
          <a className="ghost-button" href="/investments">
            <ListChecks size={16} />
            Review Investment
          </a>
          <a className="ghost-button" href="/meetings">
            <FileText size={16} />
            Ingest Files
          </a>
          <button className="ghost-button" onClick={() => replaceSpecFromPattern(activePattern)}>
            <RotateCcw size={16} />
            Reset
          </button>
          <button className="primary-button" onClick={buildAgent} disabled={buildState.status === "building"}>
            <Play size={17} />
            {buildState.status === "building" ? "Building" : "Build Agent"}
          </button>
        </div>
      </section>

      <section className="workspace" aria-label="Agent builder workspace">
        <aside className="panel palette-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Patterns</p>
              <h2>Choose a starting shape</h2>
            </div>
            <Sparkles size={18} />
          </div>

          <div className="pattern-list">
            {PATTERNS.map((pattern) => (
              <PatternButton
                key={pattern.id}
                pattern={pattern}
                active={pattern.id === spec.patternId}
                onClick={() => replaceSpecFromPattern(pattern)}
              />
            ))}
          </div>

          <div className="quiet-group">
            <p className="group-label">Agent structures</p>
            <div className="pattern-list">
              {builtStructures.map((structure) => (
                <StructureButton
                  key={structure.id}
                  structure={structure}
                  active={structure.id === spec.structureId}
                  onClick={() => replaceSpecFromPattern(structure)}
                />
              ))}
              {AGENT_STRUCTURES.map((structure) => (
                <StructureButton
                  key={structure.id}
                  structure={structure}
                  active={structure.id === spec.structureId}
                  onClick={() => replaceSpecFromPattern(structure)}
                />
              ))}
            </div>
          </div>

          <div className="quiet-group">
            <p className="group-label">Framework fit</p>
            <select value={spec.framework} onChange={(event) => updateSpec({ framework: event.target.value })}>
              {FRAMEWORKS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className="hint">{framework?.fit}</p>
          </div>

          <div className="quiet-group">
            <p className="group-label">Runtime</p>
            <select value={spec.runtime} onChange={(event) => updateSpec({ runtime: event.target.value })}>
              <option value="local-nextjs">Local Next.js builder</option>
              <option value="local-sandbox">Local sandbox agent</option>
              <option value="local-python">Local Python runtime</option>
              <option value="hosted-api">Hosted API service</option>
              <option value="hybrid">Hybrid local + cloud</option>
            </select>
          </div>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <div>
              <p className="eyebrow">Flow</p>
              <h2>{spec.projectName}</h2>
            </div>
            <div className="toolbar-actions">
              <button className="icon-button" onClick={addNode} title="Add agent node" aria-label="Add agent node">
                <Plus size={17} />
              </button>
              <button
                className={`icon-button ${connectingFrom ? "is-active" : ""}`}
                onClick={() => setConnectingFrom(selectedNode?.id ?? null)}
                title="Connect selected node"
                aria-label="Connect selected node"
              >
                <Link2 size={17} />
              </button>
              <button className="icon-button" onClick={orderFlow} title="Order flow stages" aria-label="Order flow stages">
                <Workflow size={17} />
              </button>
              <button className="icon-button danger" onClick={() => selectedNode && removeNode(selectedNode.id)} title="Delete selected stage" aria-label="Delete selected stage" disabled={!selectedNode}>
                <Trash2 size={16} />
              </button>
              <button className="icon-button" onClick={() => setFlowExpanded(true)} title="Expand flow view" aria-label="Expand flow view">
                <Maximize2 size={17} />
              </button>
            </div>
          </div>

          <FlowCanvas
            spec={spec}
            selectedNode={selectedNode}
            connectingFrom={connectingFrom}
            onCanvasPointerMove={handleCanvasPointerMove}
            onCanvasPointerUp={() => setDragState(null)}
            onNodePointerDown={handleNodePointerDown}
            onNodeClick={handleNodeClick}
          />
        </section>

        <aside className="panel inspector-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Inspector</p>
              <h2>Define the contract</h2>
            </div>
            <MousePointer2 size={18} />
          </div>

          <div className="form-stack">
            <Field label="Agent name">
              <input value={spec.projectName} onChange={(event) => updateSpec({ projectName: event.target.value })} />
            </Field>
            <Field label="Description">
              <textarea value={spec.description} onChange={(event) => updateSpec({ description: event.target.value })} rows={3} />
            </Field>
            <Field label="Model provider">
              <select value={spec.modelProvider} onChange={(event) => updateSpec({ modelProvider: event.target.value })}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="ollama">Ollama / local</option>
                <option value="nvidia-nim">NVIDIA NIM</option>
                <option value="multi-provider">Multi-provider</option>
              </select>
            </Field>
          </div>

          {selectedNode ? (
            <div className="node-editor">
              <div className="editor-head">
                <p className="group-label">Selected node</p>
                <button className="icon-button danger" onClick={() => removeNode(selectedNode.id)} title="Delete node" aria-label="Delete node">
                  <Trash2 size={16} />
                </button>
              </div>
              <Field label="Title">
                <input value={selectedNode.title} onChange={(event) => updateSelectedNode({ title: event.target.value })} />
              </Field>
              <Field label="Role">
                <select value={selectedNode.kind} onChange={(event) => updateSelectedNode({ kind: event.target.value })}>
                  <option value="agent">Agent</option>
                  <option value="orchestrator">Orchestrator</option>
                  <option value="tool">Tool</option>
                  <option value="executor">Executor</option>
                  <option value="guardrail">Guardrail</option>
                  <option value="approval">Approval</option>
                  <option value="memory">Memory</option>
                  <option value="state">State</option>
                  <option value="verifier">Verifier</option>
                  <option value="eval">Eval</option>
                </select>
              </Field>
              <Field label="Description">
                <textarea value={selectedNode.description} onChange={(event) => updateSelectedNode({ description: event.target.value })} rows={3} />
              </Field>
              <Field label="Tools">
                <input value={joinList(selectedNode.tools)} onChange={(event) => updateSelectedNode({ tools: splitList(event.target.value) })} />
              </Field>
              <Field label="Inputs">
                <input value={joinList(selectedNode.inputs)} onChange={(event) => updateSelectedNode({ inputs: splitList(event.target.value) })} />
              </Field>
              <Field label="Outputs">
                <input value={joinList(selectedNode.outputs)} onChange={(event) => updateSelectedNode({ outputs: splitList(event.target.value) })} />
              </Field>
              <Field label="Permission">
                <select value={selectedNode.permission} onChange={(event) => updateSelectedNode({ permission: event.target.value })}>
                  <option value="allow-read">Allow read</option>
                  <option value="ask-first">Ask first</option>
                  <option value="approval-required">Approval required</option>
                  <option value="deny-by-default">Deny by default</option>
                </select>
              </Field>
            </div>
          ) : null}
        </aside>
      </section>

      <section className="bottom-grid">
        <div className="panel output-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Build output</p>
              <h2>Files that will be created</h2>
            </div>
            <FileCode2 size={18} />
          </div>

          <div className="status-row">
            <span><Braces size={15} /> {artifacts.files.length} files</span>
            <span><Database size={15} /> generated/agents</span>
            <span><Shield size={15} /> {spec.sandbox}</span>
            <span><ListChecks size={15} /> {spec.evals.length} evals</span>
            {spec.learning ? <span><Sparkles size={15} /> {spec.learning.domain}</span> : null}
          </div>

          {buildState.status === "built" ? (
            <div className="success-box">
              <Check size={17} />
              <span>
                Created installable agent package in <strong>{buildState.installableDir ?? buildState.outputDir}</strong>
              </span>
            </div>
          ) : null}

          {buildState.status === "error" ? (
            <div className="error-box">
              <AlertTriangle size={17} />
              <span>{buildState.error}</span>
            </div>
          ) : null}

          <div className="preview-tabs" role="tablist" aria-label="Preview output">
            <button className={previewMode === "files" ? "is-active" : ""} onClick={() => setPreviewMode("files")}>Files</button>
            <button className={previewMode === "yaml" ? "is-active" : ""} onClick={() => setPreviewMode("yaml")}>YAML</button>
            <button className={previewMode === "manifest" ? "is-active" : ""} onClick={() => setPreviewMode("manifest")}>JSON</button>
          </div>

          {previewMode === "files" ? (
            <div className="file-list">
              {artifacts.files.map((file) => (
                <span key={file.path}>
                  <ChevronRight size={14} />
                  {file.path}
                </span>
              ))}
            </div>
          ) : null}
          {previewMode === "yaml" ? <pre className="code-preview">{yamlPreview}</pre> : null}
          {previewMode === "manifest" ? <pre className="code-preview">{manifestPreview}</pre> : null}
        </div>

        <div className="panel source-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">References</p>
              <h2>Docs to check before implementation</h2>
            </div>
            <Database size={18} />
          </div>
          <div className="source-list">
            {SOURCE_REGISTRY.slice(0, 8).map((source) => (
              <a href={source.url} key={source.id} target="_blank" rel="noreferrer">
                <strong>{source.name}</strong>
                <span>{source.category} · {source.lastChecked}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {flowExpanded ? (
        <section className="flow-expanded" aria-label="Expanded flow view">
          <div className="flow-expanded-panel">
            <div className="canvas-toolbar">
              <div>
                <p className="eyebrow">Flow</p>
                <h2>{spec.projectName}</h2>
              </div>
              <div className="toolbar-actions">
                <button className="icon-button" onClick={addNode} title="Add stage" aria-label="Add stage">
                  <Plus size={17} />
                </button>
                <button
                  className={`icon-button ${connectingFrom ? "is-active" : ""}`}
                  onClick={() => setConnectingFrom(selectedNode?.id ?? null)}
                  title="Connect selected stage"
                  aria-label="Connect selected stage"
                >
                  <Link2 size={17} />
                </button>
                <button className="icon-button" onClick={orderFlow} title="Order flow stages" aria-label="Order flow stages">
                  <Workflow size={17} />
                </button>
                <button className="icon-button danger" onClick={() => selectedNode && removeNode(selectedNode.id)} title="Delete selected stage" aria-label="Delete selected stage" disabled={!selectedNode}>
                  <Trash2 size={16} />
                </button>
                <button className="icon-button" onClick={() => setFlowExpanded(false)} title="Collapse flow view" aria-label="Collapse flow view">
                  <Minimize2 size={17} />
                </button>
              </div>
            </div>
            <FlowCanvas
              spec={spec}
              selectedNode={selectedNode}
              connectingFrom={connectingFrom}
              expanded
              onCanvasPointerMove={handleCanvasPointerMove}
              onCanvasPointerUp={() => setDragState(null)}
              onNodePointerDown={handleNodePointerDown}
              onNodeClick={handleNodeClick}
            />
          </div>
        </section>
      ) : null}
    </main>
  );
}
