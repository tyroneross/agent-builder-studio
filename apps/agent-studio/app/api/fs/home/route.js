// GET /api/fs/home
// Returns: { ok: true, home: string }
//
// The client doesn't have access to process.env.HOME or os.homedir(); we
// expose just the home directory path here so the new-project form can build
// a sensible default working folder ("${HOME}/agent-studio/<slug>/").
// No request body, no side effects.

import os from "node:os";

export const runtime = "nodejs";

export async function GET() {
  let home = "";
  try {
    home = os.homedir();
  } catch {
    home = process.env.HOME || "";
  }
  return Response.json({ ok: true, home });
}
