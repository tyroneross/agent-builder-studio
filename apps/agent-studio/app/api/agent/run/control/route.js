// POST /api/agent/run/control
// Body: { runId: string, action: "advance" | "skip-to-end" | "cancel" }
//
// Pass 15 — flip the gate for an in-flight step-mode run. Pairs with
// /api/agent/run when started with `step: true`. The SSE response from /run
// emits the runId as its first event so the client knows what to send here.
//
// 200 on a known runId; 404 when the controller has already been disposed
// (run completed or never existed).

import { getController } from "../../../../lib/run-controllers.mjs";

export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const runId = typeof body?.runId === "string" ? body.runId : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!runId || !action) {
    return Response.json({ ok: false, error: "runId and action required" }, { status: 400 });
  }
  const controller = getController(runId);
  if (!controller) {
    return Response.json({ ok: false, error: "unknown runId" }, { status: 404 });
  }
  if (action === "advance") controller.advance();
  else if (action === "skip-to-end") controller.skipAll();
  else if (action === "cancel") controller.cancel();
  else return Response.json({ ok: false, error: `unknown action "${action}"` }, { status: 400 });

  return Response.json({ ok: true });
}
