import { randomUUID } from "node:crypto";
import { appendAudit } from "../workspace/audit-log.mjs";
import { readJson, writeJson } from "../workspace/json-store.mjs";
import { PERMISSIONS, describePermission } from "../policy/permission-policy.mjs";

const QUEUE_PATH = "approvals/queue.json";

export async function listApprovals() {
  return readJson(QUEUE_PATH, []);
}

export async function enqueueApproval({
  kind,
  title,
  summary,
  payload,
  requiredPermission = PERMISSIONS.ASK_FIRST,
}) {
  const queue = await listApprovals();
  const item = {
    id: `approval-${Date.now()}-${randomUUID().slice(0, 8)}`,
    status: "pending",
    kind: kind || "action",
    title: title || "Untitled approval",
    summary: summary || "",
    payload: payload ?? {},
    requiredPermission,
    permissionPolicy: describePermission(requiredPermission),
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    decision: null,
  };
  queue.push(item);
  await writeJson(QUEUE_PATH, queue);
  await appendAudit({ type: "approval-enqueued", id: item.id, kind: item.kind });
  return item;
}

export async function resolveApproval({ id, decision }) {
  if (!["approved", "rejected"].includes(decision)) {
    throw new Error("decision must be approved or rejected");
  }
  const queue = await listApprovals();
  const item = queue.find((entry) => entry.id === id);
  if (!item) throw new Error(`approval not found: ${id}`);
  item.status = decision;
  item.decision = decision;
  item.resolvedAt = new Date().toISOString();
  await writeJson(QUEUE_PATH, queue);
  await appendAudit({ type: "approval-resolved", id, decision });
  return item;
}
