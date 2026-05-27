import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import test from "node:test";

import { exportAgentPackage } from "../lib/agent-package-exporter.mjs";
import { writeAgentArtifacts } from "../lib/build-files.js";

const execFileAsync = promisify(execFile);

async function makeTestRoot(prefix) {
  const base = process.env.AGENT_BUILDER_TMPDIR || join(process.cwd(), ".tmp");
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, prefix));
}

test("exportAgentPackage copies a self-contained package and runs setup check", async () => {
  const root = await makeTestRoot("agent-exporter-");
  try {
    await writeAgentArtifacts(
      {
        patternId: "solo-tool-agent",
        projectName: "Portable Agent",
        modelProvider: "none",
      },
      { root },
    );

    const report = await exportAgentPackage({
      root,
      slug: "portable-agent",
      targetDir: "portable-install/portable-agent",
    });

    assert.equal(report.schemaVersion, "agent-builder.package-export.v1");
    assert.equal(report.package.slug, "portable-agent");
    assert.equal(report.package.targetDir, "portable-install/portable-agent");
    assert.equal(report.setupCheck.passed, true);
    assert.ok(report.package.copiedFiles >= 30);
    assert.equal(existsSync(join(root, "portable-install/portable-agent/manifest.json")), true);
    assert.equal(existsSync(join(root, "portable-install/portable-agent/runtime/custom-loop-adapter.mjs")), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("export script emits JSON report", async () => {
  const root = await makeTestRoot("agent-exporter-cli-");
  try {
    await writeAgentArtifacts(
      {
        patternId: "solo-tool-agent",
        projectName: "CLI Portable Agent",
        modelProvider: "none",
      },
      { root },
    );

    const { stdout } = await execFileAsync(process.execPath, [
      join(process.cwd(), "scripts/export-agent-package.mjs"),
      "--slug=cli-portable-agent",
      "--target=cli-install/cli-portable-agent",
      "--json",
    ], { cwd: root, encoding: "utf8" });
    const report = JSON.parse(stdout);
    assert.equal(report.package.slug, "cli-portable-agent");
    assert.equal(report.setupCheck.passed, true);

    const runtimeOutput = await execFileAsync(process.execPath, [
      join(root, "cli-install/cli-portable-agent/runtime/custom-loop-adapter.mjs"),
      "--fixture",
    ], { cwd: join(root, "cli-install/cli-portable-agent"), encoding: "utf8" });
    const runtimeReport = JSON.parse(runtimeOutput.stdout);
    assert.equal(runtimeReport.status, "ready");
    assert.ok(runtimeReport.graph.nodes.includes("intake"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
