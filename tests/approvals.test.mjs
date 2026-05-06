import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enqueueApproval, listApprovals, resolveApproval } from "../src/core/approvals/approval-queue.mjs";
import { ensureWorkspace } from "../src/core/workspace/workspace.mjs";

test("approval queue records and resolves ask-first actions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cos-approvals-"));
  process.env.COS_WORKSPACE_DIR = dir;
  await ensureWorkspace();
  const item = await enqueueApproval({ kind: "calendar", title: "Move focus block", summary: "Requires user review" });
  assert.equal((await listApprovals()).length, 1);
  const resolved = await resolveApproval({ id: item.id, decision: "rejected" });
  assert.equal(resolved.status, "rejected");
  await rm(dir, { recursive: true, force: true });
});
