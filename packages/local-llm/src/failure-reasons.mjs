// Reasons a cascade step is considered a failure that should advance the cascade.
// Extracted verbatim from agent-builder/lib/cos-config.mjs#FAILURE_REASONS so the
// providers and the cascade executor share one definition.
export const FAILURE_REASONS = Object.freeze({
  HTTP: "http-error",
  TIMEOUT: "timeout",
  STALL: "stream-stall",
  PARSE: "parse-failed",
  PROVIDER_DISABLED: "provider-disabled",
  MISSING_KEY: "missing-api-key",
  HEALTH: "health-check-failed",
  CLOUD_BUDGET: "cloud-budget-exhausted",
  UNKNOWN: "unknown",
});
