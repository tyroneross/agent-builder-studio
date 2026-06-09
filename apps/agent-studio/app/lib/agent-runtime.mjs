// Generic DAG runtime for an agent-studio project.
//
// Inputs:
//   project: { id, name, goal, context, outcome, uploads, canvas: { nodes, edges } }
//     Each node may also carry optional `inputs: string[]` and `outputs: string[]`
//     declarations. A node with `inputs: ["scope"]` depends on any node with
//     `outputs: ["scope"]`. These declarations augment explicit edges; they do
//     not replace them.
//   query:    string — the user's test query / runtime input
//   model?:   string — Ollama model name (defaults to env OLLAMA_MODEL or gpt-oss:20b)
//   onEvent:  (event) => void — receives every progress event (see below)
//   signal?:  AbortSignal — caller can cancel the run mid-flight
//   baseUrl?: string — Ollama base url (default http://localhost:11434)
//
// Events:
//   { type: "warmup" }
//   { type: "warmup-ok", model }
//   { type: "warmup-fail", error }
//   { type: "warning", text }
//   { type: "level-start", level, nodeIds }
//   { type: "node-start", id, name, role }
//   { type: "node-chunk", id, bytes }                 // running byte count of streamed body
//   { type: "node-end", id, durationMs, bytes, parsed, output }
//   { type: "node-error", id, error }
//   { type: "complete", transcript, brief }
//
// Cycle detection: throws Error("graph has cycles: <list>") before any LLM call.
// No-order graph (no edges, no inputs/outputs declarations): emits a warning
//   and runs every node at level 0 in parallel.
// Per-level parallelism is capped at 4 via Promise.all over chunks of 4.
//
// Streaming pattern: POST /api/chat with stream:true, format:"json",
// temperature 0.2, num_ctx 8192. The body is NDJSON; each line is a JSON
// object with at least { message: { content }, done }. We accumulate
// message.content until done:true and then JSON.parse() the result.
// TAG:ASSUMED — Ollama /api/chat NDJSON streaming protocol (documented stable).

import { getEffectiveRoleTemplate, HARD_RULES } from "./role-templates.mjs";
import { DEFAULT_RUNTIME_CONFIG } from "./runtime-config.mjs";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL =
  (typeof process !== "undefined" && process.env && process.env.OLLAMA_MODEL) ||
  "gpt-oss:20b";
// Pass 15 — sourced from runtime-config so the value is visible alongside
// other runtime tunables. Reading a const from the frozen config object
// keeps the runtime hot path allocation-free.
const PER_LEVEL_PARALLELISM = DEFAULT_RUNTIME_CONFIG.perLevelParallelism;

// Pass 7: test-only ring buffer of the last system prompts composed by
// buildMessages(). The self-consistency test inspects this to assert that a
// per-project role-prompt override actually reaches Ollama. Capped at 32
// entries so a long-running dev server doesn't grow this unbounded.
const SYSTEM_PROMPT_RING_CAP = 32;
export const _lastSystemPrompts = [];
function recordSystemPrompt(prompt) {
  _lastSystemPrompts.push(prompt);
  if (_lastSystemPrompts.length > SYSTEM_PROMPT_RING_CAP) {
    _lastSystemPrompts.splice(0, _lastSystemPrompts.length - SYSTEM_PROMPT_RING_CAP);
  }
}

// ── Topological planner ────────────────────────────────────────────────────

