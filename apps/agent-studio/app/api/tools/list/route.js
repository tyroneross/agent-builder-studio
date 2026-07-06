// GET /api/tools/list
// Response (always JSON):
//   { ok: true, tools: [{ id, name, manifest, source, valid, errors, path, status }] }
//   { ok: false, error: string }
//
// `tools` merges first-party workspace discovery (apps/*/agent-tool.json)
// with persisted external registrations (.agent-studio/tool-registry.json),
// each annotated with a live port-probe `status`.

import { findRepoRoot, listAllTools } from "../../../lib/tool-registry.mjs";

export const runtime = "nodejs";

export async function GET() {
  try {
    const repoRoot = findRepoRoot(process.cwd());
    const tools = await listAllTools(repoRoot);
    return Response.json({ ok: true, tools });
  } catch (err) {
    return Response.json(
      { ok: false, error: err?.message || "failed to list tools" },
      { status: 500 },
    );
  }
}
