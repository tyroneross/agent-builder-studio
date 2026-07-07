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
import crypto from "node:crypto";
import net from "node:net";
import path from "node:path";

import {
  ENFORCED_BINARY_ALLOWLIST,
  firstDevCommandToken,
  loadToolManifest,
} from "@tyroneross/tool-spec";

const REGISTRY_DIR_NAME = ".agent-studio";
const REGISTRY_FILE_NAME = "tool-registry.json";
const GIT_CACHE_DIR_NAME = "git-cache";
const MANIFEST_FILENAME = "agent-tool.json";
const PROBE_TIMEOUT_MS = 300;
const GIT_CLONE_TIMEOUT_MS = 60_000;
const SHELL_METACHAR_PATTERN = /[;|&$`<>(){}]/;
const GIT_URL_SHELL_METACHAR_PATTERN = /[\s;|&$`<>(){}\\'"]/;
const LOCAL_GIT_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

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

function isLikelyPathArgument(arg) {
  if (typeof arg !== "string" || arg.length === 0) return false;
  if (arg.startsWith("-")) return false;
  return (
    path.isAbsolute(arg) ||
    arg.startsWith(".") ||
    arg.includes("/") ||
    arg.includes("\\") ||
    /\.(?:cjs|mjs|js|jsx|ts|tsx|json|sh|py|rb|pl|php|jar|wasm)$/i.test(arg)
  );
}

function gitCommandPathPolicy(parsedCommand, launchDirectory) {
  for (const arg of parsedCommand.args ?? []) {
    if (!isLikelyPathArgument(arg)) continue;
    const candidate = path.isAbsolute(arg)
      ? path.resolve(arg)
      : path.resolve(launchDirectory, arg);
    if (!isContainedPath(candidate, launchDirectory)) {
      return {
        ok: false,
        error: "git-sourced tool devCommand paths must stay within the cloned tool directory",
      };
    }
  }
  return { ok: true };
}

function commandPolicy(repoRoot, tool, parsedCommand = null) {
  const firstToken =
    parsedCommand?.command ?? firstDevCommandToken(tool?.manifest?.entry?.devCommand);
  const isAllowlistedBinary = ENFORCED_BINARY_ALLOWLIST.includes(firstToken);
  const launchDirectory = toolLaunchDirectory(repoRoot, tool);
  const isContainedAbsolutePath =
    path.isAbsolute(firstToken) && isContainedPath(path.resolve(firstToken), launchDirectory);
  const mode = permissionMode(tool);
  const isGitSource = tool?.source === "git";
  const allowedForEnforced = isAllowlistedBinary || isContainedAbsolutePath;

  if (mode === "enforced" && !allowedForEnforced) {
    return {
      ok: false,
      error: "enforced tool devCommand must start with an allowed binary or contained absolute path",
    };
  }
  if (isGitSource) {
    const pathPolicy = gitCommandPathPolicy(parsedCommand ?? { args: [] }, launchDirectory);
    if (!pathPolicy.ok) return pathPolicy;
  }

  return {
    ok: true,
    mode,
    requiresConfirmation: isGitSource || mode === "enforced" || !isAllowlistedBinary,
  };
}

function normalizeUrlHostname(hostname) {
  return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function parseIpv4Octets(hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
  });
  return octets.every((part) => part !== null) ? octets : null;
}

function parseIpv4MappedIpv6Octets(hostname) {
  const lower = normalizeUrlHostname(hostname);
  if (!lower.startsWith("::ffff:")) return null;

  const tail = lower.slice("::ffff:".length);
  if (tail.includes(".")) return parseIpv4Octets(tail);

  const parts = tail.split(":");
  if (parts.length !== 2) return null;
  const words = parts.map((part) => {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
    return Number.parseInt(part, 16);
  });
  if (words.some((word) => word === null || word < 0 || word > 0xffff)) return null;
  return [(words[0] >> 8) & 0xff, words[0] & 0xff, (words[1] >> 8) & 0xff, words[1] & 0xff];
}

function isLocalOrPrivateIpv4(octets) {
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isLocalOrPrivateIpv6(hostname) {
  const lower = normalizeUrlHostname(hostname);
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd")
  );
}

function rawHostnameLooksNumericIp(rawUrl) {
  const match = rawUrl.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
  if (!match) return false;
  let authority = match[1];
  if (authority.includes("@")) authority = authority.slice(authority.lastIndexOf("@") + 1);
  if (authority.startsWith("[")) return false;
  const hostname = authority.split(":")[0].toLowerCase();
  return /^\d+$/.test(hostname) || /^0x[0-9a-f]+$/i.test(hostname);
}

function isLocalOrPrivateIpHostname(hostname) {
  const normalized = normalizeUrlHostname(hostname);
  const mapped = parseIpv4MappedIpv6Octets(normalized);
  if (mapped) return isLocalOrPrivateIpv4(mapped);

  const ipVersion = net.isIP(normalized);
  if (ipVersion === 4) {
    const octets = parseIpv4Octets(normalized);
    return octets ? isLocalOrPrivateIpv4(octets) : false;
  }
  if (ipVersion === 6) return isLocalOrPrivateIpv6(normalized);
  return false;
}

