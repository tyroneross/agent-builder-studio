const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function configuredModels() {
  const raw = process.env.CLOUD_LLM_MODELS || process.env.CLOUD_LLM_MODEL || process.env.OPENAI_MODEL || "";
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cloudApiKey() {
  return process.env.CLOUD_LLM_API_KEY || process.env.OPENAI_API_KEY || "";
}

function cloudBaseUrl() {
  if (process.env.CLOUD_LLM_BASE_URL) return process.env.CLOUD_LLM_BASE_URL;
  if (process.env.OPENAI_API_KEY || process.env.CLOUD_LLM_PROVIDER === "openai") return DEFAULT_OPENAI_BASE_URL;
  return "";
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

export function cloudProviderLabel() {
  return process.env.CLOUD_LLM_PROVIDER_LABEL || "Cloud LLM";
}

export function cloudProviderConfigured() {
  return Boolean(cloudApiKey() && cloudBaseUrl() && configuredModels().length);
}

export async function listCloudModels() {
  const models = configuredModels().map((name) => ({
    name,
    source: "configured",
  }));
  const missing = [];
  if (!cloudApiKey()) missing.push("CLOUD_LLM_API_KEY or OPENAI_API_KEY");
  if (!cloudBaseUrl()) missing.push("CLOUD_LLM_BASE_URL");
  if (!models.length) missing.push("CLOUD_LLM_MODEL, CLOUD_LLM_MODELS, or OPENAI_MODEL");
  return {
    models,
    error: missing.length ? `cloud provider disabled: set ${missing.join(", ")}` : null,
  };
}

export function recommendCloudModel(models) {
  return models[0]?.name || "";
}

export async function chatJson({ model, system, user, timeoutMs = 180000 }) {
  const apiKey = cloudApiKey();
  const baseUrl = normalizeBaseUrl(cloudBaseUrl());
  if (!apiKey) throw new Error("cloud provider missing API key");
  if (!baseUrl) throw new Error("cloud provider missing base URL");
  if (!model) throw new Error("cloud provider missing model");

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`cloud llm ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  try {
    return { parsed: JSON.parse(content), raw: content };
  } catch {
    throw new Error("cloud model did not return valid JSON");
  }
}
