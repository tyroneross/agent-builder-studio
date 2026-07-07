// POST /api/tools/stop
// Body: { id: string }
// Response (always JSON):
//   { ok: true, notRunning?: true }
//   { ok: false, error: string }
//
// Stops a tracked launched tool and clears its runtime pid state in
// .agent-studio/tool-registry.json.

import { findRepoRoot, stopTool } from "../../../lib/tool-registry.mjs";

export const runtime = "nodejs";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

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

  const id = body?.id;
  if (typeof id !== "string" || id.length === 0) {
    return Response.json({ ok: false, error: "id required" }, { status: 400 });
  }

  const repoRoot = findRepoRoot(process.cwd());
  try {
    return Response.json(await stopTool(repoRoot, id));
  } catch (err) {
    return Response.json({ ok: false, error: err?.message || "stop failed" }, { status: 500 });
  }
}
