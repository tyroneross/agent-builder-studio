// OpenAI provider — /v1/chat/completions with strict json_schema mode driven
// by the node's existing schema.
//
// JSON-mode shape:
//   response_format: {
//     type: "json_schema",
//     json_schema: { name, schema, strict: true }
//   }
//
// We do NOT duplicate or transform the node schema. Whatever the runner passes
// in `jsonSchema` is forwarded verbatim. Strict mode requires every property
// declared in the schema to be in `required`; if the caller's schema is loose,
// strict will reject it. The runner's parse-retry handles that fallback.

import { FAILURE_REASONS } from "../cos-config.mjs";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

export async function chat({
  model,
  system,
  messages,
  jsonSchema,        // { type:"object", properties:{...}, required:[...] }
  jsonSchemaName,    // optional human-readable name (defaults to "node_output")
  timeoutMs = 60000,
  apiKey = process.env.OPENAI_API_KEY,
} = {}) {
  if (!apiKey) {
    return {
      ok: false,
      error: "openai: OPENAI_API_KEY is not set",
      retryable: false,
      provider: "openai",
      model: model ?? null,
      reason: FAILURE_REASONS.MISSING_KEY,
    };
  }
  if (!model) {
    return {
      ok: false,
      error: "openai: model is required",
      retryable: false,
      provider: "openai",
      model: null,
      reason: FAILURE_REASONS.UNKNOWN,
    };
  }

  // System may arrive as string or as Anthropic-style blocks; OpenAI takes a
  // single string. If blocks were passed, concatenate the text.
  let systemText = "";
  if (Array.isArray(system)) {
    systemText = system.map((b) => b?.text ?? "").filter(Boolean).join("\n\n");
  } else if (typeof system === "string") {
    systemText = system;
  }

  // Choose response_format. Strict json_schema requires a schema; if none
  // provided, fall back to plain json_object mode (works for any node).
  const responseFormat = jsonSchema
    ? {
        type: "json_schema",
        json_schema: {
          name: jsonSchemaName || "node_output",
          schema: jsonSchema,
          strict: true,
        },
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
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return {
      ok: false,
      error: `openai fetch failed: ${err.message}`,
      retryable: true,
      provider: "openai",
      model,
      reason: err.name === "TimeoutError" ? FAILURE_REASONS.TIMEOUT : FAILURE_REASONS.HTTP,
    };
  }

  let raw;
  try { raw = await res.json(); } catch {
    return {
      ok: false,
      error: `openai ${res.status}: non-JSON response`,
      retryable: res.status >= 500,
      provider: "openai",
      model,
      reason: FAILURE_REASONS.HTTP,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `openai ${res.status}: ${raw?.error?.message ?? JSON.stringify(raw).slice(0, 500)}`,
      retryable: res.status >= 500 || res.status === 408 || res.status === 429,
      provider: "openai",
      model,
      reason: FAILURE_REASONS.HTTP,
    };
  }

  const text = raw?.choices?.[0]?.message?.content ?? "";
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}

  return {
    ok: true,
    text,
    parsed,
    raw,
    tokens_in: raw?.usage?.prompt_tokens ?? null,
    tokens_out: raw?.usage?.completion_tokens ?? null,
    provider: "openai",
    model,
  };
}
