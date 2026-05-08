// Per-node tier routing + cascade policy resolver for the Chief of Staff runner.
//
// Tiers (from agent-skills/chief-of-staff/*.skill.md):
//   parse     - small/fast structural extraction
//   mid       - 8B-class chat with reasonable instruction following
//   synthesis - the strongest local model that fits the task
//
// Routing default per node is a 3-tuple (local primary, local fallback, cloud)
// drawn from the user-locked table in the build packet. Local primary is the
// HEAD of the cascade; local fallback is consulted before cloud; cloud is
// only consulted if `allowCloud` permits it.

export const TIERS = Object.freeze({
  parse: "parse",
  mid: "mid",
  synthesis: "synthesis",
});

// Cloud-tier model IDs. TAG:UNVERIFIED — these match the user's spec in the
// build packet; if Anthropic/OpenAI rotate IDs, override via env or cascade
// will skip the lane on a 404 and continue to the next provider.
const ANTHROPIC_PARSE = process.env.COS_ANTHROPIC_PARSE_MODEL ?? "claude-haiku-4-5-20251001";
const ANTHROPIC_SYNTHESIS = process.env.COS_ANTHROPIC_SYNTHESIS_MODEL ?? "claude-sonnet-4-6";
const OPENAI_PARSE = process.env.COS_OPENAI_PARSE_MODEL ?? "gpt-5-mini";
const OPENAI_SYNTHESIS = process.env.COS_OPENAI_SYNTHESIS_MODEL ?? "gpt-5";

export const NODE_ROUTING = Object.freeze({
  intake: {
    tier: TIERS.parse,
    localPrimary: { provider: "ollama", model: "qwen3:8b-q4_K_M" },
    localFallback: { provider: "ollama", model: "llama3.2:3b" },
    cloud: { provider: "groq", model: "llama-3.1-8b-instant" },
    cloudSecondary: { provider: "anthropic", model: ANTHROPIC_PARSE },
    cloudTertiary: { provider: "openai", model: OPENAI_PARSE },
  },
  triage: {
    tier: TIERS.synthesis,
    localPrimary: { provider: "ollama", model: "gemma4:26b" },
    localFallback: { provider: "ollama", model: "qwen3:8b-q4_K_M" },
    cloud: { provider: "groq", model: "llama-3.3-70b-versatile" },
    cloudSecondary: { provider: "anthropic", model: ANTHROPIC_SYNTHESIS },
    cloudTertiary: { provider: "openai", model: OPENAI_SYNTHESIS },
  },
  time_block_plan: {
    tier: TIERS.synthesis,
    localPrimary: { provider: "ollama", model: "gemma4:26b" },
    localFallback: { provider: "ollama", model: "qwen3:8b-q4_K_M" },
    cloud: { provider: "groq", model: "llama-3.3-70b-versatile" },
    cloudSecondary: { provider: "anthropic", model: ANTHROPIC_SYNTHESIS },
    cloudTertiary: { provider: "openai", model: OPENAI_SYNTHESIS },
  },
  decision_log: {
    tier: TIERS.mid,
    localPrimary: { provider: "ollama", model: "qwen3:8b-q4_K_M" },
    localFallback: { provider: "ollama", model: "llama3.2:3b" },
    cloud: { provider: "groq", model: "llama-3.1-8b-instant" },
    cloudSecondary: { provider: "anthropic", model: ANTHROPIC_PARSE },
    cloudTertiary: { provider: "openai", model: OPENAI_PARSE },
  },
  follow_up_plan: {
    tier: TIERS.mid,
    localPrimary: { provider: "ollama", model: "qwen3:8b-q4_K_M" },
    localFallback: { provider: "ollama", model: "llama3.2:3b" },
    cloud: { provider: "groq", model: "llama-3.1-8b-instant" },
    cloudSecondary: { provider: "anthropic", model: ANTHROPIC_PARSE },
    cloudTertiary: { provider: "openai", model: OPENAI_PARSE },
  },
  operating_risks: {
    tier: TIERS.synthesis,
    localPrimary: { provider: "ollama", model: "gemma4:26b" },
    localFallback: { provider: "ollama", model: "qwen3:8b-q4_K_M" },
    cloud: { provider: "groq", model: "llama-3.3-70b-versatile" },
    cloudSecondary: { provider: "anthropic", model: ANTHROPIC_SYNTHESIS },
    cloudTertiary: { provider: "openai", model: OPENAI_SYNTHESIS },
  },
});

