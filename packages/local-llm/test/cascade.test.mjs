import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveCascade,
  localLanesForTier,
  cascadePolicy,
  TIER_LOCAL_MODELS,
  runCascade,
  PROVIDER_NAMES,
  LOCAL_PROVIDERS,
} from "../index.mjs";

test("provider set includes mlx as a first-class provider", () => {
  assert.ok(PROVIDER_NAMES.includes("mlx"));
  assert.deepEqual([...LOCAL_PROVIDERS], ["mlx", "ollama"]);
});

test("local lane order is MLX-first then Ollama", () => {
  const lanes = localLanesForTier("parse");
  assert.equal(lanes[0].provider, "mlx");
  assert.equal(lanes[0].lane, "local-mlx");
  assert.equal(lanes[0].model, TIER_LOCAL_MODELS.parse.mlx);
  assert.equal(lanes[1].provider, "ollama");
  assert.equal(lanes[1].lane, "local-ollama");
});

test("per-backend model ids differ (mlx HF id vs ollama tag)", () => {
  const lanes = localLanesForTier("mid");
  const mlx = lanes.find((l) => l.provider === "mlx");
  const ollama = lanes.find((l) => l.lane === "local-ollama");
  assert.match(mlx.model, /^mlx-community\//);
  assert.doesNotMatch(ollama.model, /^mlx-community\//);
});

test("MLX lane drops when health is explicitly false (mirrors cloud key-drop)", () => {
  const lanes = localLanesForTier("parse", { mlx: false });
  assert.ok(!lanes.some((l) => l.provider === "mlx"), "mlx lane should be dropped");
  assert.equal(lanes[0].provider, "ollama", "ollama becomes the local primary");
});

test("resolveCascade on-failure: local-mlx -> local-ollama -> eligible cloud", () => {
  const policy = cascadePolicy({ allowCloud: "on-failure" });
  // Only GROQ key present; anthropic/openai dropped.
  const env = { GROQ_API_KEY: "x" };
  const cascade = resolveCascade("intake", policy, null, env, {});
  const lanes = cascade.map((s) => s.lane);
  assert.equal(lanes[0], "local-mlx");
  assert.ok(lanes.includes("local-ollama"));
  assert.ok(lanes.includes("cloud")); // groq, key present
  assert.ok(!lanes.some((s, i) => i > 0 && cascade[i].provider === "anthropic"));
  // anthropic/openai lanes dropped (no key)
  assert.ok(!cascade.some((s) => s.provider === "anthropic"));
  assert.ok(!cascade.some((s) => s.provider === "openai"));
});

test("resolveCascade never: local lanes only, no cloud", () => {
  const policy = cascadePolicy({ allowCloud: "never" });
  const cascade = resolveCascade("triage", policy, null, { GROQ_API_KEY: "x", ANTHROPIC_API_KEY: "y" }, {});
  assert.ok(cascade.every((s) => LOCAL_PROVIDERS.includes(s.provider)), "never => only local providers");
  assert.equal(cascade[0].lane, "local-mlx");
});

test("resolveCascade always: cloud first then local", () => {
  const policy = cascadePolicy({ allowCloud: "always" });
  const cascade = resolveCascade("intake", policy, null, { GROQ_API_KEY: "x" }, {});
  assert.equal(cascade[0].provider, "groq");
  assert.ok(cascade.some((s) => s.provider === "mlx"));
});

test("MLX-down cascade drops to ollama then cloud", () => {
  const policy = cascadePolicy({ allowCloud: "on-failure" });
  const cascade = resolveCascade("intake", policy, null, { GROQ_API_KEY: "x" }, { mlx: false });
  assert.ok(!cascade.some((s) => s.provider === "mlx"), "mlx dropped when down");
  assert.equal(cascade[0].provider, "ollama");
  assert.ok(cascade.some((s) => s.provider === "groq"));
});

test("runCascade advances past a failing lane to the next (mocked chat)", async () => {
  const calls = [];
  const fakeChat = async ({ provider, model }) => {
    calls.push({ provider, model });
    if (provider === "mlx") return { ok: false, error: "mlx down", retryable: true, provider, model, reason: "http-error" };
    return { ok: true, text: '{"x":1}', parsed: { x: 1 }, raw: {}, tokens_in: 5, tokens_out: 3, provider, model };
  };
  const policy = cascadePolicy({ allowCloud: "never" });
  const cascade = resolveCascade("parse" in TIER_LOCAL_MODELS ? "intake" : "intake", policy, null, {}, {});
  const { envelope, step } = await runCascade({ node: { key: "intake" }, cascade, system: "s", userMsg: "u", chat: fakeChat });
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.parsed, { x: 1 });
  assert.equal(calls[0].provider, "mlx", "tried mlx first");
  assert.equal(step.provider, "ollama", "won on ollama after mlx failed");
});

test("runCascade fires one parse-retry on malformed JSON then succeeds", async () => {
  let n = 0;
  const fakeChat = async ({ provider, model }) => {
    n += 1;
    if (n === 1) return { ok: true, text: "not json", parsed: null, raw: {}, provider, model };
    return { ok: true, text: '{"ok":true}', parsed: { ok: true }, raw: {}, provider, model };
  };
  const single = [{ provider: "mlx", model: "m", lane: "local-mlx" }];
  const { envelope } = await runCascade({ node: { key: "x" }, cascade: single, system: "s", userMsg: "u", chat: fakeChat });
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.parsed, { ok: true });
  assert.equal(n, 2, "exactly one parse-retry");
});

