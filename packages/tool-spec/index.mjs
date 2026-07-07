// @tyroneross/tool-spec — the agent-tool.json manifest contract: schema,
// validation, and loading, for tools registered with agent-builder-studio.

export {
  CANONICAL_SCHEMA_VERSION,
  ACCEPTED_SCHEMA_VERSIONS,
  isAcceptedSchemaVersion,
  canonicalSchemaVersion,
  TOOL_TYPES,
  ENTRY_KINDS,
  PERMISSION_MODES,
  ENFORCED_BINARY_ALLOWLIST,
  firstDevCommandToken,
} from "./src/schema.mjs";
export { validateToolManifest } from "./src/validate.mjs";
export { loadToolManifest } from "./src/load.mjs";
