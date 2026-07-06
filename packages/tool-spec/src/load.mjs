// Loads + validates an agent-tool.json manifest from a directory.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalSchemaVersion } from "./schema.mjs";
import { validateToolManifest } from "./validate.mjs";

const MANIFEST_FILENAME = "agent-tool.json";

/**
 * Read + parse `<dir>/agent-tool.json`, normalize its schemaVersion on read,
 * and validate it. Never throws: parse failures and validation failures both
 * surface in the returned `errors` array.
 *
 * @param {string} dir - directory containing agent-tool.json
 * @returns {{ manifest: object|null, errors: string[] }}
 */
export function loadToolManifest(dir) {
  const manifestPath = join(dir, MANIFEST_FILENAME);

  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (err) {
    return { manifest: null, errors: [`Could not read ${manifestPath}: ${err.message}`] };
  }

  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    return { manifest: null, errors: [`Could not parse ${manifestPath}: ${err.message}`] };
  }

  if (manifest && typeof manifest === "object" && !Array.isArray(manifest)) {
    manifest.schemaVersion = canonicalSchemaVersion(manifest.schemaVersion);
  }

  const errors = validateToolManifest(manifest);
  return { manifest, errors };
}
