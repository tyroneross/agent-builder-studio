// Studio-side tool registry: discovers first-party workspace tools
// (apps/*/agent-tool.json) and persists external local-path registrations.
// Everything that touches a manifest is validated through
// `@tyroneross/tool-spec` (loadToolManifest / validateToolManifest) — this
// module never re-implements manifest validation.
//
// NAMING: state file + identifiers use "tool-registry" (never bare
// "registry") to avoid collision with packages/agent-artifacts's
// `.artifacts/registry.json`. State lives at `<repoRoot>/.agent-studio/tool-registry.json`.

import { existsSync, readFileSync } from "node:fs";
import { promises as fsp } from "node:fs";
import net from "node:net";
import path from "node:path";

import { loadToolManifest } from "@tyroneross/tool-spec";

const REGISTRY_DIR_NAME = ".agent-studio";
const REGISTRY_FILE_NAME = "tool-registry.json";
const MANIFEST_FILENAME = "agent-tool.json";
const PROBE_TIMEOUT_MS = 300;

/**
 * Find the repo root: the nearest ancestor of `startDir` whose package.json
 * declares `workspaces`. Studio normally runs with cwd already at the repo
 * root, so this is a fast no-op in production and a safety net otherwise.
 * Falls back to `startDir` if no such ancestor is found.
 */
export function findRepoRoot(startDir = process.cwd()) {
  let dir = path.resolve(startDir);
  while (true) {
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
        if (pkg && pkg.workspaces) return dir;
      } catch {
        // Malformed package.json — keep walking up.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(startDir);
    dir = parent;
  }
}

function toolRegistryPath(repoRoot) {
  return path.join(repoRoot, REGISTRY_DIR_NAME, REGISTRY_FILE_NAME);
}

/**
 * Discover first-party workspace tools: every apps/&lt;name&gt;/agent-tool.json.
 * Each manifest is loaded + validated via tool-spec; invalid manifests are
 * still returned (so the UI can surface the errors) with `valid: false`.
 */
export async function discoverWorkspaceTools(repoRoot) {
  const appsDir = path.join(repoRoot, "apps");
  let entries;
  try {
    entries = await fsp.readdir(appsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(appsDir, entry.name);
    const manifestPath = path.join(dir, MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) continue;

    const { manifest, errors } = loadToolManifest(dir);
    results.push({
      id: manifest?.id ?? entry.name,
      name: manifest?.name ?? entry.name,
      manifest,
      source: "workspace",
      valid: errors.length === 0,
      errors,
      path: dir,
    });
  }
  return results;
}

/** Read the persisted list of externally-registered tools. `[]` if absent. */
export async function readRegisteredTools(repoRoot) {
  const filePath = toolRegistryPath(repoRoot);
  let raw;
  try {
    raw = await fsp.readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persist the list of externally-registered tools (creates the dir if missing). */
export async function writeRegisteredTools(repoRoot, list) {
  const filePath = toolRegistryPath(repoRoot);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

/**
 * Register an external tool by absolute directory path (must contain
 * agent-tool.json). Validates via tool-spec first; on failure returns the
 * tool-spec error strings without touching the persisted list. On success,
 * dedupes by manifest id and persists.
 */
export async function registerToolPath(repoRoot, absPath) {
  const { manifest, errors } = loadToolManifest(absPath);
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const tool = {
    id: manifest.id,
    name: manifest.name,
    manifest,
    source: "external",
    valid: true,
    errors: [],
    path: absPath,
  };

  const list = await readRegisteredTools(repoRoot);
  const deduped = list.filter((t) => t.id !== manifest.id);
  deduped.push(tool);
  await writeRegisteredTools(repoRoot, deduped);

  return { ok: true, tool };
}

/** Remove a registered external tool by id and persist. */
export async function unregisterTool(repoRoot, id) {
  const list = await readRegisteredTools(repoRoot);
  const next = list.filter((t) => t.id !== id);
  await writeRegisteredTools(repoRoot, next);
  return { ok: true };
}

/**
 * Best-effort TCP probe of a tool's declared port. Never throws; resolves
 * "running" | "stopped" within ~PROBE_TIMEOUT_MS.
 */
export function probeStatus(tool) {
  const port = tool?.manifest?.entry?.port;
  if (typeof port !== "number") return Promise.resolve("stopped");

  return new Promise((resolve) => {
    let settled = false;
    const socket = new net.Socket();

    const finish = (status) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(status);
    };

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish("running"));
    socket.once("timeout", () => finish("stopped"));
    socket.once("error", () => finish("stopped"));

    try {
      socket.connect(port, "127.0.0.1");
    } catch {
      finish("stopped");
    }
  });
}

/**
 * Merge discovered workspace tools + registered external tools, annotating
 * each with a live `status` ("running" | "stopped") from a port probe.
 */
export async function listAllTools(repoRoot) {
  const [workspaceTools, registeredTools] = await Promise.all([
    discoverWorkspaceTools(repoRoot),
    readRegisteredTools(repoRoot),
  ]);

  const merged = [...workspaceTools, ...registeredTools];
  return Promise.all(
    merged.map(async (tool) => ({
      ...tool,
      status: await probeStatus(tool),
    })),
  );
}
