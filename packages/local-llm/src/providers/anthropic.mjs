// Anthropic provider — /v1/messages with prefilled-`{` JSON-output pattern.
//
// Why prefill, not tool-use:
//   - Tool-use forces a 2-call dance (tool_use response, then we'd have to
//     synthesize a tool result). Prefill is one round-trip and cheaper.
//   - The runner already has a parse-retry pass that catches malformed JSON.
//     Prefill + parse-retry is enough; tool-use's strict-output guarantee
//     would be redundant here.
//
// Prompt caching:
//   - Callers may pass `system` as either a plain string or an array of
//     blocks of shape { type: "text", text, cache_control?: {type:"ephemeral"} }.
//     The runner builds the array form so static parts (HARD_RULES + team
//     brief) get `cache_control: ephemeral` and per-node varying parts (role
//     line + skill) do not. Anthropic's 5-minute ephemeral window handles
//     server-side TTL automatically.

import { FAILURE_REASONS } from "../failure-reasons.mjs";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export async function chat({
  model,
  system,
  messages,
  timeoutMs = 60000,
  apiKey = process.env.ANTHROPIC_API_KEY,
  maxTokens = 4096,
} = {}) {
  if (!apiKey) {
    return {
      ok: false,
      error: "anthropic: ANTHROPIC_API_KEY is not set",
      retryable: false,
      provider: "anthropic",
      model: model ?? null,
      reason: FAILURE_REASONS.MISSING_KEY,
    };
  }
  if (!model) {
    return {
      ok: false,
      error: "anthropic: model is required",
      retryable: false,
      provider: "anthropic",
      model: null,
      reason: FAILURE_REASONS.UNKNOWN,
    };
  }

  // Normalize system into the blocks form Anthropic expects.
  let systemBlocks = null;
  if (Array.isArray(system)) {
    systemBlocks = system;
  } else if (typeof system === "string" && system.length > 0) {
    systemBlocks = [{ type: "text", text: system }];
  }

  // Map our generic messages onto Anthropic's. We DROP "system" roles since
  // those should already have been hoisted into systemBlocks above. We ADD
  // a final assistant turn prefilled with `{` so the model continues with
  // the JSON body.
  const userMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));
  const withPrefill = [...userMessages, { role: "assistant", content: "{" }];

  const body = {
    model,
    max_tokens: maxTokens,
    temperature: 0.1,
    ...(systemBlocks ? { system: systemBlocks } : {}),
    messages: withPrefill,
  };

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return {
      ok: false,
      error: `anthropic fetch failed: ${err.message}`,
      retryable: true,
      provider: "anthropic",
      model,
      reason: err.name === "TimeoutError" ? FAILURE_REASONS.TIMEOUT : FAILURE_REASONS.HTTP,
    };
  }

  let raw;
  try { raw = await res.json(); } catch {
    return {
      ok: false,
      error: `anthropic ${res.status}: non-JSON response`,
      retryable: res.status >= 500,
      provider: "anthropic",
      model,
      reason: FAILURE_REASONS.HTTP,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      error: `anthropic ${res.status}: ${raw?.error?.message ?? JSON.stringify(raw).slice(0, 500)}`,
      retryable: res.status >= 500 || res.status === 408 || res.status === 429,
      provider: "anthropic",
      model,
      reason: FAILURE_REASONS.HTTP,
    };
  }

  // Concatenate text content blocks. Anthropic returns:
  //   { content: [{type:"text", text:"..."}, ...], usage: {...} }
  const continuation = (raw?.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  // The prefilled "{" is NOT included in the response, so we prepend it.
  const text = `{${continuation}`;
  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}

  return {
    ok: true,
    text,
    parsed,
    raw,
    tokens_in: raw?.usage?.input_tokens ?? null,
    tokens_out: raw?.usage?.output_tokens ?? null,
    cache_read_tokens: raw?.usage?.cache_read_input_tokens ?? null,
    cache_write_tokens: raw?.usage?.cache_creation_input_tokens ?? null,
    provider: "anthropic",
    model,
  };
}
