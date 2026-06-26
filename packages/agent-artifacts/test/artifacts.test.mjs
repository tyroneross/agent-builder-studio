import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  stageArtifact, listArtifacts, promoteArtifact, getRegistry, ARTIFACT_TYPES,
} from "../index.mjs";

async function tmp() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "agent-artifacts-"));
}

test("stage writes files to .artifacts and records a registry entry", async () => {
  const root = await tmp();
  const entry = await stageArtifact(root, {
    type: "package", name: "My Agent",
    files: [{ path: "agent.yaml", content: "name: x" }, { path: "setup/env.example", content: "K=" }],
    now: "2026-01-01T00:00:00Z",
  });
  assert.equal(entry.id, "package:my-agent");
  assert.equal(entry.status, "staged");
  assert.equal(entry.fileCount, 2);
  const onDisk = await fs.readFile(path.join(root, ".artifacts/package/my-agent/agent.yaml"), "utf8");
  assert.equal(onDisk, "name: x");
  const list = await listArtifacts(root);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "package:my-agent");
});

test("re-staging the same name updates in place (no duplicate)", async () => {
  const root = await tmp();
  await stageArtifact(root, { type: "skill", name: "S", files: [{ path: "SKILL.md", content: "a" }] });
  await stageArtifact(root, { type: "skill", name: "S", files: [{ path: "SKILL.md", content: "b" }] });
  const list = await listArtifacts(root);
  assert.equal(list.length, 1);
  assert.equal(await fs.readFile(path.join(root, ".artifacts/skill/s/SKILL.md"), "utf8"), "b");
});

test("promote copies to a standalone folder outside the app + flips status", async () => {
  const root = await tmp();
  await stageArtifact(root, { type: "plugin", name: "P", files: [{ path: "plugin.json", content: "{}" }] });
  const promoted = await promoteArtifact(root, "plugin:p", { now: "2026-01-02T00:00:00Z" });
  assert.equal(promoted.status, "promoted");
  assert.equal(promoted.promotedTo, path.join(root, "promoted", "p"));
  // Lives outside .artifacts now:
  assert.ok((await fs.stat(path.join(root, "promoted/p/plugin.json"))).isFile());
  // Registry reflects it:
  const reg = await getRegistry(root);
  assert.equal(reg.artifacts.find((a) => a.id === "plugin:p").status, "promoted");
});

test("promote to an explicit external path", async () => {
  const root = await tmp();
  const dest = path.join(await tmp(), "standalone-agent");
  await stageArtifact(root, { type: "agent", name: "A", files: [{ path: "README.md", content: "hi" }] });
  const r = await promoteArtifact(root, "agent:a", { to: dest });
  assert.equal(r.promotedTo, dest);
  assert.equal(await fs.readFile(path.join(dest, "README.md"), "utf8"), "hi");
});

test("unknown type and missing artifact are rejected", async () => {
  const root = await tmp();
  await assert.rejects(() => stageArtifact(root, { type: "nope", name: "x", files: [{ path: "a", content: "b" }] }));
  await assert.rejects(() => promoteArtifact(root, "package:missing", {}));
  assert.deepEqual(ARTIFACT_TYPES, ["package", "skill", "plugin", "agent"]);
});