const VALID_ALLOW_CLOUD = new Set(["never", "on-failure", "always"]);

/**
 * Resolve the user-facing cascade policy from CLI/env/defaults.
 * Precedence: explicit `opts` > env > default.
 *
 * @param {object} [opts]
 * @param {string} [opts.allowCloud] one of "never" | "on-failure" | "always"
 * @param {number} [opts.maxCloudTokens]
 * @returns {{allowCloud: string, maxCloudTokens: number}}
 */
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

/**
 * Pick a representative node-key whose routing matches the requested tier.
 * Used by per-role tier overrides: a role pinned to "synthesis" makes the
 * runner re-resolve its node's cascade from a synthesis-tier sibling.
 */
export function nodeKeyForTier(tier) {
  for (const [k, v] of Object.entries(NODE_ROUTING)) {
    if (v.tier === tier) return k;
  }
  return null;
}

/** Map of provider → env var that must be set for the lane to be eligible. */
const PROVIDER_KEY_ENV = {
  groq: "GROQ_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

function laneEligible(step, env = process.env) {
  if (step.provider === "ollama") return true;
  const keyVar = PROVIDER_KEY_ENV[step.provider];
  if (!keyVar) return true; // unknown provider — let the runner discover the failure
  return Boolean(env[keyVar]);
}

/**
 * Build the ordered cascade for a single node, given the resolved policy.
 * Returns an array of `{provider, model, lane}` steps to try in order.
 *
 *   allowCloud=never       -> [primary, fallback]
 *   allowCloud=on-failure  -> [primary, fallback, cloud, cloudSecondary, cloudTertiary]
 *   allowCloud=always      -> [cloud, cloudSecondary, cloudTertiary, primary, fallback]
 *
 * Cloud lanes whose API key is missing in the env are dropped silently so the
 * runner skips them rather than racking up missing-key failures.
 *
 * `userOverride` lets the runner force a single-step cascade (e.g. when the
 * caller passed `--model llama3.2:3b`); when set, all routing is collapsed to
 * that single step on the local lane.
 */
export function resolveCascade(nodeKey, policy, userOverride = null, env = process.env) {
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
    throw new Error(`cos-config: unknown node "${nodeKey}"`);
  }
  const local = [
    { ...route.localPrimary, lane: "local-primary" },
    { ...route.localFallback, lane: "local-fallback" },
  ];
  const cloudLanes = [];
  if (route.cloud) cloudLanes.push({ ...route.cloud, lane: "cloud" });
  if (route.cloudSecondary) cloudLanes.push({ ...route.cloudSecondary, lane: "cloud-secondary" });
  if (route.cloudTertiary) cloudLanes.push({ ...route.cloudTertiary, lane: "cloud-tertiary" });
  const cloud = cloudLanes.filter((s) => laneEligible(s, env));

  if (policy.allowCloud === "always") return [...cloud, ...local];
  if (policy.allowCloud === "on-failure") return [...local, ...cloud];
  return local; // never
}

/** Reasons a step is considered a failure that should advance the cascade. */
export const FAILURE_REASONS = Object.freeze({
  HTTP: "http-error",
  TIMEOUT: "timeout",
  STALL: "stream-stall",
  PARSE: "parse-failed",
  PROVIDER_DISABLED: "provider-disabled",
  MISSING_KEY: "missing-api-key",
  UNKNOWN: "unknown",
});
