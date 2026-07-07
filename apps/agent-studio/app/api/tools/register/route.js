// POST /api/tools/register
// Body: { path: string }  (absolute directory containing agent-tool.json)
// Response (always JSON):
//   - Valid manifest:   { ok: true, tool }                          (200)
//   - Invalid manifest: { ok: false, errors: string[] }             (400)
//   - Bad request:      { ok: false, error: string }                (400)
//
// Validates through @tyroneross/tool-spec via registerToolPath; on success,
// the tool is deduped by id and persisted to .agent-studio/tool-registry.json.

import path from "node:path";

import { findRepoRoot, registerToolPath } from "../../../lib/tool-registry.mjs";

export const runtime = "nodejs";

// Same path allowlist as app/api/fs/list/route.js. Keep duplicated here
// because this security fix is scoped to api/tools/* ownership.
const PERMITTED_PREFIXES = ["/Users/", "/tmp/", "/var/folders/"];
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function isPermitted(absolute) {
  return PERMITTED_PREFIXES.some(
    (prefix) => absolute.startsWith(prefix) || absolute + "/" === prefix,
  );
}

function localHostname(hostname) {
  return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function isLocalHostname(hostname) {
  return LOCAL_HOSTNAMES.has(localHostname(hostname));
}

function parseHost(host) {
  try {
    return new URL(`http://${host}`);
  } catch {
    return null;
  }
}

function assertLocalRequest(request) {
  const host = request.headers.get("host") || new URL(request.url).host;
  const hostUrl = parseHost(host);
  if (!hostUrl || !isLocalHostname(hostUrl.hostname)) {
    return Response.json({ ok: false, error: "local request required" }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (!origin) return null;

  let originUrl;
  try {
    originUrl = new URL(origin);
  } catch {
    return Response.json({ ok: false, error: "same-origin request required" }, { status: 403 });
  }

  if (!isLocalHostname(originUrl.hostname) || originUrl.host !== hostUrl.host) {
    return Response.json({ ok: false, error: "same-origin request required" }, { status: 403 });
  }
  return null;
}

export async function POST(request) {
  const localRequestError = assertLocalRequest(request);
  if (localRequestError) return localRequestError;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const raw = body?.path;
  if (typeof raw !== "string" || raw.length === 0) {
    return Response.json({ ok: false, error: "path required" }, { status: 400 });
  }
  if (!raw.startsWith("/")) {
    return Response.json({ ok: false, error: "path must be absolute" }, { status: 400 });
  }

  const absPath = path.resolve(raw);
  if (!isPermitted(absPath)) {
    return Response.json({ ok: false, error: "path outside permitted root" }, { status: 400 });
  }

  const repoRoot = findRepoRoot(process.cwd());

  let result;
  try {
    result = await registerToolPath(repoRoot, absPath);
  } catch (err) {
    return Response.json(
      { ok: false, error: err?.message || "register failed" },
      { status: 500 },
    );
  }

  if (!result.ok) {
    return Response.json({ ok: false, errors: result.errors }, { status: 400 });
  }
  return Response.json({ ok: true, tool: result.tool });
}
