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
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";

import {
  ENFORCED_BINARY_ALLOWLIST,
  firstDevCommandToken,
  loadToolManifest,
} from "@tyroneross/tool-spec";

const REGISTRY_DIR_NAME = ".agent-studio";
const REGISTRY_FILE_NAME = "tool-registry.json";
const MANIFEST_FILENAME = "agent-tool.json";
const PROBE_TIMEOUT_MS = 300;
const SHELL_METACHAR_PATTERN = /[;|&$`<>(){}]/;

let registryMutationLock = Promise.resolve();

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

function withRegistryMutationLock(fn) {
  const next = registryMutationLock.then(fn, fn);
  registryMutationLock = next.catch(() => {});
  return next;
}

function emptyRegistryState() {
  return { registered: [], runtime: {}, confirmations: {} };
}

function normalizeRegistryState(parsed) {
  if (Array.isArray(parsed)) {
    return { registered: parsed, runtime: {}, confirmations: {} };
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
    confirmations:
      parsed.confirmations &&
      typeof parsed.confirmations === "object" &&
      !Array.isArray(parsed.confirmations)
        ? parsed.confirmations
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

function isTrackedRuntimeLive(entry) {
  if (!entry || typeof entry !== "object") return false;
  if (!Number.isInteger(entry.pid) || entry.pid <= 0) return false;
  if (typeof entry.startedAt !== "string") return false;
  if (!Array.isArray(entry.argv) || entry.argv.length === 0) return false;
  return isLivePid(entry.pid);
}

function parseDevCommand(devCommand) {
  if (typeof devCommand !== "string" || devCommand.trim().length === 0) {
    return { ok: false, error: "tool devCommand is missing" };
  }
  if (SHELL_METACHAR_PATTERN.test(devCommand)) {
    return {
      ok: false,
      error: "tool devCommand contains unsupported shell metacharacters",
    };
  }

  const argv = devCommand.trim().split(/\s+/);
  const [command, ...args] = argv;
  if (!command) {
    return { ok: false, error: "tool devCommand is missing" };
  }
  return { ok: true, command, args, argv };
}

function permissionMode(tool) {
  return tool?.manifest?.permissions?.mode === "enforced" ? "enforced" : "disclosure";
}

function toolLaunchDirectory(repoRoot, tool) {
  if (tool?.source === "workspace") {
    const workspace = tool?.manifest?.entry?.workspace;
    return path.resolve(repoRoot, typeof workspace === "string" ? workspace : tool.path ?? "");
  }
  return path.resolve(tool?.path ?? repoRoot);
}

function isContainedPath(childPath, parentPath) {
  const relative = path.relative(parentPath, childPath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function commandPolicy(repoRoot, tool) {
  const firstToken = firstDevCommandToken(tool?.manifest?.entry?.devCommand);
  const isAllowlistedBinary = ENFORCED_BINARY_ALLOWLIST.includes(firstToken);
  const isContainedAbsolutePath =
    path.isAbsolute(firstToken) &&
    isContainedPath(path.resolve(firstToken), toolLaunchDirectory(repoRoot, tool));
  const mode = permissionMode(tool);
  const allowedForEnforced = isAllowlistedBinary || isContainedAbsolutePath;

  if (mode === "enforced" && !allowedForEnforced) {
    return {
      ok: false,
      error: "enforced tool devCommand must start with an allowed binary or contained absolute path",
    };
  }

  return {
    ok: true,
    mode,
    requiresConfirmation: mode === "enforced" || !isAllowlistedBinary,
  };
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
  return withRegistryMutationLock(async () => {
    const state = await readRegistryState(repoRoot);
    await writeRegistryState(repoRoot, {
      ...state,
      registered: Array.isArray(list) ? list : [],
    });
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

  await withRegistryMutationLock(async () => {
    const state = await readRegistryState(repoRoot);
    const deduped = state.registered.filter((t) => t.id !== manifest.id);
    deduped.push(tool);
    await writeRegistryState(repoRoot, {
      ...state,
      registered: deduped,
    });
  });

  return { ok: true, tool };
}

/** Remove a registered external tool by id and persist. */
export async function unregisterTool(repoRoot, id) {
  return withRegistryMutationLock(async () => {
    const state = await readRegistryState(repoRoot);
    const runtime = { ...(state.runtime ?? {}) };
    const confirmations = { ...(state.confirmations ?? {}) };
    stopRuntimeEntry(runtime[id]);
    delete runtime[id];
    delete confirmations[id];

    const next = state.registered.filter((t) => t.id !== id);
    await writeRegistryState(repoRoot, {
      ...state,
      registered: next,
      runtime,
      confirmations,
    });
    return { ok: true };
  });
}

/**
 * Launch a registered or workspace tool by spawning its declared dev command.
 * Runtime pid state is persisted alongside registered tools in the same
 * .agent-studio/tool-registry.json file.
 */
export async function launchTool(repoRoot, id, opts = {}) {
  return withRegistryMutationLock(async () => {
    const state = await readRegistryState(repoRoot);
    const workspaceTools = await discoverWorkspaceTools(repoRoot);
    const tool = [...workspaceTools, ...state.registered].find((item) => item.id === id) ?? null;
    if (!tool) {
      return { ok: false, error: "tool not found" };
    }

    const parsedCommand = parseDevCommand(tool?.manifest?.entry?.devCommand);
    if (!parsedCommand.ok) {
      return { ok: false, error: parsedCommand.error };
    }

    const policy = commandPolicy(repoRoot, tool);
    if (!policy.ok) {
      return { ok: false, error: policy.error };
    }
    if (!tool.valid) {
      return { ok: false, error: "tool manifest is invalid" };
    }

    const confirmations = { ...(state.confirmations ?? {}) };
    const isConfirmed = Boolean(confirmations[id]);
    if (policy.requiresConfirmation && !isConfirmed && opts?.confirm !== true) {
      return {
        ok: false,
        needsConfirmation: true,
        error: "launch requires confirmation",
      };
    }

    const existingRuntime = state.runtime?.[id];
    if (isTrackedRuntimeLive(existingRuntime)) {
      return { ok: true, alreadyRunning: true, pid: existingRuntime.pid };
    }

    const child = spawn(parsedCommand.command, parsedCommand.args, {
      cwd: repoRoot,
      shell: false,
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    const pid = child.pid;
    if (opts?.confirm === true && !isConfirmed) {
      confirmations[id] = new Date().toISOString();
    }
    await writeRegistryState(repoRoot, {
      ...state,
      runtime: {
        ...state.runtime,
        [id]: {
          pid,
          argv: parsedCommand.argv,
          port: tool?.manifest?.entry?.port,
          startedAt: new Date().toISOString(),
        },
      },
      confirmations,
    });

    return { ok: true, pid };
  });
}

/** Stop a tracked launched tool and clear its runtime pid state. */
export async function stopTool(repoRoot, id) {
  return withRegistryMutationLock(async () => {
    const state = await readRegistryState(repoRoot);
    const runtime = { ...(state.runtime ?? {}) };
    const stopResult = stopRuntimeEntry(runtime[id]);
    delete runtime[id];
    await writeRegistryState(repoRoot, {
      ...state,
      runtime,
    });
    return stopResult;
  });
}

function stopRuntimeEntry(entry) {
  if (!entry?.pid) {
    return { ok: true, notRunning: true };
  }
  if (!isTrackedRuntimeLive(entry)) {
    return { ok: true, notRunning: true };
  }

  const identity = verifyRuntimePidIdentity(entry);
  if (!identity.ok) {
    return { ok: true, notRunning: true, identityMismatch: true };
  }

  try {
    process.kill(entry.pid);
    return { ok: true };
  } catch (err) {
    if (err?.code === "ESRCH") {
      return { ok: true, notRunning: true };
    }
    throw err;
  }
}

function verifyRuntimePidIdentity(entry) {
  const result = spawnSync("ps", ["-o", "lstart=,command=", "-p", String(entry.pid)], {
    env: { ...process.env, LC_ALL: "C" },
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) return { ok: false };

  const line = result.stdout.trimEnd().split(/\r?\n/).find((item) => item.trim().length > 0);
  if (!line || line.length <= 24) return { ok: false };

  const psStartedAt = Date.parse(line.slice(0, 24).trim());
  const recordedStartedAt = Date.parse(entry.startedAt);
  if (!Number.isFinite(psStartedAt) || !Number.isFinite(recordedStartedAt)) {
    return { ok: false };
  }
  if (Math.abs(psStartedAt - recordedStartedAt) > 15_000) {
    return { ok: false };
  }

  const command = line.slice(24).trim();
  const expectedCommandName = path.basename(entry.argv[0] ?? "");
  if (!expectedCommandName || !command.includes(expectedCommandName)) {
    return { ok: false };
  }

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
      status: isTrackedRuntimeLive(runtime[tool.id]) ? "running" : await probeStatus(tool),
    })),
  );
}
