import { resolveCascade, cascadePolicy, runCascade } from "@tyroneross/local-llm";
import { deterministicDailyPlan } from "./fallback.mjs";
import { buildDailyPlanSystemPrompt, buildDailyPlanUserPrompt } from "./prompt.mjs";
import { normalizeDailyPlan } from "./schema.mjs";

// Goal criterion 4: COS routes its model call through the SHARED cascade engine
// (MLX-first local lane -> Ollama fallback -> key-gated cloud), the same engine
// agent-builder uses. The local-first posture is preserved: cloud lanes only
// join the cascade when `provider === "cloud"` (allowCloud="always") AND their
// API key is present; otherwise the cascade stays local-only.
//
// PRESERVED CONTRACTS:
//   - useModel && model gating (no model call otherwise)
//   - deterministic no-LLM fallback on ANY failure (the catch path)
//   - explicit `model` collapses the cascade to a single user-override step,
//     matching COS's prior single-call chatJson behavior exactly.
export async function generateDailyPlan({ model, useModel, date, goal, notes, scheduleText, provider = "ollama" }) {
  if (useModel && model) {
    try {
      // Local-first: only let cloud lanes in when the caller asked for cloud.
      // Cloud lanes are still key-gated inside resolveCascade.
      const allowCloud = provider === "cloud" ? "always" : "never";
      const policy = cascadePolicy({ allowCloud });
      // The caller named an explicit model — honor it as a single-step override
      // (the local mirror of the prior chatJson single-call), while still using
      // the shared executor's parse-retry + telemetry seam.
      const cascade = resolveCascade("daily_plan", policy, { provider: "ollama", model });

      const { envelope, step } = await runCascade({
        node: { key: "daily_plan" },
        cascade,
        system: buildDailyPlanSystemPrompt(),
        userMsg: buildDailyPlanUserPrompt({ date, goal, notes, scheduleText }),
        timeoutMs: 180000,
      });

      if (!envelope.ok) throw new Error(envelope.error || "model request failed");
      if (envelope.parsed == null) throw new Error("model did not return valid JSON");

      return {
        plan: normalizeDailyPlan(envelope.parsed, date),
        providerUsed: step?.provider ?? provider,
        modelUsed: step?.model ?? model,
        modelRaw: envelope.text,
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
