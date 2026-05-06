import { chatJson, listOllamaModels, recommendModel } from "./ollama/client.mjs";
import {
  chatJson as chatCloudJson,
  cloudProviderConfigured,
  cloudProviderLabel,
  listCloudModels,
  recommendCloudModel,
} from "./openai-compatible/client.mjs";

export const MODEL_PROVIDERS = {
  ollama: {
    id: "ollama",
    label: "Ollama",
    network: "localhost-only",
    permission: "read-local",
    configured: true,
    listModels: listOllamaModels,
    recommendModel,
    chatJson,
  },
  cloud: {
    id: "cloud",
    label: cloudProviderLabel,
    network: "internet",
    permission: "internet-approved",
    configured: cloudProviderConfigured,
    listModels: listCloudModels,
    recommendModel: recommendCloudModel,
    chatJson: chatCloudJson,
  },
};

export function getModelProvider(id = "ollama") {
  const provider = MODEL_PROVIDERS[id];
  if (!provider) throw new Error(`unknown model provider: ${id}`);
  return provider;
}

export function listModelProviders() {
  return Object.values(MODEL_PROVIDERS).map((provider) => ({
    id: provider.id,
    label: typeof provider.label === "function" ? provider.label() : provider.label,
    network: provider.network,
    permission: provider.permission,
    configured: typeof provider.configured === "function" ? provider.configured() : Boolean(provider.configured),
  }));
}
