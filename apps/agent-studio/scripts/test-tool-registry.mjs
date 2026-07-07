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

import { POST as registerRoutePost } from "../app/api/tools/register/route.js";
import {
  discoverWorkspaceTools,
  readRegisteredTools,
  writeRegisteredTools,
  registerToolPath,
  unregisterTool,
  launchTool,
  stopTool,
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

function registryFilePath(repoRoot) {
  return path.join(repoRoot, ".agent-studio", "tool-registry.json");
}

async function readRegistryFile(repoRoot) {
  return JSON.parse(await fsp.readFile(registryFilePath(repoRoot), "utf8"));
}

async function writeWorkspaceManifest(repoRoot, appName, manifest) {
  const dir = path.join(repoRoot, "apps", appName);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "agent-tool.json"), JSON.stringify(manifest, null, 2), "utf8");
  return dir;
}

async function writeExternalManifest(repoRoot, dirName, manifest) {
  const dir = path.join(repoRoot, "external", dirName);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "agent-tool.json"), JSON.stringify(manifest, null, 2), "utf8");
  return dir;
}

async function writeLongRunningScript(dir) {
  const scriptPath = path.join(dir, "run-forever.mjs");
  await fsp.writeFile(scriptPath, "setTimeout(() => {}, 60000);\n", "utf8");
  return scriptPath;
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

function isPidLive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidLive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(isPidLive(pid), false, `pid ${pid} should have exited`);
}

