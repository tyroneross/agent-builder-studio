#!/usr/bin/env node
// node --test suite for app/lib/tool-registry.mjs.
//
// Uses a temp dir as repoRoot for every test so nothing touches the real
// `.agent-studio/tool-registry.json`. Reuses tool-spec's own fixtures
// (valid-external, malformed-json) rather than depending on real app
// manifests, per the C5 chunk spec — C3 (real app manifests) runs in
// parallel and shouldn't be a test dependency here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  discoverWorkspaceTools,
  readRegisteredTools,
  writeRegisteredTools,
  registerToolPath,
  unregisterTool,
  listAllTools,
} from "../app/lib/tool-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOOL_SPEC_FIXTURES = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "packages",
  "tool-spec",
  "test",
  "fixtures",
);
const VALID_EXTERNAL_FIXTURE = path.join(TOOL_SPEC_FIXTURES, "valid-external");
const MALFORMED_JSON_FIXTURE = path.join(TOOL_SPEC_FIXTURES, "malformed-json");

async function makeTempRepoRoot() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "tool-registry-test-"));
}

async function writeWorkspaceManifest(repoRoot, appName, manifest) {
  const dir = path.join(repoRoot, "apps", appName);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "agent-tool.json"), JSON.stringify(manifest, null, 2), "utf8");
  return dir;
}

function validManifest(id) {
  return {
    schemaVersion: "agent-builder.tool.v1",
    id,
    name: `Test Tool ${id}`,
    description: "A workspace-discovered test tool.",
    type: "workflow-app",
    entry: {
      kind: "next-app",
      workspace: `apps/${id}`,
      devCommand: `npm run dev --workspace ${id}`,
      port: 39999, // deliberately unreachable in test env
    },
    capabilities: [],
    inputs: [],
    outputs: [],
  };
}

test("discoverWorkspaceTools finds apps/*/agent-tool.json manifests", async () => {
  const repoRoot = await makeTempRepoRoot();
  await writeWorkspaceManifest(repoRoot, "demo-app", validManifest("demo-app"));

  const tools = await discoverWorkspaceTools(repoRoot);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].id, "demo-app");
  assert.equal(tools[0].source, "workspace");
  assert.equal(tools[0].valid, true);
  assert.deepEqual(tools[0].errors, []);
});

test("discoverWorkspaceTools returns [] when apps/ has no manifests", async () => {
  const repoRoot = await makeTempRepoRoot();
  await fsp.mkdir(path.join(repoRoot, "apps", "no-manifest-here"), { recursive: true });

  const tools = await discoverWorkspaceTools(repoRoot);
  assert.deepEqual(tools, []);
});

test("discoverWorkspaceTools surfaces an invalid workspace manifest with valid:false", async () => {
  const repoRoot = await makeTempRepoRoot();
  const broken = validManifest("broken-app");
  delete broken.entry.devCommand; // required field
  await writeWorkspaceManifest(repoRoot, "broken-app", broken);

  const tools = await discoverWorkspaceTools(repoRoot);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].valid, false);
  assert.ok(tools[0].errors.includes("entry.devCommand is required."));
});

test("registerToolPath validates + persists a valid external fixture, and it survives a fresh readRegisteredTools (restart-persistence)", async () => {
  const repoRoot = await makeTempRepoRoot();

  const result = await registerToolPath(repoRoot, VALID_EXTERNAL_FIXTURE);
  assert.equal(result.ok, true);
  assert.equal(result.tool.id, "external-cli-tool");
  assert.equal(result.tool.source, "external");

  // Simulate a restart: nothing in-memory carries over, only the file does.
  const reread = await readRegisteredTools(repoRoot);
  assert.equal(reread.length, 1);
  assert.equal(reread[0].id, "external-cli-tool");
  assert.equal(reread[0].path, VALID_EXTERNAL_FIXTURE);

  // The persisted file itself exists at the expected, non-colliding path.
  const registryFile = path.join(repoRoot, ".agent-studio", "tool-registry.json");
  const raw = await fsp.readFile(registryFile, "utf8");
  const parsed = JSON.parse(raw);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, "external-cli-tool");
});

test("registerToolPath dedupes by id on re-registration", async () => {
  const repoRoot = await makeTempRepoRoot();

  await registerToolPath(repoRoot, VALID_EXTERNAL_FIXTURE);
  const second = await registerToolPath(repoRoot, VALID_EXTERNAL_FIXTURE);
  assert.equal(second.ok, true);

  const list = await readRegisteredTools(repoRoot);
  assert.equal(list.length, 1);
});

test("registerToolPath rejects an invalid manifest with tool-spec's error strings, without persisting", async () => {
  const repoRoot = await makeTempRepoRoot();

  const result = await registerToolPath(repoRoot, MALFORMED_JSON_FIXTURE);
  assert.equal(result.ok, false);
  assert.ok(Array.isArray(result.errors));
  assert.ok(result.errors.length > 0);
  assert.match(result.errors[0], /Could not parse/);

  const list = await readRegisteredTools(repoRoot);
  assert.deepEqual(list, []);
});

test("readRegisteredTools returns [] when the registry file is absent", async () => {
  const repoRoot = await makeTempRepoRoot();
  const list = await readRegisteredTools(repoRoot);
  assert.deepEqual(list, []);
});

test("unregisterTool removes a registered tool and persists the removal", async () => {
  const repoRoot = await makeTempRepoRoot();
  await registerToolPath(repoRoot, VALID_EXTERNAL_FIXTURE);

  const before = await readRegisteredTools(repoRoot);
  assert.equal(before.length, 1);

  await unregisterTool(repoRoot, "external-cli-tool");

  const after = await readRegisteredTools(repoRoot);
  assert.deepEqual(after, []);
});

test("writeRegisteredTools creates .agent-studio/ if missing", async () => {
  const repoRoot = await makeTempRepoRoot();
  await writeRegisteredTools(repoRoot, [{ id: "x" }]);

  const stat = await fsp.stat(path.join(repoRoot, ".agent-studio"));
  assert.ok(stat.isDirectory());
});

test("listAllTools merges workspace + registered tools and annotates status", async () => {
  const repoRoot = await makeTempRepoRoot();
  await writeWorkspaceManifest(repoRoot, "demo-app", validManifest("demo-app"));
  await registerToolPath(repoRoot, VALID_EXTERNAL_FIXTURE);

  const tools = await listAllTools(repoRoot);
  assert.equal(tools.length, 2);
  const ids = tools.map((t) => t.id).sort();
  assert.deepEqual(ids, ["demo-app", "external-cli-tool"]);
  for (const tool of tools) {
    assert.ok(["running", "stopped"].includes(tool.status));
  }
});
