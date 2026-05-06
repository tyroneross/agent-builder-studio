import { enqueueApproval, listApprovals, resolveApproval } from "../../core/approvals/approval-queue.mjs";
import { ensureWorkspace } from "../../core/workspace/workspace.mjs";
import { readBody, sendJson } from "../http.mjs";

export async function listApprovalsRoute(_req, res) {
  await ensureWorkspace();
  sendJson(res, 200, { approvals: await listApprovals() });
}

export async function enqueueApprovalRoute(req, res) {
  await ensureWorkspace();
  const body = await readBody(req);
  sendJson(res, 200, { approval: await enqueueApproval(body) });
}

export async function resolveApprovalRoute(req, res) {
  await ensureWorkspace();
  const body = await readBody(req);
  sendJson(res, 200, { approval: await resolveApproval(body) });
}
