// Per-node tier routing + cascade policy resolver. MLX-FIRST local lane.
//
// Extracted from agent-builder/lib/cos-config.mjs and extended per the
// MLX-first amendment:
//   - Local lane is now TWO backends per tier: mlx (primary) and ollama (fallback),
//     each with its OWN model id (MLX uses HuggingFace mlx-community ids; Ollama
//     uses ollama tags — they are not interchangeable).
//   - Cascade lane order: local-mlx -> local-ollama -> cloud lanes (key-gated).
//   - The mlx lane is dropped (like a missing-key cloud lane) when the MLX server
//     is not healthy — see resolveCascade(..., localHealth).
//
// Tiers:
//   parse     - small/fast structural extraction
//   mid       - 8B-class chat with reasonable instruction following
//   synthesis - the strongest local model that fits the task
//
// Model-id verification (this session, vs HuggingFace + live Ollama):
//   ✅ mlx-community/Llama-3.2-3B-Instruct-4bit  (24k downloads, real)
//   ✅ mlx-community/Qwen2.5-3B-Instruct-4bit    (16k downloads, real)
//   ✅ ollama: llama3.2:3b, qwen3:8b-q4_K_M, gemma4:26b present locally
//   The synthesis-tier MLX model is left CONFIGURABLE (128GB unified memory has
//   headroom for much larger local synthesis models); a large default id is
//   TAG:UNVERIFIED, so it defaults to the verified Qwen2.5-3B and is overridable
//   via env LOCAL_MLX_SYNTHESIS_MODEL. Cloud synthesis stays Sonnet/Groq-70b.

import { FAILURE_REASONS } from "./failure-reasons.mjs";

export const TIERS = Object.freeze({
  parse: "parse",
  mid: "mid",
  synthesis: "synthesis",
});

// ── Cloud-tier model IDs (unchanged from cos-config) ──────────────────────────
const ANTHROPIC_PARSE = process.env.COS_ANTHROPIC_PARSE_MODEL ?? "claude-haiku-4-5-20251001";
const ANTHROPIC_SYNTHESIS = process.env.COS_ANTHROPIC_SYNTHESIS_MODEL ?? "claude-sonnet-4-6";
const OPENAI_PARSE = process.env.COS_OPENAI_PARSE_MODEL ?? "gpt-5-mini";
const OPENAI_SYNTHESIS = process.env.COS_OPENAI_SYNTHESIS_MODEL ?? "gpt-5";

// ── Per-backend local model ids (the MLX-first amendment) ─────────────────────
// MLX ids (HuggingFace mlx-community). Synthesis is configurable (128GB headroom).
const MLX_PARSE = process.env.LOCAL_MLX_PARSE_MODEL ?? "mlx-community/Llama-3.2-3B-Instruct-4bit";
const MLX_MID = process.env.LOCAL_MLX_MID_MODEL ?? "mlx-community/Qwen2.5-3B-Instruct-4bit";
// TAG:UNVERIFIED for any larger synthesis MLX id — default to the verified
// Qwen2.5-3B; override with a larger model when one is pulled.
const MLX_SYNTHESIS = process.env.LOCAL_MLX_SYNTHESIS_MODEL ?? "mlx-community/Qwen2.5-3B-Instruct-4bit";

// Per-tier model map: each tier names an mlx id and an ollama id (+ollama fallback).
export const TIER_LOCAL_MODELS = Object.freeze({
  parse: {
    mlx: MLX_PARSE,
    ollama: "llama3.2:3b",
    ollamaFallback: "qwen3:8b-q4_K_M",
  },
  mid: {
    mlx: MLX_MID,
    ollama: "qwen3:8b-q4_K_M",
    ollamaFallback: "llama3.2:3b",
  },
  synthesis: {
    mlx: MLX_SYNTHESIS,
    ollama: "gemma4:26b",
    ollamaFallback: "qwen3:8b-q4_K_M",
  },
});

// Per-node routing: tier + cloud lanes. Local lanes are derived from
// TIER_LOCAL_MODELS by tier so the mlx/ollama ids stay in one place.
export const NODE_ROUTING = Object.freeze({
  intake: {
    tier: TIERS.parse,
    cloud: { provider: "groq", model: "llama-3.1-8b-instant" },
    cloudSecondary: { provider: "anthropic", model: ANTHROPIC_PARSE },
    cloudTertiary: { provider: "openai", model: OPENAI_PARSE },
  },
  triage: {
    tier: TIERS.synthesis,
    cloud: { provider: "groq", model: "llama-3.3-70b-versatile" },
    cloudSecondary: { provider: "anthropic", model: ANTHROPIC_SYNTHESIS },
    cloudTertiary: { provider: "openai", model: OPENAI_SYNTHESIS },
  },
  time_block_plan: {
    tier: TIERS.synthesis,
    cloud: { provider: "groq", model: "llama-3.3-70b-versatile" },
    cloudSecondary: { provider: "anthropic", model: ANTHROPIC_SYNTHESIS },
    cloudTertiary: { provider: "openai", model: OPENAI_SYNTHESIS },
  },
  decision_log: {
    tier: TIERS.mid,
    cloud: { provider: "groq", model: "llama-3.1-8b-instant" },
    cloudSecondary: { provider: "anthropic", model: ANTHROPIC_PARSE },
    cloudTertiary: { provider: "openai", model: OPENAI_PARSE },
  },
  follow_up_plan: {
    tier: TIERS.mid,
    cloud: { provider: "groq", model: "llama-3.1-8b-instant" },
    cloudSecondary: { provider: "anthropic", model: ANTHROPIC_PARSE },
    cloudTertiary: { provider: "openai", model: OPENAI_PARSE },
  },
  operating_risks: {
    tier: TIERS.synthesis,
    cloud: { provider: "groq", model: "llama-3.3-70b-versatile" },
    cloudSecondary: { provider: "anthropic", model: ANTHROPIC_SYNTHESIS },
    cloudTertiary: { provider: "openai", model: OPENAI_SYNTHESIS },
  },
  // Chief-of-Staff daily-plan ritual: one mid-tier instruction-following call
  // over a schedule. Same cloud lanes as the COS mid nodes so the local-first
  // cascade (MLX -> Ollama -> key-gated cloud) applies uniformly.
  daily_plan: {
    tier: TIERS.mid,
    cloud: { provider: "groq", model: "llama-3.1-8b-instant" },
    cloudSecondary: { provider: "anthropic", model: ANTHROPIC_PARSE },
    cloudTertiary: { provider: "openai", model: OPENAI_PARSE },
  },
});

