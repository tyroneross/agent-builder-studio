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

// Mutating local API routes require an explicit Origin. Same-origin browser
// POSTs send it automatically; local scripts/agents must set
// `Origin: http://localhost:<port>` to use these endpoints.
export function assertLocalRequest(request) {
  const host = request.headers.get("host") || new URL(request.url).host;
  const hostUrl = parseHost(host);
  if (!hostUrl || !isLocalHostname(hostUrl.hostname)) {
    return Response.json({ ok: false, error: "local request required" }, { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return Response.json(
      { ok: false, error: "Origin header required for mutating requests" },
      { status: 403 },
    );
  }

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
