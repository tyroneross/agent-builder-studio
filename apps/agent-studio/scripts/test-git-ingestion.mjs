#!/usr/bin/env node
// node --test suite for git URL tool ingestion.
//
// The tests never hit the network. registerToolFromGit is exercised with an
// injected clone function that writes a manifest into the temp cache directory.

import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";

import { POST as registerGitRoutePost } from "../app/api/tools/register-git/route.js";
import {
  launchTool,
  readRegisteredTools,
  registerToolFromGit,
  validateGitToolUrl,
} from "../app/lib/tool-registry.mjs";

async function makeTempRepoRoot() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "git-ingestion-test-"));
}

function validManifest(id, targetDir, overrides = {}) {
  return {
    schemaVersion: "agent-builder.tool.v1",
    id,
    name: `Git Tool ${id}`,
    description: "A git-ingested test tool.",
    type: "cli",
    entry: {
      kind: "cli",
      path: targetDir,
      devCommand: `node ${path.join(targetDir, "run.mjs")}`,
    },
    capabilities: [],
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

function cloneWithManifest(manifestFactory) {
  const calls = [];
  const clone = async ({ gitUrl, targetDir, argv }) => {
    calls.push({ gitUrl, targetDir, argv });
    await fsp.mkdir(targetDir, { recursive: true });
    await fsp.writeFile(path.join(targetDir, "run.mjs"), "console.log('ok');\n", "utf8");
    const manifest = manifestFactory({ gitUrl, targetDir, argv });
    await fsp.writeFile(
      path.join(targetDir, "agent-tool.json"),
      JSON.stringify(manifest, null, 2),
      "utf8",
    );
  };
  return { clone, calls };
}

function routeRequest(body, headers = {}) {
  return new Request("http://localhost:3000/api/tools/register-git", {
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

test("validateGitToolUrl rejects dangerous and non-https forms", () => {
  const rejected = [
    "file:///etc",
    "ssh://git@github.com/acme/tool.git",
    "git://github.com/acme/tool.git",
    "http://github.com/acme/tool.git",
    "/Users/me/tool",
    "../tool",
    "git@github.com:acme/tool.git",
    "--upload-pack=/bin/sh",
    "https://github.com/acme/tool.git --upload-pack=/bin/sh",
    "https://github.com/acme/tool.git?--upload-pack=/bin/sh",
    "https://github.com/acme/tool.git;rm",
    "https://github.com/acme/tool.git$(id)",
    "https://github.com/acme/tool.git`id`",
    "https://github.com/acme/tool.git%3Brm",
    "https://localhost/acme/tool.git",
    "https://127.5.6.7/acme/tool.git",
    "https://169.254.1.2/acme/tool.git",
    "https://172.16.0.5/acme/tool.git",
    "https://172.31.255.255/acme/tool.git",
    "https://192.168.1.10/acme/tool.git",
    "https://0x7f000001/acme/tool.git",
  ];

  for (const url of rejected) {
    assert.equal(validateGitToolUrl(url).ok, false, `${url} should be rejected`);
  }
});

test("validateGitToolUrl accepts a plain https git URL shape", () => {
  const result = validateGitToolUrl("https://github.com/acme/tool.git");
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://github.com/acme/tool.git");
});

test("registerToolFromGit uses a no-shell git argv shape and persists git origin metadata", async () => {
  const repoRoot = await makeTempRepoRoot();
  const gitUrl = "https://github.com/acme/tool.git";
  const { clone, calls } = cloneWithManifest(({ targetDir }) => validManifest("git-tool", targetDir));

  const result = await registerToolFromGit(repoRoot, gitUrl, { clone });
  assert.equal(result.ok, true);
  assert.equal(result.tool.id, "git-tool");
  assert.equal(result.tool.source, "git");
  assert.deepEqual(result.tool.origin, { type: "git", url: gitUrl });
  assert.match(result.tool.path, /\.agent-studio\/git-cache\/github-com-acme-tool-/);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].argv.slice(0, 4), ["clone", "--depth", "1", "--filter=blob:limit=10m"]);
  assert.equal(calls[0].argv.includes("--no-single-branch"), false);
  assert.equal(calls[0].argv[4], gitUrl);
  assert.equal(calls[0].argv[5], result.tool.path);

  const registered = await readRegisteredTools(repoRoot);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].source, "git");
  assert.equal(registered[0].origin.url, gitUrl);
});

test("git-sourced disclosure node payload manifests are forced enforced and require confirmation", async () => {
  const repoRoot = await makeTempRepoRoot();
  const { clone } = cloneWithManifest(({ targetDir }) =>
    validManifest("git-disclosure-payload", targetDir, {
      permissions: { mode: "disclosure" },
      entry: {
        kind: "cli",
        path: targetDir,
        devCommand: "node payload.js",
      },
    }),
  );

  const registered = await registerToolFromGit(
    repoRoot,
    "https://github.com/acme/disclosure-payload.git",
    { clone },
  );
  assert.equal(registered.ok, true);
  assert.equal(registered.tool.source, "git");
  assert.equal(registered.tool.manifest.permissions.mode, "enforced");

  const stored = await readRegisteredTools(repoRoot);
  assert.equal(stored[0].manifest.permissions.mode, "enforced");

  const launch = await launchTool(repoRoot, "git-disclosure-payload");
  assert.equal(launch.ok, false);
  assert.equal(launch.needsConfirmation, true);
  assert.equal(launch.error, "launch requires confirmation");
});

test("registerToolFromGit rejects a cloned tool with an invalid manifest without persisting", async () => {
  const repoRoot = await makeTempRepoRoot();
  const { clone } = cloneWithManifest(({ targetDir }) => {
    const manifest = validManifest("bad-git-tool", targetDir);
    delete manifest.entry.devCommand;
    return manifest;
  });

  const result = await registerToolFromGit(repoRoot, "https://github.com/acme/bad-tool.git", {
    clone,
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes("entry.devCommand is required."));

  const registered = await readRegisteredTools(repoRoot);
  assert.deepEqual(registered, []);
});

test("git-ingested external tools remain subject to enforced launch allowlist policy", async () => {
  const repoRoot = await makeTempRepoRoot();
  const { clone } = cloneWithManifest(({ targetDir }) =>
    validManifest("git-enforced-tool", targetDir, {
      permissions: { mode: "enforced" },
      entry: {
        kind: "cli",
        path: targetDir,
        devCommand: `${process.execPath} --version`,
      },
    }),
  );

  const registered = await registerToolFromGit(
    repoRoot,
    "https://github.com/acme/enforced-tool.git",
    { clone },
  );
  assert.equal(registered.ok, true);
  assert.equal(registered.tool.source, "git");

  const launch = await launchTool(repoRoot, "git-enforced-tool", { confirm: true });
  assert.equal(launch.ok, false);
  assert.match(launch.error, /contained absolute path/);
});

test("register-git route applies local request guard before URL validation", async () => {
  const response = await readRouteResponse(
    await registerGitRoutePost(routeRequest({ url: "file:///etc" }, { origin: "" })),
  );

  assert.equal(response.status, 403);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, "Origin header required for mutating requests");
});

test("register-git route returns 400 for an invalid git URL", async () => {
  const response = await readRouteResponse(
    await registerGitRoutePost(routeRequest({ url: "file:///etc" })),
  );

  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error, "git URL must use https://");
});

test("register-git route rejects local, private, metadata, decimal, and IPv4-mapped hosts", async () => {
  const rejected = [
    "https://169.254.169.254/x",
    "https://10.0.0.5/x",
    "https://2130706433/x",
    "https://[::ffff:127.0.0.1]/x",
  ];

  for (const url of rejected) {
    const response = await readRouteResponse(await registerGitRoutePost(routeRequest({ url })));
    assert.equal(response.status, 400, `${url} should be rejected`);
    assert.equal(response.body.ok, false);
    assert.match(response.body.error, /local, private, or link-local IP/);
  }
});
