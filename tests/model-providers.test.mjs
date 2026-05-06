import test from "node:test";
import assert from "node:assert/strict";
import {
  chatJson,
  cloudProviderConfigured,
  listCloudModels,
  recommendCloudModel,
} from "../src/integrations/model-providers/openai-compatible/client.mjs";
import { listModelProviders } from "../src/integrations/model-providers/registry.mjs";

async function withEnv(values, fn) {
  const keys = ["CLOUD_LLM_API_KEY", "CLOUD_LLM_BASE_URL", "CLOUD_LLM_MODEL", "CLOUD_LLM_MODELS", "OPENAI_API_KEY", "OPENAI_MODEL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);
  try {
    return await fn();
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("cloud provider is disabled until API, base URL, and model are configured", async () => {
  await withEnv({}, async () => {
    assert.equal(cloudProviderConfigured(), false);
    const result = await listCloudModels();
    assert.deepEqual(result.models, []);
    assert.match(result.error, /cloud provider disabled/);
  });
});

test("cloud provider lists configured models without a network call", async () => {
  await withEnv({
    CLOUD_LLM_API_KEY: "test-key",
    CLOUD_LLM_BASE_URL: "https://example.test/v1",
    CLOUD_LLM_MODELS: "model-a, model-b",
  }, async () => {
    assert.equal(cloudProviderConfigured(), true);
    const result = await listCloudModels();
    assert.deepEqual(result.models.map((model) => model.name), ["model-a", "model-b"]);
    assert.equal(recommendCloudModel(result.models), "model-a");
    assert.equal(result.error, null);
  });
});

test("cloud provider sends OpenAI-compatible JSON chat requests", async () => {
  const originalFetch = globalThis.fetch;
  await withEnv({
    CLOUD_LLM_API_KEY: "test-key",
    CLOUD_LLM_BASE_URL: "https://example.test/v1/",
    CLOUD_LLM_MODEL: "model-a",
  }, async () => {
    let captured;
    globalThis.fetch = async (url, options) => {
      captured = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        choices: [{ message: { content: "{\"summary\":\"ok\"}" } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    try {
      const result = await chatJson({ model: "model-a", system: "Return JSON.", user: "hello" });
      assert.equal(result.parsed.summary, "ok");
      assert.equal(captured.url, "https://example.test/v1/chat/completions");
      assert.equal(captured.options.headers.authorization, "Bearer test-key");
      assert.equal(captured.body.model, "model-a");
      assert.deepEqual(captured.body.response_format, { type: "json_object" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("model provider registry exposes local and cloud providers", () => {
  const providers = listModelProviders();
  assert.deepEqual(providers.map((provider) => provider.id), ["ollama", "cloud"]);
  assert.equal(providers.find((provider) => provider.id === "ollama").network, "localhost-only");
  assert.equal(providers.find((provider) => provider.id === "cloud").permission, "internet-approved");
});
