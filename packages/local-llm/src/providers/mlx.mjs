// MLX provider — local mlx_lm.server (OpenAI-compatible) /v1/chat/completions.
//
// mlx_lm.server exposes the OpenAI wire format on a local port (default 8080,
// host 127.0.0.1; verified against mlx-lm 0.31.3 server.py which routes
// /v1/chat/completions, /v1/completions, /v1/models, /health). This provider is
// the LOCAL-PRIMARY lane in the cascade: MLX-first, with Ollama as fallback.
//
// It reuses the OpenAI request/response shape (response_format json_schema /
// json_object, choices[0].message.content, usage tokens) but:
//   - points at a configurable LOCAL base URL (env LOCAL_MLX_URL / opts.baseUrl)
//   - applies the local-service guard (localhost only) — same posture as ollama
//   - sends NO Authorization header (local server, no key)
// Returns the canonical chat() envelope identical to every other provider.

import { FAILURE_REASONS } from "../failure-reasons.mjs";
import { assertLocalServiceUrl } from "../guard.mjs";

export const DEFAULT_MLX_URL = "http://127.0.0.1:8080";

function resolveBaseUrl(baseUrl) {
  const raw = baseUrl || process.env.LOCAL_MLX_URL || DEFAULT_MLX_URL;
  // Guard: local-lane providers must never reach a remote host.
  assertLocalServiceUrl(raw);
  return raw.replace(/\/+$/, "");
}

export async function chat({
  model,
  system,
  messages,
  jsonSchema, // { type:"object", properties:{...}, required:[...] }
  jsonSchemaName, // optional name (defaults to "node_output")
  timeoutMs = 60000,
  baseUrl, // optional explicit endpoint
} = {}) {
  if (!model) {
    return {
      ok: false,
      error: "mlx: model is required",
      retryable: false,
      provider: "mlx",
      model: null,
      reason: FAILURE_REASONS.UNKNOWN,
    };
  }

  let endpoint;
  try {
    endpoint = `${resolveBaseUrl(baseUrl)}/v1/chat/completions`;
  } catch (err) {
    return {
      ok: false,
      error: `mlx: ${err.message}`,
      retryable: false,
      provider: "mlx",
      model,
      reason: FAILURE_REASONS.UNKNOWN,
    };
  }

  // System may arrive as string or as Anthropic-style blocks; collapse to text.
  let systemText = "";
  if (Array.isArray(system)) {
    systemText = system.map((b) => b?.text ?? "").filter(Boolean).join("\n\n");
  } else if (typeof system === "string") {
    systemText = system;
  }

  // mlx_lm.server supports OpenAI response_format. Strict json_schema when a
  // schema is supplied, else plain json_object. If a given server build ignores
  // response_format, the content still parses as JSON when the model complies;
  // the cascade's parse-retry handles non-compliant output.
  const responseFormat = jsonSchema
    ? {
        type: "json_schema",
        json_schema: { name: jsonSchemaName || "node_output", schema: jsonSchema, strict: true },
      }
    : { type: "json_object" };

  const body = {
    model,
    temperature: 0.1,
    response_format: responseFormat,
    messages: [
      ...(systemText ? [{ role: "system", content: systemText }] : []),
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return {
      ok: false,
      error: `mlx fetch failed: ${err.message}`,
      retryable: true,
      provider: "mlx",
      model,
      reason: err.name === "TimeoutError" ? FAILURE_REASONS.TIMEOUT : FAILURE_REASONS.HTTP,
    };
  }

  let raw;
  try {
    raw = await res.json();
  } catch {
    return {
      ok: false,
      error: `mlx ${res.status}: non-JSON response`,
      retryable: res.status >= 500,
      provider: "mlx",
      model,
      reason: FAILURE_REASONS.HTTP,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `mlx ${res.status}: ${raw?.error?.message ?? JSON.stringify(raw).slice(0, 500)}`,
      retryable: res.status >= 500 || res.status === 408 || res.status === 429,
      provider: "mlx",
      model,
      reason: FAILURE_REASONS.HTTP,
    };
  }

  const text = raw?.choices?.[0]?.message?.content ?? "";
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {}

  return {
    ok: true,
    text,
    parsed,
    raw,
    tokens_in: raw?.usage?.prompt_tokens ?? null,
    tokens_out: raw?.usage?.completion_tokens ?? null,
    provider: "mlx",
    model,
  };
}