function toolRouteRequest(body, headers = {}) {
  return new Request("http://localhost:3000/api/tools/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "localhost:3000",
      origin: "http://localhost:3000",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function readRouteResponse(response) {
  return {
    status: response.status,
    body: await response.json(),
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
  const parsed = await readRegistryFile(repoRoot);
  assert.equal(parsed.registered.length, 1);
  assert.equal(parsed.registered[0].id, "external-cli-tool");
  assert.deepEqual(parsed.runtime, {});
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

test("readRegisteredTools reads legacy bare-array registry files", async () => {
  const repoRoot = await makeTempRepoRoot();
  await fsp.mkdir(path.join(repoRoot, ".agent-studio"), { recursive: true });
  await fsp.writeFile(
    registryFilePath(repoRoot),
    `${JSON.stringify([{ id: "legacy-tool" }], null, 2)}\n`,
    "utf8",
  );

  const list = await readRegisteredTools(repoRoot);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "legacy-tool");
});

test("register route rejects paths outside the permitted local roots", async () => {
  const result = await readRouteResponse(
    await registerRoutePost(toolRouteRequest({ path: "/etc" })),
  );

  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, "path outside permitted root");
});

test("register route rejects cross-origin mutating requests", async () => {
  const result = await readRouteResponse(
    await registerRoutePost(
      toolRouteRequest(
        { path: "/tmp" },
        {
          origin: "http://evil.example",
        },
      ),
    ),
  );

  assert.equal(result.status, 403);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, "same-origin request required");
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
  const parsed = await readRegistryFile(repoRoot);
  assert.deepEqual(parsed.registered, [{ id: "x" }]);
  assert.deepEqual(parsed.runtime, {});
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

test("launchTool tracks a live pid, is idempotent, updates status, and stopTool clears runtime", async (t) => {
  const repoRoot = await makeTempRepoRoot();
  const manifest = validManifest("launcher-app");
  manifest.entry.port = 39998;
  const appDir = await writeWorkspaceManifest(repoRoot, "launcher-app", manifest);
  const scriptPath = await writeLongRunningScript(appDir);
  manifest.entry.devCommand = `${process.execPath} ${scriptPath}`;
  await fsp.writeFile(path.join(appDir, "agent-tool.json"), JSON.stringify(manifest, null, 2), "utf8");

  let launchedPid = null;
  t.after(async () => {
    if (launchedPid && isPidLive(launchedPid)) {
      try {
        process.kill(launchedPid);
      } catch {
        // Best-effort cleanup only; the assertions below cover the normal stop path.
      }
      await waitForPidExit(launchedPid).catch(() => {});
    }
  });

  const launch = await launchTool(repoRoot, "launcher-app");
  assert.equal(launch.ok, true);
  assert.equal(Number.isInteger(launch.pid), true);
  launchedPid = launch.pid;
  assert.equal(isPidLive(launch.pid), true);

  let registry = await readRegistryFile(repoRoot);
  assert.equal(registry.runtime["launcher-app"].pid, launch.pid);
  assert.equal(registry.runtime["launcher-app"].port, 39998);
  assert.match(registry.runtime["launcher-app"].startedAt, /^\d{4}-\d{2}-\d{2}T/);

  let tools = await listAllTools(repoRoot);
  assert.equal(tools.find((tool) => tool.id === "launcher-app")?.status, "running");

  const secondLaunch = await launchTool(repoRoot, "launcher-app");
  assert.equal(secondLaunch.ok, true);
  assert.equal(secondLaunch.alreadyRunning, true);
  assert.equal(secondLaunch.pid, launch.pid);

  const stop = await stopTool(repoRoot, "launcher-app");
  assert.equal(stop.ok, true);
  await waitForPidExit(launch.pid);

  registry = await readRegistryFile(repoRoot);
  assert.equal(registry.runtime["launcher-app"], undefined);

  tools = await listAllTools(repoRoot);
  assert.equal(tools.find((tool) => tool.id === "launcher-app")?.status, "stopped");
});

test("launchTool rejects devCommand shell metacharacters", async () => {
  const repoRoot = await makeTempRepoRoot();
  const manifest = validManifest("shell-bad");
  manifest.entry.devCommand = `${process.execPath} ./safe.mjs; echo bad`;
  await writeWorkspaceManifest(repoRoot, "shell-bad", manifest);

  const result = await launchTool(repoRoot, "shell-bad");
  assert.equal(result.ok, false);
  assert.equal(result.error, "tool devCommand contains unsupported shell metacharacters");
});

test("unregisterTool stops a running registered tool and clears runtime", async (t) => {
  const repoRoot = await makeTempRepoRoot();
  const manifest = validManifest("external-launcher");
  const externalDir = await writeExternalManifest(repoRoot, "external-launcher", manifest);
  const scriptPath = await writeLongRunningScript(externalDir);
  manifest.entry.devCommand = `${process.execPath} ${scriptPath}`;
  await fsp.writeFile(
    path.join(externalDir, "agent-tool.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );

  let launchedPid = null;
  t.after(async () => {
    if (launchedPid && isPidLive(launchedPid)) {
      try {
        process.kill(launchedPid);
      } catch {
        // Best-effort cleanup only.
      }
      await waitForPidExit(launchedPid).catch(() => {});
    }
  });

  const registered = await registerToolPath(repoRoot, externalDir);
  assert.equal(registered.ok, true);

  const launch = await launchTool(repoRoot, "external-launcher");
  assert.equal(launch.ok, true);
  launchedPid = launch.pid;
  assert.equal(isPidLive(launch.pid), true);

  const unregistered = await unregisterTool(repoRoot, "external-launcher");
  assert.equal(unregistered.ok, true);
  await waitForPidExit(launch.pid);

  const registry = await readRegistryFile(repoRoot);
  assert.deepEqual(registry.registered, []);
  assert.equal(registry.runtime["external-launcher"], undefined);
});

test("stale runtime pids without launch metadata are not treated as running or killed", async () => {
  const repoRoot = await makeTempRepoRoot();
  await writeWorkspaceManifest(repoRoot, "stale-pid", validManifest("stale-pid"));
  await fsp.mkdir(path.join(repoRoot, ".agent-studio"), { recursive: true });
  await fsp.writeFile(
    registryFilePath(repoRoot),
    `${JSON.stringify(
      {
        registered: [],
        runtime: {
          "stale-pid": {
            pid: process.pid,
            startedAt: new Date().toISOString(),
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const tools = await listAllTools(repoRoot);
  assert.equal(tools.find((tool) => tool.id === "stale-pid")?.status, "stopped");

  const stopped = await stopTool(repoRoot, "stale-pid");
  assert.equal(stopped.ok, true);
  assert.equal(stopped.notRunning, true);

  const registry = await readRegistryFile(repoRoot);
  assert.equal(registry.runtime["stale-pid"], undefined);
  assert.equal(isPidLive(process.pid), true);
});