// Given nodes + edges + per-node inputs/outputs declarations, compute the set
// of dependency edges as a Map<toId, Set<fromId>>.
//
// Explicit edges are added as-is. Then for every node N with `inputs: [t]` and
// every node M with `outputs: [t]`, we add M -> N. Self-loops are ignored.
function computeDependencies(nodes, edges) {
  const incoming = new Map(); // toId -> Set<fromId>
  for (const node of nodes) incoming.set(node.id, new Set());

  for (const edge of edges) {
    if (!incoming.has(edge.to) || !incoming.has(edge.from)) continue;
    if (edge.from === edge.to) continue;
    incoming.get(edge.to).add(edge.from);
  }

  // Producers index: tag -> [nodeIds that output it]
  const producers = new Map();
  for (const node of nodes) {
    if (Array.isArray(node.outputs)) {
      for (const tag of node.outputs) {
        if (typeof tag !== "string" || !tag) continue;
        if (!producers.has(tag)) producers.set(tag, []);
        producers.get(tag).push(node.id);
      }
    }
  }

  // For each consumer (inputs:[]), wire edges from each producer of that tag.
  for (const node of nodes) {
    if (!Array.isArray(node.inputs)) continue;
    for (const tag of node.inputs) {
      const list = producers.get(tag);
      if (!list) continue;
      for (const fromId of list) {
        if (fromId === node.id) continue;
        incoming.get(node.id).add(fromId);
      }
    }
  }

  return incoming;
}

function hasOrderingSignal(nodes, edges) {
  if (edges.length > 0) return true;
  for (const n of nodes) {
    if (Array.isArray(n.inputs) && n.inputs.length > 0) return true;
    if (Array.isArray(n.outputs) && n.outputs.length > 0) return true;
  }
  return false;
}

// Kahn's algorithm with level batching: at each level, emit all nodes whose
// remaining in-degree is zero. If any nodes remain after we exhaust the
// frontier, the graph has a cycle.
function levelize(nodes, incoming) {
  const remaining = new Map();
  for (const [id, set] of incoming) remaining.set(id, new Set(set));

  const idsLeft = new Set(nodes.map((n) => n.id));
  const levels = [];

  while (idsLeft.size > 0) {
    const ready = [];
    for (const id of idsLeft) {
      const deps = remaining.get(id);
      if (!deps || deps.size === 0) ready.push(id);
    }
    if (ready.length === 0) {
      // Cycle: every remaining node has at least one unmet dependency.
      const cyclic = Array.from(idsLeft).sort();
      const err = new Error(`graph has cycles: ${cyclic.join(", ")}`);
      err.code = "CYCLE";
      err.cyclicNodes = cyclic;
      throw err;
    }
    levels.push(ready);
    for (const id of ready) {
      idsLeft.delete(id);
      // Remove this id from every other node's remaining set.
      for (const set of remaining.values()) set.delete(id);
    }
  }

  return levels;
}

export function planExecution(project) {
  const nodes = project?.canvas?.nodes ?? [];
  const edges = project?.canvas?.edges ?? [];
  if (nodes.length === 0) {
    return { levels: [], hasOrdering: false, incoming: new Map() };
  }
  const incoming = computeDependencies(nodes, edges);
  const ordering = hasOrderingSignal(nodes, edges);
  if (!ordering) {
    // No edges, no inputs/outputs: every node is level 0.
    return {
      levels: [nodes.map((n) => n.id)],
      hasOrdering: false,
      incoming,
    };
  }
  const levels = levelize(nodes, incoming);
  return { levels, hasOrdering: true, incoming };
}

// ── Prompt composition ─────────────────────────────────────────────────────

// Pass 11: build the project-level context block. When `loadedUploads` is
// supplied (route resolved each upload's contents and policed the byte budget),
// inline each file's contents under a labeled section. Files past the budget
// arrive with truncated/skipped flags; we surface those as a single trailing
// note rather than silently dropping them. The route owns disk reads and the
// path allowlist; this function never touches the filesystem.
function projectContextBlock(project, loadedUploads) {
  const lines = [];
  if (project.goal) lines.push(`Project goal: ${project.goal}`);
  if (project.outcome) lines.push(`Desired outcome: ${project.outcome}`);
  if (project.context) lines.push(`Project context: ${project.context}`);

  const loaded = Array.isArray(loadedUploads) ? loadedUploads : [];
  const inlined = loaded.filter((u) => typeof u?.contents === "string" && u.contents.length > 0);
  for (const u of inlined) {
    lines.push("");
    lines.push(`### Uploaded context: ${u.name}`);
    lines.push(u.contents);
    if (u.truncated) {
      lines.push(`(${u.name} truncated to fit context budget)`);
    }
  }
  const skippedCount = loaded.filter((u) => u && u.skipped === true).length;
  if (skippedCount > 0) {
    lines.push("");
    lines.push(`(${skippedCount} more file${skippedCount === 1 ? "" : "s"} truncated due to context budget)`);
  }
  return lines.join("\n");
}

