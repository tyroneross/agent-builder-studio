// POST /api/tools/launch
// Body: { id: string }
// Response (always JSON):
//   { ok: true, pid: number, alreadyRunning?: true }
//   { ok: false, error: string }
//
// Spawns the tool's declared devCommand and stores runtime pid state in
// .agent-studio/tool-registry.json.

import { findRepoRoot, launchTool } from "../../../lib/tool-registry.mjs";

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
    const result = await launchTool(repoRoot, id);
    if (!result.ok) {
      return Response.json({ ok: false, error: result.error || "launch failed" }, { status: 400 });
    }
    return Response.json(result);
  } catch (err) {
    return Response.json({ ok: false, error: err?.message || "launch failed" }, { status: 500 });
  }
}
