import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertLocalServiceUrl, workspacePath } from "../src/core/policy/path-policy.mjs";

test("workspacePath blocks traversal outside the CoS workspace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cos-path-"));
  process.env.COS_WORKSPACE_DIR = dir;
  assert.equal(workspacePath("documents", "plan.md"), join(dir, "documents", "plan.md"));
  assert.throws(() => workspacePath("..", "outside.md"), /escapes CoS workspace/);
  await rm(dir, { recursive: true, force: true });
});

test("network policy allows localhost and blocks external hosts", () => {
  assert.equal(assertLocalServiceUrl("http://localhost:11434/api/tags").hostname, "localhost");
  assert.throws(() => assertLocalServiceUrl("https://example.com"), /blocked non-local/);
});
