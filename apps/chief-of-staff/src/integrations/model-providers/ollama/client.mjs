// Chief of Staff Ollama client — now delegates to the shared
// @tyroneross/local-llm package (one Ollama client across the monorepo). The
// local-service guard is sourced from the package (folded in from this app's
// own assertLocalServiceUrl during the consolidation); the model-listing and
// recommendation helpers stay here (COS-specific preferences).

import { chat, ollamaTags } from "@tyroneross/local-llm";

export async function listOllamaModels() {
  try {
    const { models, error } = await ollamaTags({ timeoutMs: 4000 });
    if (error) return { models: [], error };
    return {
      models: (models || []).map((model) => ({
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

/**
 * Single-call JSON chat via the shared Ollama provider. Preserves COS's prior
 * { parsed, raw } contract and "model did not return valid JSON" error. The
 * provider streams internally; we use the parsed envelope.
 */
export async function chatJson({ model, system, user, timeoutMs = 180000 }) {
  const env = await chat({
    provider: "ollama",
    model,
    system,
    messages: [{ role: "user", content: user }],
    timeoutMs,
  });
  if (!env.ok) throw new Error(env.error || "ollama request failed");
  if (env.parsed == null) throw new Error("model did not return valid JSON");
  return { parsed: env.parsed, raw: env.text };
}
