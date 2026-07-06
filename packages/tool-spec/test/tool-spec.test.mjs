import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CANONICAL_SCHEMA_VERSION,
  isAcceptedSchemaVersion,
  canonicalSchemaVersion,
  TOOL_TYPES,
  ENTRY_KINDS,
  PERMISSION_MODES,
  validateToolManifest,
  loadToolManifest,
} from "../index.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "fixtures");

function validWorkspaceManifest() {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    id: "meetings",
    name: "Meetings Analyzer",
    description: "Analyze meeting transcripts.",
    type: "workflow-app",
    entry: {
      kind: "next-app",
      workspace: "apps/meetings",
      devCommand: "npm run dev --workspace meetings",
      port: 3032,
      healthPath: "/",
    },
    capabilities: ["transcript-ingest", "summary-report"],
    inputs: [{ id: "transcript", type: "file", required: true }],
    outputs: [{ id: "report", type: "markdown" }],
    env: {
      required: [{ name: "OMNIPARSE_SDK_PATH", description: "Path to Omniparse SDK entry" }],
      optional: [{ name: "OLLAMA_BASE_URL", default: "http://localhost:11434" }],
    },
    permissions: {
      mode: "disclosure",
      filesystem: ["read: transcript store"],
      network: ["http://localhost:11434"],
    },
    compat: { node: ">=22.13", studio: CANONICAL_SCHEMA_VERSION },
  };
}

test("validateToolManifest returns [] for a fully-valid manifest", () => {
  assert.deepEqual(validateToolManifest(validWorkspaceManifest()), []);
});

test("validateToolManifest returns [] for a valid external-path manifest", () => {
  const manifest = validWorkspaceManifest();
  delete manifest.entry.workspace;
  manifest.entry.path = "/opt/external-tools/cli-tool";
  manifest.entry.kind = "cli";
  manifest.type = "cli";
  assert.deepEqual(validateToolManifest(manifest), []);
});

test("schemaVersion missing", () => {
  const manifest = validWorkspaceManifest();
  delete manifest.schemaVersion;
  assert.ok(validateToolManifest(manifest).includes("schemaVersion is required."));
});

test("schemaVersion not accepted", () => {
  const manifest = validWorkspaceManifest();
  manifest.schemaVersion = "bogus.v0";
  const errors = validateToolManifest(manifest);
  assert.ok(errors.includes('schemaVersion "bogus.v0" is not an accepted schema version.'));
});

test("id missing", () => {
  const manifest = validWorkspaceManifest();
  delete manifest.id;
  assert.ok(validateToolManifest(manifest).includes("id is required."));
});

test("id not a slug", () => {
  const manifest = validWorkspaceManifest();
  manifest.id = "Not A Slug!";
  assert.ok(
    validateToolManifest(manifest).includes(
      "id must be a lowercase slug (letters, numbers, hyphens only).",
    ),
  );
});

test("name missing", () => {
  const manifest = validWorkspaceManifest();
  delete manifest.name;
  assert.ok(validateToolManifest(manifest).includes("name is required."));
});

test("name empty string", () => {
  const manifest = validWorkspaceManifest();
  manifest.name = "   ";
  assert.ok(validateToolManifest(manifest).includes("name is required."));
});

test("type invalid", () => {
  const manifest = validWorkspaceManifest();
  manifest.type = "not-a-type";
  assert.ok(
    validateToolManifest(manifest).includes(`type must be one of: ${TOOL_TYPES.join(", ")}.`),
  );
});

test("entry missing", () => {
  const manifest = validWorkspaceManifest();
  delete manifest.entry;
  assert.ok(validateToolManifest(manifest).includes("entry is required."));
});

test("entry.kind invalid", () => {
  const manifest = validWorkspaceManifest();
  manifest.entry.kind = "not-a-kind";
  assert.ok(
    validateToolManifest(manifest).includes(
      `entry.kind must be one of: ${ENTRY_KINDS.join(", ")}.`,
    ),
  );
});

test("entry with both workspace and path is an error", () => {
  const manifest = validWorkspaceManifest();
  manifest.entry.path = "/opt/external-tools/cli-tool";
  assert.ok(
    validateToolManifest(manifest).includes(
      "entry must have exactly one of entry.workspace or entry.path, not both.",
    ),
  );
});

test("entry with neither workspace nor path is an error", () => {
  const manifest = validWorkspaceManifest();
  delete manifest.entry.workspace;
  assert.ok(
    validateToolManifest(manifest).includes(
      "entry must have exactly one of entry.workspace or entry.path.",
    ),
  );
});

test("entry.path must be absolute", () => {
  const manifest = validWorkspaceManifest();
  delete manifest.entry.workspace;
  manifest.entry.path = "relative/path/tool";
  assert.ok(
    validateToolManifest(manifest).includes(
      "entry.path must be an absolute path (starting with /).",
    ),
  );
});

test("entry.devCommand missing", () => {
  const manifest = validWorkspaceManifest();
  delete manifest.entry.devCommand;
  assert.ok(validateToolManifest(manifest).includes("entry.devCommand is required."));
});

test("env.required must be an array", () => {
  const manifest = validWorkspaceManifest();
  manifest.env.required = "not-an-array";
  assert.ok(validateToolManifest(manifest).includes("env.required must be an array."));
});

test("env.required entries need a non-empty name", () => {
  const manifest = validWorkspaceManifest();
  manifest.env.required = [{ description: "no name here" }];
  assert.ok(
    validateToolManifest(manifest).includes("env.required entries must have a non-empty name."),
  );
});

test("env.optional entries need a non-empty name", () => {
  const manifest = validWorkspaceManifest();
  manifest.env.optional = [{ default: "x" }];
  assert.ok(
    validateToolManifest(manifest).includes("env.optional entries must have a non-empty name."),
  );
});

test("permissions.mode invalid", () => {
  const manifest = validWorkspaceManifest();
  manifest.permissions.mode = "open";
  assert.ok(
    validateToolManifest(manifest).includes(
      `permissions.mode must be one of: ${PERMISSION_MODES.join(", ")}.`,
    ),
  );
});

test("schema-version normalization round-trips the canonical literal", () => {
  assert.ok(isAcceptedSchemaVersion(CANONICAL_SCHEMA_VERSION));
  assert.equal(canonicalSchemaVersion(CANONICAL_SCHEMA_VERSION), CANONICAL_SCHEMA_VERSION);
  assert.equal(canonicalSchemaVersion("bogus.v0"), "bogus.v0");
});

test("loadToolManifest reads + validates a valid workspace fixture", () => {
  const { manifest, errors } = loadToolManifest(join(FIXTURES, "valid-workspace"));
  assert.deepEqual(errors, []);
  assert.equal(manifest.id, "meetings");
  assert.equal(manifest.schemaVersion, CANONICAL_SCHEMA_VERSION);
});

test("loadToolManifest reads + validates a valid external-path fixture", () => {
  const { manifest, errors } = loadToolManifest(join(FIXTURES, "valid-external"));
  assert.deepEqual(errors, []);
  assert.equal(manifest.entry.path, "/opt/external-tools/cli-tool");
});

test("loadToolManifest surfaces a JSON parse error", () => {
  const { manifest, errors } = loadToolManifest(join(FIXTURES, "malformed-json"));
  assert.equal(manifest, null);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Could not parse/);
});