function upstreamOutputsBlock(node, incoming, results) {
  const deps = incoming.get(node.id);
  if (!deps || deps.size === 0) return "";
  const sections = [];
  for (const fromId of deps) {
    const r = results.get(fromId);
    if (!r) continue;
    const payload = r.parsed ?? r.text ?? null;
    sections.push(
      `From upstream node "${r.title || fromId}" (role: ${r.role}):\n${
        typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
      }`,
    );
  }
  return sections.join("\n\n");
}

function buildMessages(node, project, query, incoming, results, loadedUploads) {
  // Pass 7: prefer the per-project role-prompt override when present, else
  // fall back to the hardcoded default for the role.
  const roleTemplate = getEffectiveRoleTemplate(node.role, project?.rolePromptOverrides);
  const sysParts = [HARD_RULES, "", roleTemplate];
  const userParts = [];

  const ctx = projectContextBlock(project, loadedUploads);
  if (ctx) userParts.push(ctx);

  if (typeof node.instructions === "string" && node.instructions.trim()) {
    userParts.push(`Node-specific instructions:\n${node.instructions.trim()}`);
  }

  userParts.push(`Node title: ${node.title}\nNode description: ${node.description}`);

  const upstream = upstreamOutputsBlock(node, incoming, results);
  if (upstream) userParts.push(upstream);

  if (query) userParts.push(`User query: ${query}`);

  userParts.push(
    "Respond with the strict JSON object required by your role template. No commentary outside the JSON.",
  );

  const systemContent = sysParts.join("\n");
  // Test-only hook: record the composed system prompt before it leaves the
  // process. Inspected by scripts/test-self.mjs to assert override flow.
  recordSystemPrompt(systemContent);

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userParts.join("\n\n") },
  ];
}

// ── Ollama streaming caller ────────────────────────────────────────────────

async function checkOllama(baseUrl, signal) {
  const res = await fetch(`${baseUrl}/api/tags`, {
    signal,
  });
  if (!res.ok) throw new Error(`ollama tags returned ${res.status}`);
  const body = await res.json();
  const models = (body.models ?? []).map((m) => m.name);
  return { models };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Stream the chat response. Returns { text, parsed, bytes }.
// onChunkBytes(bytes) is called as bytes accumulate.
//
// Pass 14 — deterministic re-runs. When OLLAMA_SEED is set in the env, we
// pass `options.seed` to /api/chat and force `temperature: 0`. This is the
// minimum knob set Ollama's docs say is needed for reproducible outputs
// (same machine, same model build). The round-trip harness depends on this.
async function streamChat(baseUrl, model, messages, signal, onChunkBytes) {
  const seedEnv =
    typeof process !== "undefined" && process.env ? process.env.OLLAMA_SEED : undefined;
  const seed = seedEnv != null && seedEnv !== "" ? Number(seedEnv) : null;
  const deterministic = Number.isFinite(seed);

  const options = {
    temperature: deterministic ? 0 : 0.2,
    num_ctx: 8192,
  };
  if (deterministic) options.seed = seed;

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      format: "json",
      options,
    }),
    signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ollama /api/chat returned ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let collected = "";
  let bytes = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let evt;
      try {
        evt = JSON.parse(line);
      } catch {
        continue;
      }
      const piece = evt?.message?.content ?? "";
      if (piece) {
        collected += piece;
        bytes += Buffer.byteLength(piece, "utf8");
        if (onChunkBytes) onChunkBytes(bytes);
      }
      if (evt?.done) {
        // drain any remaining buffer; loop will exit naturally
      }
    }
  }
  // flush any trailing line
  const tail = buffer.trim();
  if (tail) {
    try {
      const evt = JSON.parse(tail);
      const piece = evt?.message?.content ?? "";
      if (piece) {
        collected += piece;
        bytes += Buffer.byteLength(piece, "utf8");
        if (onChunkBytes) onChunkBytes(bytes);
      }
    } catch {
      /* ignore */
    }
  }

  return { text: collected, parsed: safeJsonParse(collected), bytes };
}

