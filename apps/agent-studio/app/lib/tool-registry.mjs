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
import { spawn } from "node:child_process";
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

function emptyRegistryState() {
  return { registered: [], runtime: {} };
}

function normalizeRegistryState(parsed) {
  if (Array.isArray(parsed)) {
    return { registered: parsed, runtime: {} };
  }
  if (!parsed || typeof parsed !== "object") {
    return emptyRegistryState();
  }
  return {
    registered: Array.isArray(parsed.registered) ? parsed.registered : [],
    runtime:
      parsed.runtime && typeof parsed.runtime === "object" && !Array.isArray(parsed.runtime)
        ? parsed.runtime
        : {},
  };
}

async function readRegistryState(repoRoot) {
  const filePath = toolRegistryPath(repoRoot);
  let raw;
  try {
    raw = await fsp.readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return emptyRegistryState();
    throw err;
  }
  try {
    return normalizeRegistryState(JSON.parse(raw));
  } catch {
    return emptyRegistryState();
  }
}

async function writeRegistryState(repoRoot, state) {
  const filePath = toolRegistryPath(repoRoot);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(
    filePath,
    `${JSON.stringify(normalizeRegistryState(state), null, 2)}\n`,
    "utf8",
  );
}

function isLivePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function resolveTool(repoRoot, id) {
  const [workspaceTools, registeredTools] = await Promise.all([
    discoverWorkspaceTools(repoRoot),
    readRegisteredTools(repoRoot),
  ]);
  return [...workspaceTools, ...registeredTools].find((tool) => tool.id === id) ?? null;
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
  const state = await readRegistryState(repoRoot);
  return state.registered;
}

/** Persist the list of externally-registered tools (creates the dir if missing). */
export async function writeRegisteredTools(repoRoot, list) {
  const state = await readRegistryState(repoRoot);
  await writeRegistryState(repoRoot, {
    ...state,
    registered: Array.isArray(list) ? list : [],
  });
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
 * Launch a registered or workspace tool by spawning its declared dev command.
 * Runtime pid state is persisted alongside registered tools in the same
 * .agent-studio/tool-registry.json file.
 */
export async function launchTool(repoRoot, id) {
  const state = await readRegistryState(repoRoot);
  const existingPid = state.runtime?.[id]?.pid;
  if (isLivePid(existingPid)) {
    return { ok: true, alreadyRunning: true, pid: existingPid };
  }

  const tool = await resolveTool(repoRoot, id);
  if (!tool) {
    return { ok: false, error: "tool not found" };
  }
  if (!tool.valid) {
    return { ok: false, error: "tool manifest is invalid" };
  }

  const devCommand = tool?.manifest?.entry?.devCommand;
  if (typeof devCommand !== "string" || devCommand.length === 0) {
    return { ok: false, error: "tool devCommand is missing" };
  }

  const child = spawn(devCommand, {
    cwd: repoRoot,
    shell: true,
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const pid = child.pid;
  const nextState = await readRegistryState(repoRoot);
  await writeRegistryState(repoRoot, {
    ...nextState,
    runtime: {
      ...nextState.runtime,
      [id]: {
        pid,
        port: tool?.manifest?.entry?.port,
        startedAt: new Date().toISOString(),
      },
    },
  });

  return { ok: true, pid };
}

/** Stop a tracked launched tool and clear its runtime pid state. */
export async function stopTool(repoRoot, id) {
  const state = await readRegistryState(repoRoot);
  const runtime = state.runtime ?? {};
  const pid = runtime[id]?.pid;
  if (!pid) {
    return { ok: true, notRunning: true };
  }

  try {
    process.kill(pid);
  } catch (err) {
    if (err?.code !== "ESRCH") throw err;
  }

  const nextRuntime = { ...runtime };
  delete nextRuntime[id];
  await writeRegistryState(repoRoot, {
    ...state,
    runtime: nextRuntime,
  });
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
 * each with a live `status` ("running" | "stopped") from tracked pid state
 * first and port probing as the fallback.
 */
export async function listAllTools(repoRoot) {
  const [workspaceTools, registryState] = await Promise.all([
    discoverWorkspaceTools(repoRoot),
    readRegistryState(repoRoot),
  ]);
  const registeredTools = registryState.registered;
  const runtime = registryState.runtime ?? {};

  const merged = [...workspaceTools, ...registeredTools];
  return Promise.all(
    merged.map(async (tool) => ({
      ...tool,
      status: isLivePid(runtime[tool.id]?.pid) ? "running" : await probeStatus(tool),
    })),
  );
}
