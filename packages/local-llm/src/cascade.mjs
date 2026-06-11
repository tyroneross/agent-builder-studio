// Generic cascade executor — extracted from agent-builder/lib/cos-runner.mjs's
// tryStep + runNodeCascade. Domain-free: telemetry and event emission are
// INJECTED callbacks (default no-ops), so chief-of-staff keeps its JSONL
// telemetry + UI events while the package stays free of COS paths/schemas.
//
// Contract preserved exactly: try each cascade step in order; on a step that
// returns ok=true but parsed=null, fire ONE parse-retry against the same
// provider with a "JSON only" suffix; advance to the next step on any failure;
// return the first ok+parsed envelope, or the last failure envelope.

import { chat as defaultChat } from "./providers/index.mjs";
import { FAILURE_REASONS } from "./failure-reasons.mjs";

const noop = () => {};

/**
 * Create a mutable cloud-token budget shared across runCascade calls in one
 * run. Derived from cascadePolicy's maxCloudTokens — NOT a user-facing
 * setting. `used` accrues tokens_in + tokens_out from every cloud-lane
 * telemetry record; once `used >= maxCloudTokens`, remaining cloud lanes are
 * skipped gracefully (the cascade falls through to whatever local lanes
 * remain) and a `cloud-budget-exhausted` telemetry record is written.
 *
 * @param {{maxCloudTokens?: number}} [policy]  output of cascadePolicy()
 * @returns {{maxCloudTokens: number, used: number}}
 */
export function createCloudBudget(policy = {}) {
  const max = Number.isFinite(policy.maxCloudTokens) ? policy.maxCloudTokens : 0;
  return { maxCloudTokens: max, used: 0 };
}

function isCloudLane(lane) {
  return typeof lane === "string" && lane.startsWith("cloud");
}

function cloudBudgetExhausted(budget) {
  return Boolean(budget) && Number.isFinite(budget.maxCloudTokens) && budget.used >= budget.maxCloudTokens;
}

/**
 * Try one cascade step, with a single parse-retry on malformed-JSON success.
 *
 * @param {object} args
 * @param {{provider:string, model:string, lane:string}} args.step
 * @param {string|Array} args.system
 * @param {string} args.userMsg
 * @param {object} [args.jsonSchema]
 * @param {string} [args.jsonSchemaName]
 * @param {string} [args.role]
 * @param {number} [args.timeoutMs]
 * @param {number} [args.seed]
 * @param {Function} [args.onChunk]
 * @param {Function} [args.recordTelemetry]  ({lane,provider,model,ms,parsed_ok,...}) => void
 * @param {string} [args.nodeKey]
 * @param {number} [args.attempt]
 * @param {Function} [args.chat]  provider dispatcher (default: package chat())
 * @returns {Promise<{envelope:object, parseRetried:boolean}>}
 */
export async function tryStep({
  step,
  system,
  userMsg,
  jsonSchema,
  jsonSchemaName,
  role,
  timeoutMs = 60000,
  seed,
  onChunk,
  recordTelemetry = noop,
  nodeKey,
  attempt = 1,
  chat = defaultChat,
}) {
  const base = { node: nodeKey, role: role ?? null, attempt, lane: step.lane, provider: step.provider, model: step.model };

  const t0 = Date.now();
  const first = await chat({
    provider: step.provider,
    model: step.model,
    system,
    messages: [{ role: "user", content: userMsg }],
    jsonSchema,
    jsonSchemaName,
    timeoutMs,
    seed,
    onChunk,
  });
  const firstMs = Date.now() - t0;

  if (!first.ok) {
    recordTelemetry({ ...base, tokens_in: null, tokens_out: null, ms: firstMs, parsed_ok: false, fallback_reason: first.reason ?? FAILURE_REASONS.UNKNOWN, parse_retry: false, error: first.error });
    return { envelope: first, parseRetried: false };
  }

  if (first.parsed != null) {
    recordTelemetry({ ...base, tokens_in: first.tokens_in ?? null, tokens_out: first.tokens_out ?? null, cache_read_tokens: first.cache_read_tokens ?? null, cache_write_tokens: first.cache_write_tokens ?? null, ms: firstMs, parsed_ok: true, fallback_reason: null, parse_retry: false });
    return { envelope: first, parseRetried: false };
  }

  // Parse-retry: same provider, malformed output + hard "JSON only" suffix.
  recordTelemetry({ ...base, tokens_in: first.tokens_in ?? null, tokens_out: first.tokens_out ?? null, ms: firstMs, parsed_ok: false, fallback_reason: FAILURE_REASONS.PARSE, parse_retry: false });

  const retryMsg = [
    "Your last response was not valid JSON. Return ONLY the JSON object below and nothing else.",
    "",
    "Previous (malformed) output:",
    (first.text ?? "").slice(0, 4000),
    "",
    "Now return strict JSON for this request:",
    "",
    userMsg,
  ].join("\n");

  const t1 = Date.now();
  const second = await chat({
    provider: step.provider,
    model: step.model,
    system,
    messages: [{ role: "user", content: retryMsg }],
    jsonSchema,
    jsonSchemaName,
    timeoutMs,
    seed,
    onChunk,
  });
  const secondMs = Date.now() - t1;

  if (!second.ok) {
    recordTelemetry({ ...base, tokens_in: null, tokens_out: null, ms: secondMs, parsed_ok: false, fallback_reason: second.reason ?? FAILURE_REASONS.UNKNOWN, parse_retry: true, error: second.error });
    return { envelope: second, parseRetried: true };
  }

  recordTelemetry({ ...base, tokens_in: second.tokens_in ?? null, tokens_out: second.tokens_out ?? null, cache_read_tokens: second.cache_read_tokens ?? null, cache_write_tokens: second.cache_write_tokens ?? null, ms: secondMs, parsed_ok: second.parsed != null, fallback_reason: second.parsed == null ? FAILURE_REASONS.PARSE : null, parse_retry: true });
  return { envelope: second, parseRetried: true };
}