// ── Subagent dispatcher ───────────────────────────────────────────────────
//
// Pass 18 — when a node has role "subagent", we resolve its referenced
// project via the route-supplied `resolveSubagentProject` and recurse.
//
// Cycle detection: the chain of project ids is threaded through every
// recursive call; a subagent that points back to any project already in
// the chain is rejected before any LLM call.
//
// Depth cap: `runtime-config.subagentMaxDepth` (default 3). Top-level call
// is depth 0; each recursive call increments. Exceeding the cap surfaces
// as a clean node-error.
//
// Result shape mirrors a normal LLM call: { parsed, text, bytes, error,
// subagent: { ref, transcript } }. The `subagent` field is studio-only
// inspector context — the inspector drills into it; spec export drops it
// (only the static `subagent.ref` portable field travels with the spec).

async function runSubagentNode({
  node,
  project,
  resolveSubagentProject,
  chain,
  depth,
  model,
  baseUrl,
  signal,
  loadedUploads,
  upstreamResults,
  onEvent,
}) {
  const ref = node.subagentProjectId;
  if (!ref) {
    return {
      bytes: 0,
      parsed: null,
      text: "",
      error: `subagent node "${node.id}" has no subagentProjectId set`,
      subagent: null,
    };
  }
  if (typeof resolveSubagentProject !== "function") {
    return {
      bytes: 0,
      parsed: null,
      text: "",
      error: `subagent node "${node.id}" cannot be resolved (no resolver provided to runProject)`,
      subagent: { ref, transcript: null },
    };
  }
  // Cycle check.
  if (chain.includes(ref)) {
    const trail = chain.concat(ref).join(" → ");
    return {
      bytes: 0,
      parsed: null,
      text: "",
      error: `subagent cycle detected: ${trail}`,
      subagent: { ref, transcript: null },
    };
  }
  // Depth cap.
  const cap = DEFAULT_RUNTIME_CONFIG.subagentMaxDepth;
  if (depth + 1 > cap) {
    return {
      bytes: 0,
      parsed: null,
      text: "",
      error: `subagent depth cap (${cap}) exceeded at "${node.id}"`,
      subagent: { ref, transcript: null },
    };
  }
  const childProject = resolveSubagentProject(ref);
  if (!childProject || !childProject.canvas) {
    return {
      bytes: 0,
      parsed: null,
      text: "",
      error: `subagent project "${ref}" not found in store`,
      subagent: { ref, transcript: null },
    };
  }

  // Compose the subagent's "query" from upstream results when present —
  // otherwise pass the parent's (cached) goal so the inner project still
  // has a prompt to run against.
  const upstream = [];
  for (const [, r] of upstreamResults) {
    if (!r) continue;
    upstream.push(r.parsed ?? r.text ?? null);
  }
  const subQuery = upstream.length > 0
    ? JSON.stringify(upstream, null, 2)
    : (project.goal || "");

  // Capture child events to bubble a `subagent-event` envelope to the
  // parent caller — useful for inspector drill-down. Top-level events
  // (warmup, level-start, etc.) are not echoed to the parent's onEvent so
  // the parent UI doesn't double-render.
  let subTranscript = null;
  const subEvents = [];
  const subOnEvent = (evt) => {
    subEvents.push(evt);
    if (evt.type === "complete") subTranscript = evt.transcript;
  };
  try {
    const { transcript } = await runProject({
      project: childProject,
      query: subQuery,
      model,
      baseUrl,
      signal,
      loadedUploads,
      // step gate is parent-only; nested runs always advance freely.
      onEvent: subOnEvent,
      resolveSubagentProject,
      callChain: chain.concat(ref),
    });
    if (!subTranscript) subTranscript = transcript;
  } catch (err) {
    return {
      bytes: 0,
      parsed: null,
      text: "",
      error: err?.message || "subagent run failed",
      subagent: { ref, transcript: subTranscript },
    };
  }
  // Surface a single envelope event so the parent UI can update progress
  // without verbose echo of every child event.
  onEvent({
    type: "subagent-complete",
    id: node.id,
    ref,
    childNodeCount: subTranscript?.nodes?.length ?? 0,
  });
  // The subagent's "output" is the parsed payload of its last node when
  // available, else the full transcript stringified. We pass parsed when
  // possible so downstream nodes get structured data (per the design
  // doc's mitigation: "pass only the parsed output, not raw text").
  const lastNode = subTranscript?.nodes?.[subTranscript.nodes.length - 1] ?? null;
  const parsed = lastNode?.parsed ?? null;
  const text = parsed != null ? JSON.stringify(parsed) : (lastNode?.output ?? "");
  const bytes = Buffer.byteLength(text, "utf8");
  return {
    bytes,
    parsed,
    text,
    subagent: { ref, transcript: subTranscript },
  };
}

