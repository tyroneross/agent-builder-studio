// Schema-version canon for the agent-tool.json manifest contract.
//
// Mirrors @tyroneross/agent-spec's src/schema.mjs pattern: one canonical
// literal, an ACCEPTED array (structured so future aliases can be appended
// without touching call sites), and normalize-on-read semantics.

export const CANONICAL_SCHEMA_VERSION = "agent-builder.tool.v1";

// All accepted schema-version strings that denote the current tool-manifest
// contract. Only the canonical form exists today; this stays an array so a
// future alias (e.g. a renamed literal) can be added without a shape change.
export const ACCEPTED_SCHEMA_VERSIONS = Object.freeze([CANONICAL_SCHEMA_VERSION]);

/** True if `value` is any accepted schema-version string. */
export function isAcceptedSchemaVersion(value) {
  return ACCEPTED_SCHEMA_VERSIONS.includes(value);
}

/**
 * Normalize a schema-version string to the canonical form on READ.
 * Unknown values pass through unchanged (callers decide whether to reject).
 */
export function canonicalSchemaVersion(value) {
  return isAcceptedSchemaVersion(value) ? CANONICAL_SCHEMA_VERSION : value;
}

// Field enums for the agent-tool.json manifest.

export const TOOL_TYPES = Object.freeze(["workflow-app", "cli", "service"]);

export const ENTRY_KINDS = Object.freeze(["next-app", "node-app", "cli"]);

export const PERMISSION_MODES = Object.freeze(["disclosure", "enforced"]);

export const ENFORCED_BINARY_ALLOWLIST = Object.freeze(["npm", "pnpm", "yarn", "node"]);

export function firstDevCommandToken(devCommand) {
  if (typeof devCommand !== "string") return "";
  return devCommand.trim().split(/\s+/)[0] ?? "";
}
