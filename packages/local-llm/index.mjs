// @tyroneross/local-llm — the single local-first LLM client for the agent-platform
// monorepo. MLX-first local lane, Ollama fallback, key-gated cloud escalation.
//
// Replaces three duplicated clients:
//   - agent-builder/lib/providers/* + cos-config.mjs + cos-runner.mjs cascade core
//   - agent-studio/app/lib/agent-runtime.mjs inline Ollama client
//   - chief-of-staff/src/integrations/model-providers/ollama/client.mjs
//
// Local-first posture preserved: allowCloud defaults to "on-failure", cloud lanes
// are dropped silently when their API key is absent, and the mlx/ollama local
// lanes are dropped when their server is unhealthy (the local-lane equivalent of
// cloud key-gating).

// Providers + uniform chat() envelope
export {
  chat,
  setChatImpl,
  PROVIDER_NAMES,
  LOCAL_PROVIDERS,
  ollamaTags,
  ollamaPs,
} from "./src/providers/index.mjs";

// MLX provider specifics (default endpoint for callers that probe directly)
export { DEFAULT_MLX_URL } from "./src/providers/mlx.mjs";

// Local-service guard (folded in from chief-of-staff)
export { assertLocalServiceUrl, isLocalServiceUrl } from "./src/guard.mjs";

// Health probes (lane eligibility for local backends)
export { probeMlx, probeOllama, LOCAL_HEALTH_PROBES } from "./src/health.mjs";

// Tier routing + cascade resolution (MLX-first)
export {
  TIERS,
  NODE_ROUTING,
  TIER_LOCAL_MODELS,
  cascadePolicy,
  resolveCascade,
  localLanesForTier,
  nodeKeyForTier,
} from "./src/tiers.mjs";

// Generic cascade executor (domain-free; inject telemetry/events)
export { runCascade, tryStep } from "./src/cascade.mjs";

// Failure taxonomy
export { FAILURE_REASONS } from "./src/failure-reasons.mjs";
