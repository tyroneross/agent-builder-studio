// POST /api/tools/stop
// Body: { id: string }
// Response (always JSON):
//   { ok: true, notRunning?: true }
//   { ok: false, error: string }
//
// Stops a tracked launched tool and clears its runtime pid state in
// .agent-studio/tool-registry.json.

import { assertLocalRequest } from "../../../lib/local-request.mjs";
import { findRepoRoot, stopTool } from "../../../lib/tool-registry.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  const localRequestError = assertLocalRequest(request);
  if (localRequestError) return localRequestError;

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
    return Response.json(await stopTool(repoRoot, id));
  } catch (err) {
    return Response.json({ ok: false, error: err?.message || "stop failed" }, { status: 500 });
  }
}
