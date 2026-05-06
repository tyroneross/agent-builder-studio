import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocument } from "../src/core/workspace/documents.mjs";
import { ensureWorkspace, workspaceStatus } from "../src/core/workspace/workspace.mjs";

test("workspace initializes expected local vault files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cos-workspace-"));
  process.env.COS_WORKSPACE_DIR = dir;
  await ensureWorkspace();
  const status = await workspaceStatus();
  assert.equal(status.ready, true);
  assert.equal(status.files["approvals/queue.json"], true);
  assert.equal(status.files["memory/learning-ledger.json"], true);
  await rm(dir, { recursive: true, force: true });
});

test("document creation is inside workspace and refuses overwrite", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cos-docs-"));
  process.env.COS_WORKSPACE_DIR = dir;
  await ensureWorkspace();
  const first = await createDocument({ name: "Daily Plan", content: "hello" });
  assert.equal(await readFile(first.path, "utf8"), "hello");
  await assert.rejects(() => createDocument({ name: "Daily Plan", content: "overwrite" }), /refusing to overwrite/);
  await assert.rejects(() => createDocument({ name: "../escape", content: "bad", folder: "../outside" }), /escapes CoS workspace/);
  await rm(dir, { recursive: true, force: true });
});
