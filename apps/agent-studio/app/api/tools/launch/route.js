// POST /api/tools/launch
// Body: { id: string, confirm?: boolean }
// Response (always JSON):
//   { ok: true, pid: number, alreadyRunning?: true }
//   { ok: false, needsConfirmation: true, error: "confirmation required" } (409)
//   { ok: false, error: string }
//
// Spawns the tool's declared devCommand and stores runtime pid state in
// .agent-studio/tool-registry.json.

import { assertLocalRequest } from "../../../lib/local-request.mjs";
import { findRepoRoot, launchTool } from "../../../lib/tool-registry.mjs";

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

  const confirm = body?.confirm === true;
  const repoRoot = findRepoRoot(process.cwd());
  try {
    const result = await launchTool(repoRoot, id, { confirm });
    if (!result.ok) {
      if (result.needsConfirmation) {
        return Response.json(
          { ok: false, needsConfirmation: true, error: "confirmation required" },
          { status: 409 },
        );
      }
      return Response.json({ ok: false, error: result.error || "launch failed" }, { status: 400 });
    }
    return Response.json(result);
  } catch (err) {
    return Response.json({ ok: false, error: err?.message || "launch failed" }, { status: 500 });
  }
}
