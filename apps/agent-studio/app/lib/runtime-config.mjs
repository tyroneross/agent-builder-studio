// Pass 15 — runtime tunables that aren't storage-related.
//
// Single source of truth for runtime knobs. The agent-runtime imports the
// constants from here so the values are visible in one place; future
// settings UI can tweak them without touching the runtime module.
//
// Storage-related limits live in `storage-config.mjs` and are policed by
// `scripts/test-no-hardcoded-storage.mjs`. The two configs are separate
// because they serve different audiences: storage-config is user-tunable
// (visible in the storage panel); runtime-config is operator-tunable
// (developer-only for now).

export const DEFAULT_RUNTIME_CONFIG = Object.freeze({
  // Maximum nodes executed in parallel within a DAG level. Lifted out of
  // agent-runtime.mjs in Pass 15 so the value is visible alongside other
  // runtime knobs and a future settings UI can override it.
  perLevelParallelism: 4,

  // Pass 16 — cap on inferred-edge LLM calls per chain run. The current
  // value is the design-doc default ("Cap at one inference per run"). When
  // exceeded, the runtime falls back to parallel execution and emits a
  // warning instead of making another inference call.
  inferenceCallsPerRun: 1,

  // Pass 18 — maximum sub-agent nesting depth. A subagent at depth N can
  // call subagents up to depth N+1; once depth reaches this cap, further
  // nesting is rejected with a clear error event before any LLM call.
  // Default 3: parent → child → grandchild → great-grandchild blocked.
  subagentMaxDepth: 3,
});

// Read-only accessor. Lives here so the agent-runtime + the inference
// caller share one entry point and a future settings UI can intercept.
export function getRuntimeConfig() {
  return { ...DEFAULT_RUNTIME_CONFIG };
}
