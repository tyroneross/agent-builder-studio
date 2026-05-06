import { healthRoute } from "./routes/health.mjs";
import { modelsRoute } from "./routes/models.mjs";
import { initVaultRoute, vaultStatusRoute } from "./routes/vault.mjs";
import { enqueueApprovalRoute, listApprovalsRoute, resolveApprovalRoute } from "./routes/approvals.mjs";
import { createDocumentRoute } from "./routes/documents.mjs";
import { exportCalendarRoute, importCalendarRoute } from "./routes/calendar.mjs";
import { dailyPlanRoute } from "./routes/plan.mjs";
import { ritualsRoute, toolsRoute } from "./routes/metadata.mjs";
import { sendJson } from "./http.mjs";

const ROUTES = new Map([
  ["GET /api/health", healthRoute],
  ["GET /api/models", modelsRoute],
  ["POST /api/vault/init", initVaultRoute],
  ["GET /api/vault/status", vaultStatusRoute],
  ["GET /api/approvals", listApprovalsRoute],
  ["POST /api/approvals", enqueueApprovalRoute],
  ["POST /api/approvals/resolve", resolveApprovalRoute],
  ["POST /api/documents", createDocumentRoute],
  ["POST /api/calendar/import", importCalendarRoute],
  ["POST /api/calendar/export", exportCalendarRoute],
  ["POST /api/plan/daily", dailyPlanRoute],
  ["GET /api/rituals", ritualsRoute],
  ["GET /api/tools", toolsRoute],
]);

export async function handleApi(req, res, url) {
  const handler = ROUTES.get(`${req.method} ${url.pathname}`);
  if (!handler) {
    sendJson(res, 404, { ok: false, error: "route not found" });
    return;
  }
  await handler(req, res, url);
}
