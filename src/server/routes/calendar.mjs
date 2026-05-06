import { buildIcs, parseIcsEvents } from "../../integrations/calendar/ics.mjs";
import { ensureWorkspace, saveSystemArtifact } from "../../core/workspace/workspace.mjs";
import { readBody, sendJson } from "../http.mjs";

export async function importCalendarRoute(req, res) {
  await ensureWorkspace();
  const body = await readBody(req);
  const ics = body.ics || body.raw || "";
  const events = parseIcsEvents(ics);
  const saved = await saveSystemArtifact(`calendar/imports/import-${Date.now()}.ics`, ics);
  sendJson(res, 200, { events, saved });
}

export async function exportCalendarRoute(req, res) {
  await ensureWorkspace();
  const body = await readBody(req);
  const ics = buildIcs({ title: body.title, blocks: body.blocks || [], date: body.date });
  const saved = await saveSystemArtifact(`calendar/exports/export-${Date.now()}.ics`, ics);
  sendJson(res, 200, { ics, saved });
}
