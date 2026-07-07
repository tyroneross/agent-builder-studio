// POST /api/tools/register-git
// Body: { url: string }  (https git URL containing agent-tool.json)
// Response (always JSON):
//   - Valid manifest:   { ok: true, tool }                         (200)
//   - Invalid URL:      { ok: false, error: string }               (400)
//   - Invalid manifest: { ok: false, errors: string[] }            (400)
//
// Clone is read-only intake. It only reads agent-tool.json + files through
// registerToolFromGit; launch-time policy stays centralized in tool-registry.

import { assertLocalRequest } from "../../../lib/local-request.mjs";
import { findRepoRoot, registerToolFromGit } from "../../../lib/tool-registry.mjs";

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

  const raw = body?.url;
  if (typeof raw !== "string" || raw.length === 0) {
    return Response.json({ ok: false, error: "url required" }, { status: 400 });
  }

  const repoRoot = findRepoRoot(process.cwd());
  let result;
  try {
    result = await registerToolFromGit(repoRoot, raw);
  } catch (err) {
    return Response.json(
      { ok: false, error: err?.message || "register git failed" },
      { status: 500 },
    );
  }

  if (!result.ok) {
    const body = { ok: false };
    if (result.error) body.error = result.error;
    if (result.errors) body.errors = result.errors;
    return Response.json(body, { status: 400 });
  }

  return Response.json({ ok: true, tool: result.tool });
}
