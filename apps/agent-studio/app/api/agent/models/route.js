// GET /api/agent/models
// Lists locally-pulled Ollama CHAT models. Used by the test panel's model
// picker. Embedding models (family "bert"/"nomic-bert", or *embed* names)
// are filtered out — they 400 on /api/chat, and an alphabetical default of
// bge-m3 broke the first-run demo (UI audit 2026-06-09).
//
// Response (always JSON):
//   - { ok: true, models: string[], baseUrl }
//   - { ok: false, error: string }   // Ollama unreachable / non-200 response
//
// No new packages: uses native fetch. Defensive — never throws past the route
// boundary; surfaces errors as `{ ok: false }` with a status that lets the
// client render a "no models / Ollama not running" state.

export const runtime = "nodejs";

const DEFAULT_BASE_URL = "http://localhost:11434";

export async function GET() {
  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return Response.json(
        { ok: false, error: `ollama returned ${res.status}`, baseUrl },
        { status: 200 },
      );
    }
    const body = await res.json();
    const models = (body?.models ?? [])
      .filter(isChatModel)
      .map((m) => m?.name)
      .filter((name) => typeof name === "string");
    return Response.json({ ok: true, models, baseUrl });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err?.message || "ollama unreachable",
        baseUrl,
      },
      { status: 200 },
    );
  }
}

// Embedding-model filter. Grounded against live /api/tags metadata: every
// installed embedding model reports a family containing "bert"
// (bge-m3 -> bert, mxbai-embed-large -> bert, nomic-embed-text -> nomic-bert);
// the name pattern is a defensive second net for models without details.
export function isChatModel(m) {
  const name = typeof m?.name === "string" ? m.name : "";
  if (/embed|bge-/i.test(name)) return false;
  const families = [
    m?.details?.family,
    ...(Array.isArray(m?.details?.families) ? m.details.families : []),
  ].filter((f) => typeof f === "string");
  if (families.some((f) => f.includes("bert"))) return false;
  return true;
}
