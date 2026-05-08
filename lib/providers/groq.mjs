// Groq provider — OpenAI-compatible Chat Completions at api.groq.com.
//
// JSON-mode shape: response_format = { type: "json_object" }. Groq does NOT
// support strict JSON-schema mode, so the runner enforces structure via the
// prompt + a parse-retry pass. Non-streaming for simplicity (Groq is fast
// enough that streaming isn't needed for correctness).

import { FAILURE_REASONS } from "../cos-config.mjs";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

export async function chat({
  model,
  system,
  messages,
  timeoutMs = 60000,
  apiKey = process.env.GROQ_API_KEY,
} = {}) {
  if (!apiKey) {
    return {
      ok: false,
      error: "groq: GROQ_API_KEY is not set",
      retryable: false,
      provider: "groq",
      model: model ?? null,
      reason: FAILURE_REASONS.MISSING_KEY,
    };
  }
  if (!model) {
    return {
      ok: false,
      error: "groq: model is required",
      retryable: false,
      provider: "groq",
      model: null,
      reason: FAILURE_REASONS.UNKNOWN,
    };
  }

  // Accept system as string or as Anthropic-style blocks; concatenate.
  let systemText = "";
  if (Array.isArray(system)) {
    systemText = system.map((b) => b?.text ?? "").filter(Boolean).join("\n\n");
  } else if (typeof system === "string") {
    systemText = system;
  }

  const body = {
    model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      ...(systemText ? [{ role: "system", content: systemText }] : []),
      ...messages,
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
      error: `groq fetch failed: ${err.message}`,
      retryable: true,
      provider: "groq",
      model,
      reason: err.name === "TimeoutError" ? FAILURE_REASONS.TIMEOUT : FAILURE_REASONS.HTTP,
    };
  }

  let raw;
  try { raw = await res.json(); } catch {
    return {
      ok: false,
      error: `groq ${res.status}: non-JSON response`,
      retryable: res.status >= 500,
      provider: "groq",
      model,
      reason: FAILURE_REASONS.HTTP,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `groq ${res.status}: ${raw?.error?.message ?? JSON.stringify(raw).slice(0, 500)}`,
      retryable: res.status >= 500 || res.status === 408 || res.status === 429,
      provider: "groq",
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
    provider: "groq",
    model,
  };
}