const VALID_ALLOW_CLOUD = new Set(["never", "on-failure", "always"]);

export function cascadePolicy(opts = {}) {
  const envAllow = process.env.COS_ALLOW_CLOUD;
  const allowRaw = opts.allowCloud ?? envAllow ?? "on-failure";
  const allowCloud = VALID_ALLOW_CLOUD.has(allowRaw) ? allowRaw : "on-failure";

  let maxCloudTokens;
  if (typeof opts.maxCloudTokens === "number") {
    maxCloudTokens = opts.maxCloudTokens;
  } else if (process.env.COS_MAX_CLOUD_TOKENS != null) {
    const n = Number(process.env.COS_MAX_CLOUD_TOKENS);
    maxCloudTokens = Number.isFinite(n) ? n : NaN;
  } else {
    maxCloudTokens = allowCloud === "never" ? 0 : 200000;
  }
  if (!Number.isFinite(maxCloudTokens)) maxCloudTokens = 200000;
  if (allowCloud === "never") maxCloudTokens = 0;

  return { allowCloud, maxCloudTokens };
}

export function nodeKeyForTier(tier) {
  for (const [k, v] of Object.entries(NODE_ROUTING)) {
    if (v.tier === tier) return k;
  }
  return null;
}

// Map provider → env var that must be set for a CLOUD lane to be eligible.
const PROVIDER_KEY_ENV = {
  groq: "GROQ_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

function cloudLaneEligible(step, env = process.env) {
  const keyVar = PROVIDER_KEY_ENV[step.provider];
  if (!keyVar) return true; // unknown cloud provider — let the runner discover it
  return Boolean(env[keyVar]);
}

/**
 * Build the local lanes for a tier: [mlx-primary, ollama-fallback,
 * ollama-secondary-fallback]. The mlx lane is DROPPED when `localHealth.mlx`
 * is explicitly false — the local-lane mirror of cloud key-gating.
 *
 * @param {string} tier
 * @param {{mlx?: boolean, ollama?: boolean}} localHealth  health flags; undefined = include (optimistic)
 */
export function localLanesForTier(tier, localHealth = {}) {
  const m = TIER_LOCAL_MODELS[tier];
  if (!m) throw new Error(`tiers: unknown tier "${tier}"`);
  const lanes = [];
  // MLX is the local PRIMARY. Drop only when health is explicitly false.
  if (localHealth.mlx !== false) {
    lanes.push({ provider: "mlx", model: m.mlx, lane: "local-mlx" });
  }
  // Ollama is the local FALLBACK. Drop only when health is explicitly false.
  if (localHealth.ollama !== false) {
    lanes.push({ provider: "ollama", model: m.ollama, lane: "local-ollama" });
    if (m.ollamaFallback) {
      lanes.push({ provider: "ollama", model: m.ollamaFallback, lane: "local-ollama-fallback" });
    }
  }
  return lanes;
}

/**
 * Build the ordered cascade for a single node.
 *
 *   allowCloud=never       -> [local-mlx, local-ollama, ...]
 *   allowCloud=on-failure  -> [local..., cloud (key-gated)]
 *   allowCloud=always      -> [cloud (key-gated), local...]
 *
 * Local lanes whose health flag is explicitly false are dropped (mlx-first then
 * ollama). Cloud lanes whose API key is missing are dropped silently. A
 * `userOverride` collapses everything to a single local step.
 *
 * @param {string} nodeKey
 * @param {{allowCloud:string}} policy
 * @param {{provider?:string, model?:string}|null} userOverride
 * @param {NodeJS.ProcessEnv} env
 * @param {{mlx?:boolean, ollama?:boolean}} localHealth
 */
export function resolveCascade(nodeKey, policy, userOverride = null, env = process.env, localHealth = {}) {
  if (userOverride) {
    return [
      {
        provider: userOverride.provider ?? "ollama",
        model: userOverride.model,
        lane: "user-override",
      },
    ];
  }
  const route = NODE_ROUTING[nodeKey];
  if (!route) {
    throw new Error(`tiers: unknown node "${nodeKey}"`);
  }
  const local = localLanesForTier(route.tier, localHealth);

  const cloudLanes = [];
  if (route.cloud) cloudLanes.push({ ...route.cloud, lane: "cloud" });
  if (route.cloudSecondary) cloudLanes.push({ ...route.cloudSecondary, lane: "cloud-secondary" });
  if (route.cloudTertiary) cloudLanes.push({ ...route.cloudTertiary, lane: "cloud-tertiary" });
  const cloud = cloudLanes.filter((s) => cloudLaneEligible(s, env));

  if (policy.allowCloud === "always") return [...cloud, ...local];
  if (policy.allowCloud === "on-failure") return [...local, ...cloud];
  return local; // never
}

export { FAILURE_REASONS };
