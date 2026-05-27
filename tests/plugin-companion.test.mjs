import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const PLUGIN_ROOT = join(process.cwd(), "plugin");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

test("plugin companion is standalone and version-aligned", async () => {
  const metadata = await readJson(join(PLUGIN_ROOT, "metadata.json"));
  const claude = await readJson(join(PLUGIN_ROOT, ".claude-plugin/plugin.json"));
  const codex = await readJson(join(PLUGIN_ROOT, ".codex-plugin/plugin.json"));

  assert.equal(metadata.productRole, "plugin-companion");
  assert.equal(metadata.standalone, true);
  assert.equal(metadata.bundledWithAppRepository, true);
  assert.equal(metadata.entrypoint, "SKILL.md");
  assert.equal(claude.version, metadata.version);
  assert.equal(codex.version, metadata.version);
  assert.equal(claude.repository, "https://github.com/tyroneross/agent-builder");
  assert.equal(codex.repository, "https://github.com/tyroneross/agent-builder");
  assert.equal(codex.skills, "./");

  for (const relativePath of metadata.requiredPaths) {
    assert.equal(await exists(join(PLUGIN_ROOT, relativePath)), true, `${relativePath} should exist in plugin companion`);
  }
});

test("plugin companion does not bundle app-only surfaces", async () => {
  const metadata = await readJson(join(PLUGIN_ROOT, "metadata.json"));
  for (const relativePath of metadata.excludedAppPaths) {
    assert.equal(await exists(join(PLUGIN_ROOT, relativePath)), false, `${relativePath} should not exist in plugin companion`);
  }
});
