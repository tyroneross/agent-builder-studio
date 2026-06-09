// Thin re-export shim over @tyroneross/local-llm.
//
// The cascade tier table, policy resolver, and cascade resolution now live in
// the shared package (MLX-first local lane, Ollama fallback, key-gated cloud).
// This shim preserves the historical import path (lib/cos-config.mjs) for this
// app's existing consumers (cos-runner.mjs, API routes, scripts) so the
// consolidation is import-path-compatible.
//
// NOTE: resolveCascade now accepts a 5th arg `localHealth` ({mlx, ollama}) used
// to drop an unhealthy local lane (the local mirror of cloud key-gating). The
// COS runner passes it after probing the local servers.

export {
  TIERS,
  NODE_ROUTING,
  TIER_LOCAL_MODELS,
  cascadePolicy,
  nodeKeyForTier,
  resolveCascade,
  localLanesForTier,
  FAILURE_REASONS,
} from "@tyroneross/local-llm";
