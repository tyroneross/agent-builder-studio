// First-party contract test: every real app in this monorepo that ships an
// `agent-tool.json` must pass validateToolManifest with zero errors. This
// globs `apps/*/agent-tool.json` at run time, so it automatically picks up
// new apps (investments, cos, ...) as they add manifests — no per-app test
// needs to be hand-added here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadToolManifest } from "../index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// test/ -> packages/tool-spec -> packages -> <repo root>
const REPO_ROOT = join(__dirname, "..", "..", "..");
const APPS_DIR = join(REPO_ROOT, "apps");

function findAppsWithManifest() {
  if (!existsSync(APPS_DIR)) return [];
  return readdirSync(APPS_DIR)
    .filter((name) => statSync(join(APPS_DIR, name)).isDirectory())
    .filter((name) => existsSync(join(APPS_DIR, name, "agent-tool.json")))
    .sort();
}

const apps = findAppsWithManifest();

test("at least one app in apps/* ships an agent-tool.json manifest", () => {
  assert.ok(
    apps.length > 0,
    `Expected at least one apps/*/agent-tool.json, found none under ${APPS_DIR}`,
  );
});

test("meetings ships a valid agent-tool.json", () => {
  assert.ok(
    apps.includes("meetings"),
    `Expected apps/meetings/agent-tool.json to exist (found: ${apps.join(", ") || "none"})`,
  );
});

for (const appName of apps) {
  test(`apps/${appName}/agent-tool.json passes validateToolManifest`, () => {
    const dir = join(APPS_DIR, appName);
    const { manifest, errors } = loadToolManifest(dir);
    assert.deepEqual(
      errors,
      [],
      `apps/${appName}/agent-tool.json is invalid:\n${errors.join("\n")}`,
    );
    assert.ok(manifest, `apps/${appName}/agent-tool.json failed to load`);
  });
}
