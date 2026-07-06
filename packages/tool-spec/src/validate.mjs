// Validates the agent-tool.json manifest contract. Mirrors the shape of
// @tyroneross/agent-spec's src/validate.mjs: a pure function that returns an
// array of error strings (empty = valid). No throwing, no side effects.

import { isAcceptedSchemaVersion, TOOL_TYPES, ENTRY_KINDS, PERMISSION_MODES } from "./schema.mjs";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate a tool manifest. Returns an array of error strings (empty = valid).
 */
export function validateToolManifest(manifest) {
  const errors = [];
  const m = manifest ?? {};

  // schemaVersion
  if (!isNonEmptyString(m.schemaVersion)) {
    errors.push("schemaVersion is required.");
  } else if (!isAcceptedSchemaVersion(m.schemaVersion)) {
    errors.push(`schemaVersion "${m.schemaVersion}" is not an accepted schema version.`);
  }

  // id
  if (!isNonEmptyString(m.id)) {
    errors.push("id is required.");
  } else if (!SLUG_RE.test(m.id)) {
    errors.push("id must be a lowercase slug (letters, numbers, hyphens only).");
  }

  // name
  if (!isNonEmptyString(m.name)) {
    errors.push("name is required.");
  }

  // type
  if (!TOOL_TYPES.includes(m.type)) {
    errors.push(`type must be one of: ${TOOL_TYPES.join(", ")}.`);
  }

  // entry
  if (typeof m.entry !== "object" || m.entry === null || Array.isArray(m.entry)) {
    errors.push("entry is required.");
  } else {
    const entry = m.entry;

    if (!ENTRY_KINDS.includes(entry.kind)) {
      errors.push(`entry.kind must be one of: ${ENTRY_KINDS.join(", ")}.`);
    }

    const hasWorkspace = isNonEmptyString(entry.workspace);
    const hasPath = isNonEmptyString(entry.path);

    if (hasWorkspace && hasPath) {
      errors.push("entry must have exactly one of entry.workspace or entry.path, not both.");
    } else if (!hasWorkspace && !hasPath) {
      errors.push("entry must have exactly one of entry.workspace or entry.path.");
    } else if (hasPath && !entry.path.startsWith("/")) {
      errors.push("entry.path must be an absolute path (starting with /).");
    }

    if (!isNonEmptyString(entry.devCommand)) {
      errors.push("entry.devCommand is required.");
    }
  }

  // env (optional block)
  if (m.env !== undefined) {
    if (typeof m.env !== "object" || m.env === null || Array.isArray(m.env)) {
      errors.push("env must be an object.");
    } else {
      if (!Array.isArray(m.env.required)) {
        errors.push("env.required must be an array.");
      } else if (m.env.required.some((item) => !isNonEmptyString(item?.name))) {
        errors.push("env.required entries must have a non-empty name.");
      }

      if (m.env.optional !== undefined) {
        if (!Array.isArray(m.env.optional)) {
          errors.push("env.optional must be an array.");
        } else if (m.env.optional.some((item) => !isNonEmptyString(item?.name))) {
          errors.push("env.optional entries must have a non-empty name.");
        }
      }
    }
  }

  // permissions (optional block)
  if (m.permissions !== undefined) {
    if (typeof m.permissions !== "object" || m.permissions === null || Array.isArray(m.permissions)) {
      errors.push("permissions must be an object.");
    } else if (!PERMISSION_MODES.includes(m.permissions.mode)) {
      errors.push(`permissions.mode must be one of: ${PERMISSION_MODES.join(", ")}.`);
    }
  }

  return errors;
}