export function validateGitToolUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) {
    return { ok: false, error: "git URL required" };
  }
  if (rawUrl !== rawUrl.trim()) {
    return { ok: false, error: "git URL must not contain leading or trailing whitespace" };
  }
  if (rawUrl.startsWith("-")) {
    return { ok: false, error: "git URL must be an https URL" };
  }
  if (rawUrl.includes("--upload-pack")) {
    return { ok: false, error: "git URL contains unsupported git transport options" };
  }
  if (GIT_URL_SHELL_METACHAR_PATTERN.test(rawUrl)) {
    return { ok: false, error: "git URL contains unsupported shell metacharacters" };
  }

  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(rawUrl);
  } catch {
    return { ok: false, error: "git URL contains invalid percent-encoding" };
  }
  if (decodedUrl !== rawUrl && GIT_URL_SHELL_METACHAR_PATTERN.test(decodedUrl)) {
    return { ok: false, error: "git URL contains encoded shell metacharacters" };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "git URL must be a valid https URL" };
  }

  if (parsed.protocol !== "https:") {
    return { ok: false, error: "git URL must use https://" };
  }
  if (!parsed.hostname) {
    return { ok: false, error: "git URL must include a host" };
  }
  if (rawHostnameLooksNumericIp(rawUrl) || isLocalOrPrivateIpHostname(parsed.hostname)) {
    return { ok: false, error: "git URL host must not be a local, private, or link-local IP" };
  }
  if (LOCAL_GIT_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
    return { ok: false, error: "git URL must point to a remote host" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "git URL credentials are not supported" };
  }
  if (parsed.search || parsed.hash) {
    return { ok: false, error: "git URL query strings and fragments are not supported" };
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    return { ok: false, error: "git URL must include a repository path" };
  }

  // Residual accepted risk: this rejects literal private/local IPs but does
  // not resolve DNS, so DNS rebinding is not detected during registration.
  return { ok: true, url: parsed.href };
}

function gitCacheSlug(validatedGitUrl) {
  const parsed = new URL(validatedGitUrl);
  const base = `${parsed.hostname}${parsed.pathname.replace(/\.git$/i, "")}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const hash = crypto.createHash("sha256").update(validatedGitUrl).digest("hex").slice(0, 12);
  return `${base || "repo"}-${hash}`;
}

function gitCloneArgv(gitUrl, targetDir) {
  return ["clone", "--depth", "1", "--filter=blob:limit=10m", gitUrl, targetDir];
}

function cloneGitRepository({
  gitUrl,
  targetDir,
  argv = gitCloneArgv(gitUrl, targetDir),
  timeoutMs = GIT_CLONE_TIMEOUT_MS,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", argv, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let settled = false;
    let timedOut = false;
    let timer;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
      if (stderr.length > 8_000) stderr = stderr.slice(-8_000);
    });
    child.once("error", (err) => {
      finish(reject, err);
    });
    child.once("close", (code) => {
      if (timedOut) {
        finish(reject, new Error(`git clone timed out after ${timeoutMs}ms`));
        return;
      }
      if (code === 0) {
        finish(resolve);
        return;
      }
      finish(reject, new Error(`git clone failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

async function persistRegisteredTool(repoRoot, tool) {
  const state = await readRegistryState(repoRoot);
  const deduped = state.registered.filter((t) => t.id !== tool.id);
  deduped.push(tool);
  await writeRegistryState(repoRoot, {
    ...state,
    registered: deduped,
  });
}

function forceGitManifestPermissions(manifest) {
  return {
    ...manifest,
    permissions: {
      ...(manifest.permissions ?? {}),
      mode: "enforced",
    },
  };
}

async function registerToolPathUnlocked(repoRoot, absPath, overrides = {}, opts = {}) {
  const loaded = loadToolManifest(absPath);
  const { errors } = loaded;
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const manifest =
    typeof opts.manifestTransform === "function"
      ? opts.manifestTransform(loaded.manifest)
      : loaded.manifest;

  const tool = {
    id: manifest.id,
    name: manifest.name,
    manifest,
    source: "external",
    valid: true,
    errors: [],
    path: absPath,
    ...overrides,
  };

  await persistRegisteredTool(repoRoot, tool);
  return { ok: true, tool };
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
  return withRegistryMutationLock(() => registerToolPathUnlocked(repoRoot, absPath));
}

export async function registerToolFromGit(repoRoot, gitUrl, opts = {}) {
  return withRegistryMutationLock(async () => {
    const validation = validateGitToolUrl(gitUrl);
    if (!validation.ok) {
      return { ok: false, error: validation.error };
    }

    const targetDir = path.join(
      repoRoot,
      REGISTRY_DIR_NAME,
      GIT_CACHE_DIR_NAME,
      gitCacheSlug(validation.url),
    );
    const argv = gitCloneArgv(validation.url, targetDir);
    await fsp.mkdir(path.dirname(targetDir), { recursive: true });
    await fsp.rm(targetDir, { recursive: true, force: true });

    const clone = opts.clone ?? cloneGitRepository;
    await clone({ gitUrl: validation.url, targetDir, argv, timeoutMs: opts.cloneTimeoutMs });

    return registerToolPathUnlocked(
      repoRoot,
      targetDir,
      {
        source: "git",
        origin: {
          type: "git",
          url: validation.url,
        },
      },
      { manifestTransform: forceGitManifestPermissions },
    );
  });
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

    const policy = commandPolicy(repoRoot, tool, parsedCommand);
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

  // Tighten beyond the bare binary name: a generic basename like "node" or "npm"
  // matches any same-runtime process, so for multi-token commands also require a
  // distinctive later argument (script path / workspace name) to appear. This
  // stops a recycled pid held by an unrelated node/npm process from passing
  // identity on the ±15s window alone.
  if (Array.isArray(entry.argv) && entry.argv.length > 1) {
    const distinctive = entry.argv
      .slice(1)
      .map((token) => path.basename(String(token)))
      .filter((token) => token.length > 0);
    if (distinctive.length > 0 && !distinctive.some((token) => command.includes(token))) {
      return { ok: false };
    }
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
