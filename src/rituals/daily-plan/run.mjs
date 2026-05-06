import { getModelProvider } from "../../integrations/model-providers/registry.mjs";
import { deterministicDailyPlan } from "./fallback.mjs";
import { buildDailyPlanSystemPrompt, buildDailyPlanUserPrompt } from "./prompt.mjs";
import { normalizeDailyPlan } from "./schema.mjs";

export async function generateDailyPlan({ model, useModel, date, goal, notes, scheduleText, provider = "ollama" }) {
  if (useModel && model) {
    try {
      const modelProvider = getModelProvider(provider);
      const out = await modelProvider.chatJson({
        model,
        system: buildDailyPlanSystemPrompt(),
        user: buildDailyPlanUserPrompt({ date, goal, notes, scheduleText }),
      });
      return {
        plan: normalizeDailyPlan(out.parsed, date),
        providerUsed: provider,
        modelUsed: model,
        modelRaw: out.raw,
        fallback: false,
      };
    } catch (err) {
      const plan = deterministicDailyPlan({ date, goal, notes, scheduleText });
      plan.notes.push(`Model fallback: ${err.message}`);
      return { plan, providerUsed: provider, modelUsed: null, modelError: err.message, fallback: true };
    }
  }
  return {
    plan: deterministicDailyPlan({ date, goal, notes, scheduleText }),
    providerUsed: null,
    modelUsed: null,
    fallback: true,
  };
}
