// GET /api/agent/models
// Lists locally-pulled Ollama models. Used by the test panel's model picker.
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