/**
 * Run an ordered cascade for a single node. Returns the winning envelope (first
 * ok+parsed) and the step that won, or the last failure envelope and null.
 *
 * @param {object} args
 * @param {{key?:string, role?:string}} [args.node]
 * @param {Array<{provider:string, model:string, lane:string}>} args.cascade
 * @param {Function} [args.onEvent]  (event) => void
 * @param {Function} [args.recordTelemetry]
 * @param {Function} [args.chat]
 * ...plus tryStep args (system, userMsg, jsonSchema, jsonSchemaName, role, timeoutMs)
 * @returns {Promise<{envelope:object, step:object|null}>}
 */
export async function runCascade({
  node = {},
  cascade,
  system,
  userMsg,
  jsonSchema,
  jsonSchemaName,
  role,
  timeoutMs = 60000,
  seed,
  onEvent = noop,
  recordTelemetry = noop,
  chat = defaultChat,
  cloudBudget = null,
}) {
  // Meter cloud spend through the telemetry seam: every record from a cloud
  // lane (including parse-retries) carries tokens_in/tokens_out, so accruing
  // here captures all cloud calls without touching tryStep.
  const meteredTelemetry = !cloudBudget
    ? recordTelemetry
    : (rec) => {
        if (rec && isCloudLane(rec.lane)) {
          cloudBudget.used += (rec.tokens_in ?? 0) + (rec.tokens_out ?? 0);
        }
        recordTelemetry(rec);
      };

  let attempt = 0;
  let lastErr = null;
  for (const step of cascade) {
    attempt += 1;
    const payload = { node: node.key, role: node.role ?? role ?? null, attempt, lane: step.lane, provider: step.provider, model: step.model };

    // Graceful cloud-budget enforcement: skip (never hard-fail) cloud lanes
    // once the cumulative cloud-token budget is spent. Local lanes are never
    // budget-gated, so the cascade degrades to local-only.
    if (cloudBudget && isCloudLane(step.lane) && cloudBudgetExhausted(cloudBudget)) {
      onEvent({ type: "cascade-skip", reason: FAILURE_REASONS.CLOUD_BUDGET, ...payload });
      meteredTelemetry({
        ...payload,
        tokens_in: null,
        tokens_out: null,
        ms: 0,
        parsed_ok: false,
        fallback_reason: FAILURE_REASONS.CLOUD_BUDGET,
        parse_retry: false,
        cloud_tokens_used: cloudBudget.used,
        cloud_tokens_max: cloudBudget.maxCloudTokens,
      });
      lastErr = { ok: false, reason: FAILURE_REASONS.CLOUD_BUDGET, error: `cloud budget exhausted (${cloudBudget.used}/${cloudBudget.maxCloudTokens} tokens)` };
      continue;
    }

    onEvent({ type: "cascade-attempt", ...payload });
    onEvent({ type: "node-step", key: node.key, ...payload });

    const { envelope } = await tryStep({
      step,
      system,
      userMsg,
      jsonSchema,
      jsonSchemaName,
      role: role ?? node.role,
      timeoutMs,
      seed,
      onChunk: (_chunk, totalBytes) => onEvent({ type: "node-chunk", key: node.key, bytes: totalBytes }),
      recordTelemetry: meteredTelemetry,
      nodeKey: node.key,
      attempt,
      chat,
    });

    if (envelope.ok && envelope.parsed != null) {
      return { envelope, step };
    }
    lastErr = envelope;
  }
  return { envelope: lastErr ?? { ok: false, error: "no cascade steps" }, step: null };
}
