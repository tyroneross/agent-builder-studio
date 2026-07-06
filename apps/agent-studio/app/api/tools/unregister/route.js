// POST /api/tools/unregister
// Body: { id: string }
// Response (always JSON):
//   { ok: true }
//   { ok: false, error: string }
//
// Removes an externally-registered tool from .agent-studio/tool-registry.json.
// Workspace-discovered tools cannot be unregistered (they aren't persisted).

import { findRepoRoot, unregisterTool } from "../../../lib/tool-registry.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const id = body?.id;
  if (typeof id !== "string" || id.length === 0) {
    return Response.json({ ok: false, error: "id required" }, { status: 400 });
  }

  const repoRoot = findRepoRoot(process.cwd());
  try {
    await unregisterTool(repoRoot, id);
  } catch (err) {
    return Response.json(
      { ok: false, error: err?.message || "unregister failed" },
      { status: 500 },
    );
  }

  return Response.json({ ok: true });
}
