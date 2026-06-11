import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts", "run-local-validation.mjs");

test("run-local-validation resumes from saved state by structure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agent-builder-local-validation-"));
  const state = join(dir, "state.json");
  const sandbox = join(dir, "sandbox");
  try {
    const first = spawnSync("node", [
      SCRIPT,
      "--llm=fixture",
      "--chunk-size=2",
      `--state=${state}`,
      `--root=${sandbox}`,
      "--json",
    ], { cwd: ROOT, encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const firstState = JSON.parse(await readFile(state, "utf8"));
    assert.equal(firstState.summary.completed, 2);
    assert.equal(firstState.summary.pending > 0, true);
    assert.equal(firstState.qualityScorecard.schemaVersion, "agent-builder.local-validation-scorecard.v1");

    const second = spawnSync("node", [
      SCRIPT,
      "--llm=fixture",
      "--chunk-size=2",
      `--state=${state}`,
      `--root=${sandbox}`,
      "--json",
    ], { cwd: ROOT, encoding: "utf8" });
    assert.equal(second.status, 0, second.stderr);
    const secondState = JSON.parse(await readFile(state, "utf8"));
    assert.equal(secondState.summary.completed, 4);
    assert.deepEqual(secondState.runOrder.slice(0, 2), firstState.runOrder);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
