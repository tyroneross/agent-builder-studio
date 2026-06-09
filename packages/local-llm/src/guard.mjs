// Local-service URL guard — folded in from chief-of-staff's
// src/core/policy/path-policy.mjs#assertLocalServiceUrl. Enforces that local-lane
// providers (mlx, ollama) only ever reach localhost. This is the local-first
// safety boundary: a misconfigured LOCAL_MLX_URL / OLLAMA_BASE_URL pointing at a
// remote host is blocked, not silently dialed.

export function assertLocalServiceUrl(rawUrl) {
  const url = new URL(rawUrl);
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!["http:", "https:"].includes(url.protocol) || !allowedHosts.has(url.hostname)) {
    throw new Error(`blocked non-local network access: ${rawUrl}`);
  }
  return url;
}

/** Non-throwing variant: returns true if the URL is a permitted local URL. */
export function isLocalServiceUrl(rawUrl) {
  try {
    assertLocalServiceUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
