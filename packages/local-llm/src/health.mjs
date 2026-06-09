// Local-lane health probes. Used by the cascade to drop a local lane that isn't
// running — the local-lane equivalent of the cloud lane's key-gating
// (laneEligible). MLX-first means: if the MLX server isn't up, the cascade skips
// the mlx lane and proceeds to ollama, exactly as a missing cloud key drops a
// cloud lane.

import { assertLocalServiceUrl } from "./guard.mjs";
import { DEFAULT_MLX_URL } from "./providers/mlx.mjs";

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

/**
 * Probe mlx_lm.server's /health endpoint.
 * @returns {Promise<{healthy: boolean, url: string, error: string|null}>}
 */
export async function probeMlx({ baseUrl, timeoutMs = 1500 } = {}) {
  const raw = baseUrl || process.env.LOCAL_MLX_URL || DEFAULT_MLX_URL;
  let url;
  try {
    url = `${assertLocalServiceUrl(raw).origin}/health`;
  } catch (err) {
    return { healthy: false, url: raw, error: err.message };
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { healthy: res.ok, url, error: res.ok ? null : `mlx /health ${res.status}` };
  } catch (err) {
    return { healthy: false, url, error: err.message };
  }
}

/**
 * Probe Ollama's /api/tags endpoint.
 * @returns {Promise<{healthy: boolean, url: string, error: string|null}>}
 */
export async function probeOllama({ baseUrl, timeoutMs = 1500 } = {}) {
  const raw = baseUrl || process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL;
  let url;
  try {
    url = `${assertLocalServiceUrl(raw).origin}/api/tags`;
  } catch (err) {
    return { healthy: false, url: raw, error: err.message };
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return { healthy: res.ok, url, error: res.ok ? null : `ollama /api/tags ${res.status}` };
  } catch (err) {
    return { healthy: false, url, error: err.message };
  }
}

/** Map a local provider name to its health probe. */
export const LOCAL_HEALTH_PROBES = Object.freeze({
  mlx: probeMlx,
  ollama: probeOllama,
});
