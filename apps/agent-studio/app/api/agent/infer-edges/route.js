// POST /api/agent/infer-edges
// Body: { project, model? }
//
// Pass 16 — single inference call to suggest data-flow edges for a sparse
// graph. Returns:
//
//   { ok: true, edges: [{from, to, reason}], cacheHit: boolean }
//
// Behavior:
//   - If `project.runCache.__inferredEdges` already has the cached result
//     for the current graph hash, return it WITHOUT calling Ollama.
//   - Otherwise call Ollama /api/chat with format:json + temperature 0,
//     parse, sanitize, and return.
//   - On Ollama failure, return { ok: false, error } — the canvas page
//     falls back to parallel mode (the original behavior).
//
// Cost: at most one Ollama call per request; the canvas page only invokes
// this endpoint once per "Run" attempt (or when the user explicitly
// re-asks). The cache lives in runCache so storage limits apply uniformly.

import {
  buildInferencePrompt,
  graphHashFor,
  INFERRED_EDGES_CACHE_KEY,
  readCachedInference,
  sanitizeInferredEdges,
  shouldInferEdges,
} from "../../../lib/edge-inference.mjs";

export const runtime = "nodejs";

const DEFAULT_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gpt-oss:20b";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const project = body?.project;
  const model = typeof body?.model === "string" && body.model ? body.model : DEFAULT_MODEL;
  if (!project || !project.canvas || !Array.isArray(project.canvas.nodes)) {
    return Response.json({ ok: false, error: "project with canvas required" }, { status: 400 });
  }
  if (!shouldInferEdges(project)) {
    // Defensive — the client checks too, but keep the server honest.
    return Response.json({
      ok: true,
      edges: [],
      cacheHit: false,
      skipped: true,
      reason: "graph already has edges or declarations",
    });
  }

  // Cache check.
  const cached = readCachedInference(project);
  if (cached) {
    return Response.json({
      ok: true,
      edges: cached,
      cacheHit: true,
      cacheKey: INFERRED_EDGES_CACHE_KEY,
      graphHash: graphHashFor(project),
    });
  }

  const messages = buildInferencePrompt(project);
  let parsed = null;
  try {
    const res = await fetch(`${DEFAULT_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: "json",
        options: { temperature: 0, num_ctx: 4096 },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return Response.json({
        ok: false,
        error: `ollama returned ${res.status}${detail ? `: ${detail}` : ""}`,
      });
    }
    const json = await res.json();
    const content = json?.message?.content ?? "";
    try {
      parsed = JSON.parse(content);
    } catch {
      return Response.json({
        ok: false,
        error: "model did not return parseable JSON",
        raw: content.slice(0, 500),
      });
    }
  } catch (err) {
    return Response.json({
      ok: false,
      error: err?.message || "ollama unreachable",
    });
  }

  const edges = sanitizeInferredEdges(parsed, project);
  return Response.json({
    ok: true,
    edges,
    cacheHit: false,
    cacheKey: INFERRED_EDGES_CACHE_KEY,
    graphHash: graphHashFor(project),
  });
}
