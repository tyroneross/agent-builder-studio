// Ollama provider — local /api/chat with streamed JSON-mode output.
//
// Returns the canonical envelope:
//   success: { ok: true,  text, parsed, raw, tokens_in, tokens_out, provider, model }
//   error:   { ok: false, error, retryable, provider, model, reason }
//
// Stall detection: if no chunk arrives within `stallMs` (default 30s) the
// stream is aborted and an envelope with reason="stream-stall" is returned.

import { FAILURE_REASONS } from "../cos-config.mjs";

const DEFAULT_BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export async function chat({
  model,
  system,
  messages,
  timeoutMs = 900000,
  stallMs = 30000,
  onChunk,
  baseUrl = DEFAULT_BASE,
} = {}) {
  if (!model) {
    return errorEnvelope({
      provider: "ollama",
      model: model ?? null,
      error: "ollama: model is required",
      retryable: false,
      reason: FAILURE_REASONS.UNKNOWN,
    });
  }

  // Accept system as string or as Anthropic-style blocks; concatenate blocks.
  let systemText = "";
  if (Array.isArray(system)) {
    systemText = system.map((b) => b?.text ?? "").filter(Boolean).join("\n\n");
  } else if (typeof system === "string") {
    systemText = system;
  }

  const ctl = new AbortController();
  const overall = setTimeout(() => ctl.abort(new Error("overall timeout")), timeoutMs);
  let stallTimer = null;
  let stalled = false;
  const armStall = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      ctl.abort(new Error("stream stall"));
    }, stallMs);
  };

  let res;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: true,
        format: "json",
        options: { temperature: 0.1, num_ctx: 8192 },
        messages: [
          ...(systemText ? [{ role: "system", content: systemText }] : []),
          ...messages,
        ],
      }),
      signal: ctl.signal,
    });
  } catch (err) {
    clearTimeout(overall);
    clearTimeout(stallTimer);
    return errorEnvelope({
      provider: "ollama",
      model,
      error: `ollama fetch failed: ${err.message}`,
      retryable: true,
      reason: stalled ? FAILURE_REASONS.STALL : FAILURE_REASONS.HTTP,
    });
  }

  if (!res.ok) {
    clearTimeout(overall);
    clearTimeout(stallTimer);
    let body = "";
    try { body = await res.text(); } catch {}
    return errorEnvelope({
      provider: "ollama",
      model,
      error: `ollama ${res.status}: ${body.slice(0, 500)}`,
      retryable: res.status >= 500 || res.status === 408 || res.status === 429,
      reason: FAILURE_REASONS.HTTP,
    });
  }

  armStall();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let last = null;
  let tokensIn = null;
  let tokensOut = null;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      armStall();
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          last = obj;
          if (obj.message?.content) {
            text += obj.message.content;
            onChunk?.(obj.message.content, text.length);
          }
          if (obj.done) {
            tokensIn = obj.prompt_eval_count ?? tokensIn;
            tokensOut = obj.eval_count ?? tokensOut;
          }
        } catch {
          // tolerate partial-line JSON; the next chunk will append.
        }
      }
    }
  } catch (err) {
    clearTimeout(overall);
    clearTimeout(stallTimer);
    return errorEnvelope({
      provider: "ollama",
      model,
      error: `ollama stream aborted: ${err.message}`,
      retryable: true,
      reason: stalled ? FAILURE_REASONS.STALL : FAILURE_REASONS.TIMEOUT,
    });
  }
  clearTimeout(overall);
  clearTimeout(stallTimer);

  let parsed = null;
  try { parsed = JSON.parse(text); } catch {}

  return {
    ok: true,
    text,
    parsed,
    raw: last,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    provider: "ollama",
    model,
  };
}

export async function tags({ baseUrl = DEFAULT_BASE } = {}) {
  try {
    const r = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { models: [] };
    return r.json();
  } catch {
    return { models: [] };
  }
}

/**
 * Currently-loaded models via /api/ps. Used by warmup to skip work when the
 * target model is already resident in VRAM/RAM.
 */
export async function ps({ baseUrl = DEFAULT_BASE } = {}) {
  try {
    const r = await fetch(`${baseUrl}/api/ps`, { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return { models: [] };
    return r.json();
  } catch {
    return { models: [] };
  }
}

function errorEnvelope({ provider, model, error, retryable, reason }) {
  return { ok: false, error, retryable, provider, model, reason };
}