// ── Public entry point ─────────────────────────────────────────────────────

export async function runProject({
  project,
  query,
  model,
  onEvent = () => {},
  signal,
  baseUrl = DEFAULT_BASE_URL,
  // Pass 11: pre-resolved upload contents from the route. Shape:
  //   [{ name, contents, truncated?, skipped? }]
  // The route is the Node-runtime boundary that owns disk access + the path
  // allowlist; this lib stays filesystem-free so it remains testable under a
  // mocked fetch and portable to other deploy targets.
  loadedUploads,
  // Pass 15 — optional async hook called BEFORE each DAG level executes.
  // Implementers can return a promise that resolves when the user clicks
  // "next level". Used by /api/agent/run when `step: true` is set in the
  // request body. Default no-op resolves immediately so non-step runs are
  // unaffected.
  stepGate,
  // Pass 18 — subagent resolver. The runtime stays store-agnostic; the
  // route passes a function that maps a projectId → project object. When a
  // node has role "subagent" and a non-null subagentProjectId, the runtime
  // calls this resolver and recursively runProject()'s the child.
  // Shape: (projectId) => project | null
  resolveSubagentProject,
  // Pass 18 — chain of project ids currently being executed (parent →
  // child → grandchild). Used by recursion for cycle + depth detection.
  // Defaults to [project.id] for the top-level call.
  callChain,
}) {
  if (!project || !project.canvas) {
    throw new Error("project with canvas required");
  }
  const nodes = project.canvas.nodes ?? [];
  const edges = project.canvas.edges ?? [];
  if (nodes.length === 0) {
    onEvent({ type: "warning", text: "project has no nodes — nothing to run" });
    const transcript = { project: project.id, query, model: null, levels: [], nodes: [] };
    const brief = composeBrief({ project, query, transcript });
    onEvent({ type: "complete", transcript, brief });
    return { transcript, brief };
  }

  // Plan first. Cycle detection happens in planExecution before any network call.
  const plan = planExecution(project);
  if (!plan.hasOrdering) {
    onEvent({
      type: "warning",
      text: "no order detected — running all nodes in parallel; add edges or declare inputs/outputs to control flow",
    });
  }

  // Warmup probe: confirm Ollama is reachable. We surface failures via events
  // and then re-throw so the caller can stop the run.
  onEvent({ type: "warmup" });
  let resolvedModel = model || DEFAULT_MODEL;
  try {
    const status = await checkOllama(baseUrl, signal);
    if (status.models.length === 0) {
      throw new Error("ollama has no models pulled");
    }
    if (!status.models.includes(resolvedModel)) {
      // Fall back to whatever's first; surface a warning.
      onEvent({
        type: "warning",
        text: `model "${resolvedModel}" not found locally; using "${status.models[0]}"`,
      });
      resolvedModel = status.models[0];
    }
    onEvent({ type: "warmup-ok", model: resolvedModel });
  } catch (err) {
    onEvent({ type: "warmup-fail", error: err.message || String(err) });
    throw err;
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const results = new Map(); // id -> { id, role, title, durationMs, bytes, parsed, text }

  // Pass 18 — recursion bookkeeping. The parent call seeds the chain with
  // its own id; child runProject calls extend it. Reject if depth would
  // exceed the configured cap or if a cycle would form.
  const _chain = Array.isArray(callChain) && callChain.length > 0
    ? callChain.slice()
    : [project.id];
  const _depth = _chain.length - 1; // top-level = 0

  for (let levelIdx = 0; levelIdx < plan.levels.length; levelIdx++) {
    const ids = plan.levels[levelIdx];
    onEvent({ type: "level-start", level: levelIdx, nodeIds: ids });

    // Pass 15 — step-through hook. The route uses this to wait for the
    // client's "next level" click before advancing. Default no-op resolves
    // immediately. The hook receives { level, nodeIds } so a future UI can
    // render context before resuming.
    if (typeof stepGate === "function") {
      try {
        await stepGate({ level: levelIdx, nodeIds: ids });
      } catch (err) {
        // A gate rejection is treated as a clean cancel.
        onEvent({ type: "node-error", id: null, error: err?.message || "step cancelled" });
        break;
      }
    }

    // Run in chunks of PER_LEVEL_PARALLELISM. Promise.all over each chunk.
    for (let i = 0; i < ids.length; i += PER_LEVEL_PARALLELISM) {
      const chunk = ids.slice(i, i + PER_LEVEL_PARALLELISM);
      await Promise.all(
        chunk.map(async (id) => {
          const node = nodeById.get(id);
          if (!node) return;
          onEvent({ type: "node-start", id, name: node.title, role: node.role });
          const t0 = Date.now();
          try {
            // Pass 18 — subagent role. Recursively run the referenced
            // project. The subagent's parsed output (or full transcript
            // when none) becomes this node's result.
            if (node.role === "subagent") {
              const subResult = await runSubagentNode({
                node,
                project,
                resolveSubagentProject,
                chain: _chain,
                depth: _depth,
                model,
                baseUrl,
                signal,
                loadedUploads,
                upstreamResults: results,
                onEvent,
              });
              const durationMs = Date.now() - t0;
              results.set(id, {
                id,
                role: node.role,
                title: node.title,
                durationMs,
                bytes: subResult.bytes,
                parsed: subResult.parsed,
                text: subResult.text,
                subagent: subResult.subagent,
                error: subResult.error ?? null,
                systemPrompt: "",
                userMessage: "",
              });
              if (subResult.error) {
                onEvent({ type: "node-error", id, error: subResult.error });
              } else {
                onEvent({
                  type: "node-end",
                  id,
                  durationMs,
                  bytes: subResult.bytes,
                  parsed: subResult.parsed,
                  output: subResult.text,
                  subagent: subResult.subagent,
                });
              }
              return;
            }

            const messages = buildMessages(node, project, query, plan.incoming, results, loadedUploads);
            const systemPrompt = messages.find((m) => m.role === "system")?.content ?? "";
            const userMessage = messages.find((m) => m.role === "user")?.content ?? "";

            // Pass 15 — per-node mock substitution. When `mockOutput` is set,
            // skip the LLM call entirely and emit the mock as the parsed
            // payload. Mocks are studio-only (stripped on export per Pass 14
            // bucket table); the runtime tags the event with `mocked: true`
            // so the inspector can render the badge.
            if (node.mockOutput != null) {
              const parsed = node.mockOutput;
              const text = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
              const bytes = Buffer.byteLength(text, "utf8");
              const durationMs = Date.now() - t0;
              results.set(id, {
                id,
                role: node.role,
                title: node.title,
                durationMs,
                bytes,
                parsed,
                text,
                mocked: true,
                systemPrompt,
                userMessage,
              });
              onEvent({
                type: "node-end",
                id,
                durationMs,
                bytes,
                parsed,
                output: text,
                mocked: true,
              });
              return;
            }

            const { text, parsed, bytes } = await streamChat(
              baseUrl,
              resolvedModel,
              messages,
              signal,
              (bytesSoFar) => onEvent({ type: "node-chunk", id, bytes: bytesSoFar }),
            );
            const durationMs = Date.now() - t0;
            results.set(id, {
              id,
              role: node.role,
              title: node.title,
              durationMs,
              bytes,
              parsed,
              text,
              systemPrompt,
              userMessage,
            });
            onEvent({
              type: "node-end",
              id,
              durationMs,
              bytes,
              parsed,
              output: text,
            });
          } catch (err) {
            const durationMs = Date.now() - t0;
            results.set(id, {
              id,
              role: node.role,
              title: node.title,
              durationMs,
              bytes: 0,
              parsed: null,
              text: "",
              error: err.message || String(err),
            });
            onEvent({ type: "node-error", id, error: err.message || String(err) });
          }
        }),
      );
    }
  }

  const transcript = {
    project: project.id,
    projectName: project.name,
    query,
    model: resolvedModel,
    startedAt: new Date().toISOString(),
    levels: plan.levels,
    nodes: nodes.map((n) => {
      const r = results.get(n.id);
      return {
        id: n.id,
        title: n.title,
        role: n.role,
        instructions: n.instructions ?? "",
        description: n.description ?? "",
        durationMs: r?.durationMs ?? 0,
        bytes: r?.bytes ?? 0,
        parsed: r?.parsed ?? null,
        output: r?.text ?? "",
        error: r?.error ?? null,
        // Pass 15 — inspector context. Only present for nodes that actually
        // ran (results entry exists). Mocked nodes carry `mocked: true` so
        // the panel can show a badge without sniffing the payload.
        systemPrompt: r?.systemPrompt ?? "",
        userMessage: r?.userMessage ?? "",
        mocked: r?.mocked === true,
        // Pass 18 — subagent drill-down. Studio-only inspector context;
        // the spec export drops everything except the static
        // `subagentProjectId` / `subagent.ref` portable field.
        subagent: r?.subagent ?? null,
      };
    }),
  };

  const brief = composeBrief({ project, query, transcript });
  onEvent({ type: "complete", transcript, brief });
  return { transcript, brief };
}

// ── Brief composer ─────────────────────────────────────────────────────────

export function composeBrief({ project, query, transcript }) {
  const parts = [];
  parts.push(`# Run: ${project.name || "Untitled project"}`);
  parts.push("");
  if (project.goal) parts.push(`**Goal:** ${project.goal}`);
  if (project.outcome) parts.push(`**Desired outcome:** ${project.outcome}`);
  if (query) parts.push(`**Query:** ${query}`);
  if (transcript.model) parts.push(`**Model:** ${transcript.model}`);
  parts.push("");
  for (const n of transcript.nodes) {
    parts.push(`## ${n.title} _(role: ${n.role})_`);
    if (n.error) {
      parts.push(`> error: ${n.error}`);
    } else {
      const payload = n.parsed != null ? JSON.stringify(n.parsed, null, 2) : n.output || "";
      parts.push("```json");
      parts.push(typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
      parts.push("```");
    }
    parts.push("");
  }
  return parts.join("\n");
}
