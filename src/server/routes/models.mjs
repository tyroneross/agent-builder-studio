import { getModelProvider, listModelProviders } from "../../integrations/model-providers/registry.mjs";
import { sendJson } from "../http.mjs";

async function providerPayload(providerMeta) {
  const provider = getModelProvider(providerMeta.id);
  const result = await provider.listModels();
  return {
    ...providerMeta,
    ...result,
    recommended: provider.recommendModel(result.models),
  };
}

export async function modelsRoute(_req, res, url) {
  const requestedProvider = url.searchParams.get("provider");
  const providers = listModelProviders();
  if (requestedProvider) {
    const providerMeta = providers.find((provider) => provider.id === requestedProvider);
    if (!providerMeta) {
      sendJson(res, 404, { ok: false, error: `unknown model provider: ${requestedProvider}` });
      return;
    }
    sendJson(res, 200, await providerPayload(providerMeta));
    return;
  }

  const enrichedProviders = await Promise.all(providers.map(providerPayload));
  const models = enrichedProviders.flatMap((provider) =>
    provider.models.map((model) => ({
      ...model,
      provider: provider.id,
      providerLabel: provider.label,
      network: provider.network,
      permission: provider.permission,
    })),
  );
  sendJson(res, 200, { providers: enrichedProviders, models });
}
