import { assertLocalServiceUrl } from "../../../core/policy/path-policy.mjs";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || "http://localhost:11434";

async function fetchLocal(path, options = {}) {
  const url = new URL(path, OLLAMA_BASE).toString();
  assertLocalServiceUrl(url);
  return fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(options.timeoutMs || 15000),
  });
}

export async function listOllamaModels() {
  try {
    const res = await fetchLocal("/api/tags", { timeoutMs: 4000 });
    if (!res.ok) return { models: [], error: `ollama ${res.status}` };
    const data = await res.json();
    return {
      models: (data.models || []).map((model) => ({
        name: model.name,
        sizeGB: model.size ? Math.round((model.size / 1e9) * 10) / 10 : null,
        family: model.details?.family || null,
      })),
      error: null,
    };
  } catch (err) {
    return { models: [], error: err.message };
  }
}

export function recommendModel(models) {
  const names = models.map((model) => model.name);
  const preferred = [
    "qwen3:8b-q4_K_M",
    "llama3.2:3b",
    "gpt-oss:20b",
    "qwen2.5-coder:32b-instruct-q5_K_M",
  ];
  return preferred.find((name) => names.includes(name)) || names[0] || "";
}

export async function chatJson({ model, system, user, timeoutMs = 180000 }) {
  const res = await fetchLocal("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    timeoutMs,
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      options: { temperature: 0.1, num_ctx: 8192 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const content = data.message?.content || "";
  try {
    return { parsed: JSON.parse(content), raw: content };
  } catch {
    throw new Error("model did not return valid JSON");
  }
}
