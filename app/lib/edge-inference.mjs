// Pass 16 — LLM-inferred edge ordering for sparse graphs.
//
// When a graph has no explicit edges AND no declared inputs/outputs, the
// runtime today emits a warning and runs every node in parallel. Pass 16
// adds an opt-in inference call: ask the model to suggest data-flow edges
// based on each node's role + title + description + instructions.
//
// Studio bucket policy (per docs/SPEC.md):
//   - Inferred-but-not-accepted edges → studio-only ghost overlay; never exported.
//   - Accepted inferred edges → portable; merged into canvas.edges and serialized.
//
// Cost guardrails (lifted from runtime-config.mjs):
//   - At most `inferenceCallsPerRun` (default 1) inference calls per Run action.
//     We don't actively enforce a per-run counter inside this module — the
//     /api/agent/infer-edges route is the single entry point, and the canvas
//     page only invokes it once per "Run" attempt.
//   - Per-project cache keyed by a stable hash of the graph's node identity
//     so an unchanged graph doesn't re-infer. The cache lives in
//     `project.runCache.__inferredEdges` (a reserved nodeId), so it's
//     subject to the same `runCacheBytesPerEntry` cap from storage-config.

import { DEFAULT_RUNTIME_CONFIG } from "./runtime-config.mjs";

// Reserved nodeId. Prefixed with "__" so a real node id can't collide.
export const INFERRED_EDGES_CACHE_KEY = "__inferredEdges";

// Stable hash of the graph's "shape that matters for inference" — node
// ids + roles + titles + descriptions + instructions. Edge presence is
// checked separately (we only run inference when edges.length===0). Order
// is normalized by sorting on id so a UI re-shuffle doesn't invalidate.
export function graphHashFor(project) {
  const nodes = Array.isArray(project?.canvas?.nodes) ? project.canvas.nodes : [];
  const sorted = nodes
    .map((n) => ({
      id: n.id,
      role: n.role,
      title: n.title || "",
      description: n.description || "",
      instructions: n.instructions || "",
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const text = JSON.stringify(sorted);
  // djb2 — same algorithm test-roundtrip uses for its mock fingerprint.
  // Stable across runs without crypto. 32-bit hex.
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

// True when a graph qualifies for inference: zero edges AND every node
// has empty/missing inputs+outputs declarations.
export function shouldInferEdges(project) {
  const nodes = Array.isArray(project?.canvas?.nodes) ? project.canvas.nodes : [];
  const edges = Array.isArray(project?.canvas?.edges) ? project.canvas.edges : [];
  if (nodes.length < 2) return false;
  if (edges.length > 0) return false;
  for (const n of nodes) {
    if (Array.isArray(n.inputs) && n.inputs.length > 0) return false;
    if (Array.isArray(n.outputs) && n.outputs.length > 0) return false;
  }
  return true;
}

// Read the cached inference result for this project's current graph hash.
// Returns the cached `[{from, to, reason}]` array or null. Reads through
// runCache so the storage-config byte cap applies uniformly.
export function readCachedInference(project) {
  const cache = project?.runCache?.[INFERRED_EDGES_CACHE_KEY];
  if (!cache || typeof cache !== "object") return null;
  const expectedHash = graphHashFor(project);
  if (cache.input !== expectedHash) return null;
  if (!cache.output || !Array.isArray(cache.output)) return null;
  return cache.output;
}

// Build the prompt the inference call sends. Kept in this module so the
// route is a thin transport; future tweaks (few-shot examples, format
// schema) land here.
export function buildInferencePrompt(project) {
  const nodes = Array.isArray(project?.canvas?.nodes) ? project.canvas.nodes : [];
  const desc = nodes.map((n) => ({
    id: n.id,
    role: n.role,
    title: n.title,
    description: n.description || "",
    instructions: n.instructions || "",
  }));
  return [
    {
      role: "system",
      content: [
        "You are an AI agent dependency inferrer.",
        "Given a list of agent nodes (id, role, title, description, instructions),",
        "infer the data-flow edges the user most likely intended. Each edge is a",
        "directed dependency: { from: <producer node id>, to: <consumer node id>, reason: <one-sentence rationale> }.",
        "",
        "Return STRICT JSON with the shape:",
        '{ "edges": [ { "from": "<id>", "to": "<id>", "reason": "<text>" }, ... ] }',
        "",
        "Rules:",
        "- Only emit edges where the consumer needs the producer's output.",
        "- Never emit a self-loop (from === to).",
        "- Never emit a cycle.",
        "- If the graph has no plausible ordering, return { \"edges\": [] }.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `Nodes:\n${JSON.stringify(desc, null, 2)}\n\nReturn the inferred edges.`,
    },
  ];
}

// Sanitize the LLM's reply: keep only well-formed `{from,to,reason?}`
// objects whose ids exist in the graph; drop self-loops; drop duplicates.
// Cycle detection is delegated to the runtime planner — the user can still
// accept cyclic-looking output if they want, but the runtime will reject
// it before any further LLM call.
export function sanitizeInferredEdges(raw, project) {
  const nodes = Array.isArray(project?.canvas?.nodes) ? project.canvas.nodes : [];
  const ids = new Set(nodes.map((n) => n.id));
  if (!raw || typeof raw !== "object") return [];
  const edges = Array.isArray(raw.edges) ? raw.edges : [];
  const seen = new Set();
  const out = [];
  for (const e of edges) {
    if (!e || typeof e !== "object") continue;
    const from = typeof e.from === "string" ? e.from : null;
    const to = typeof e.to === "string" ? e.to : null;
    if (!from || !to) continue;
    if (from === to) continue;
    if (!ids.has(from) || !ids.has(to)) continue;
    const key = `${from}->${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      from,
      to,
      reason: typeof e.reason === "string" ? e.reason : "",
    });
  }
  return out;
}

// Maximum inference calls per Run. Re-exported for the route's bookkeeping
// (and so a future settings UI has one number to surface).
export const INFERENCE_CALLS_PER_RUN = DEFAULT_RUNTIME_CONFIG.inferenceCallsPerRun;