// --- cloud-token budget enforcement (follow-up item 10) ---

import { createCloudBudget, FAILURE_REASONS } from "../index.mjs";

test("createCloudBudget derives max from cascadePolicy output", () => {
  const b = createCloudBudget(cascadePolicy({ allowCloud: "on-failure" }));
  assert.equal(b.maxCloudTokens, 200000);
  assert.equal(b.used, 0);
  const never = createCloudBudget(cascadePolicy({ allowCloud: "never" }));
  assert.equal(never.maxCloudTokens, 0);
});

test("runCascade meters cloud tokens into the shared budget", async () => {
  const fakeChat = async ({ provider, model }) => (
    { ok: true, text: '{"x":1}', parsed: { x: 1 }, raw: {}, tokens_in: 70, tokens_out: 30, provider, model }
  );
  const budget = createCloudBudget({ maxCloudTokens: 1000 });
  const cascade = [{ provider: "groq", model: "g", lane: "cloud" }];
  const { envelope } = await runCascade({ node: { key: "n" }, cascade, system: "s", userMsg: "u", chat: fakeChat, cloudBudget: budget });
  assert.equal(envelope.ok, true);
  assert.equal(budget.used, 100, "tokens_in + tokens_out accrued");
});

test("runCascade skips cloud lanes once the budget is spent and falls to local", async () => {
  const calls = [];
  const fakeChat = async ({ provider, model }) => {
    calls.push(provider);
    return { ok: true, text: '{"x":1}', parsed: { x: 1 }, raw: {}, tokens_in: 1, tokens_out: 1, provider, model };
  };
  const budget = { maxCloudTokens: 100, used: 100 }; // already spent
  const events = [];
  const telemetry = [];
  const cascade = [
    { provider: "groq", model: "g", lane: "cloud" },
    { provider: "anthropic", model: "a", lane: "cloud-secondary" },
    { provider: "ollama", model: "o", lane: "local-ollama" },
  ];
  const { envelope, step } = await runCascade({
    node: { key: "n" }, cascade, system: "s", userMsg: "u", chat: fakeChat,
    cloudBudget: budget,
    onEvent: (e) => events.push(e),
    recordTelemetry: (r) => telemetry.push(r),
  });
  assert.equal(envelope.ok, true, "run still succeeds via local lane");
  assert.equal(step.lane, "local-ollama");
  assert.deepEqual(calls, ["ollama"], "no cloud provider was dialed");
  const skips = events.filter((e) => e.type === "cascade-skip");
  assert.equal(skips.length, 2, "both cloud lanes skipped");
  assert.ok(skips.every((e) => e.reason === FAILURE_REASONS.CLOUD_BUDGET));
  const skipRecords = telemetry.filter((r) => r.fallback_reason === FAILURE_REASONS.CLOUD_BUDGET);
  assert.equal(skipRecords.length, 2, "skips recorded in telemetry");
});

test("runCascade with exhausted budget and cloud-only cascade returns graceful failure (no throw)", async () => {
  const budget = { maxCloudTokens: 10, used: 10 };
  const cascade = [{ provider: "groq", model: "g", lane: "cloud" }];
  const { envelope, step } = await runCascade({
    node: { key: "n" }, cascade, system: "s", userMsg: "u",
    chat: async () => { throw new Error("should not be called"); },
    cloudBudget: budget,
  });
  assert.equal(step, null);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.reason, FAILURE_REASONS.CLOUD_BUDGET);
});

test("budget crossing mid-cascade: first cloud lane runs, later cloud lanes skip", async () => {
  const calls = [];
  const fakeChat = async ({ provider, model }) => {
    calls.push(provider);
    // First cloud call burns the whole budget but fails to parse -> cascade advances.
    if (provider === "groq") return { ok: false, error: "boom", provider, model, reason: "http-error" };
    return { ok: true, text: '{"x":1}', parsed: { x: 1 }, raw: {}, tokens_in: 2, tokens_out: 2, provider, model };
  };
  // groq failure records tokens_in/out null -> no accrual; simulate spend via used.
  const budget = { maxCloudTokens: 5, used: 0 };
  const cascade = [
    { provider: "groq", model: "g", lane: "cloud" },
    { provider: "anthropic", model: "a", lane: "cloud-secondary" },
    { provider: "ollama", model: "o", lane: "local-ollama" },
  ];
  // Pre-spend so the second cloud lane crosses the threshold after groq runs.
  budget.used = 5;
  const { step } = await runCascade({ node: { key: "n" }, cascade, system: "s", userMsg: "u", chat: fakeChat, cloudBudget: budget });
  assert.deepEqual(calls, ["ollama"], "exhausted before loop: all cloud lanes skipped");
  assert.equal(step.lane, "local-ollama");
});
