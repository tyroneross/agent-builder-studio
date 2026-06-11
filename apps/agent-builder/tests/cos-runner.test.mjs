// Tests for the multi-provider cascade refactor.
//
// We do NOT call live Ollama or Groq. Instead, we monkey-patch the provider
// shim's `chat()` and assert routing/cascade/parse-retry/telemetry behavior.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cascadePolicy,
  resolveCascade,
  NODE_ROUTING,
  TIER_LOCAL_MODELS,
  FAILURE_REASONS,
} from "../lib/cos-config.mjs";
import { recordTelemetry } from "../lib/cos-telemetry.mjs";
import * as providers from "../lib/providers/index.mjs";
import { setChatImpl } from "../lib/providers/index.mjs";
// Per-provider behavior is reached through the package's root `chat` dispatcher
// (provider-keyed); the four 1-line app-local shims were removed. The dispatcher
// routes to the same provider module, so the missing-key / cache_control /
// strict-json envelopes are identical to calling the provider chat() directly.
import { chat as pkgChat } from "@tyroneross/local-llm";
const anthropicChat = (opts) => pkgChat({ ...opts, provider: "anthropic" });
const openaiChat = (opts) => pkgChat({ ...opts, provider: "openai" });

// ---------- cascadePolicy precedence ----------

test("cascadePolicy: default is on-failure with 200k token budget", () => {
  const env = { ...process.env };
  delete process.env.COS_ALLOW_CLOUD;
  delete process.env.COS_MAX_CLOUD_TOKENS;
  const p = cascadePolicy();
  process.env = env;
  assert.equal(p.allowCloud, "on-failure");
  assert.equal(p.maxCloudTokens, 200000);
});

test("cascadePolicy: allowCloud=never zeroes the cloud token budget", () => {
  const p = cascadePolicy({ allowCloud: "never" });
  assert.equal(p.allowCloud, "never");
  assert.equal(p.maxCloudTokens, 0);
});

test("cascadePolicy: explicit opts beat env", () => {
  const env = { ...process.env };
  process.env.COS_ALLOW_CLOUD = "always";
  const p = cascadePolicy({ allowCloud: "never" });
  process.env = env;
  assert.equal(p.allowCloud, "never");
});

test("cascadePolicy: invalid allowCloud falls back to on-failure", () => {
  const p = cascadePolicy({ allowCloud: "garbage" });
  assert.equal(p.allowCloud, "on-failure");
});

// ---------- resolveCascade ordering ----------

// MLX-first amendment: the local lane is now [local-mlx, local-ollama,
// local-ollama-fallback]. Tests pass localHealth={mlx:true,ollama:true} so both
// local backends are present (default optimistic when health is unknown).
const BOTH_LOCAL = { mlx: true, ollama: true };

test("resolveCascade: never -> [local-mlx, local-ollama, local-ollama-fallback], no cloud", () => {
  const c = resolveCascade("intake", { allowCloud: "never", maxCloudTokens: 0 }, null, {}, BOTH_LOCAL);
  assert.equal(c.length, 3);
  assert.deepEqual(c.map((s) => s.lane), ["local-mlx", "local-ollama", "local-ollama-fallback"]);
  assert.deepEqual(c.map((s) => s.provider), ["mlx", "ollama", "ollama"]);
});

test("resolveCascade: on-failure with all keys -> [local x3, cloud x3]", () => {
  const env = { GROQ_API_KEY: "x", ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "x" };
  const c = resolveCascade("triage", { allowCloud: "on-failure", maxCloudTokens: 200000 }, null, env, BOTH_LOCAL);
  assert.equal(c.length, 6);
  assert.deepEqual(
    c.map((s) => s.lane),
    ["local-mlx", "local-ollama", "local-ollama-fallback", "cloud", "cloud-secondary", "cloud-tertiary"],
  );
  assert.equal(c[0].provider, "mlx");
  assert.equal(c[3].provider, "groq");
  assert.equal(c[4].provider, "anthropic");
  assert.equal(c[5].provider, "openai");
});

test("resolveCascade: missing API keys drop their cloud lanes", () => {
  const env = { GROQ_API_KEY: "x" }; // anthropic + openai keys absent
  const c = resolveCascade("triage", { allowCloud: "on-failure", maxCloudTokens: 200000 }, null, env, BOTH_LOCAL);
  assert.equal(c.length, 4);
  assert.deepEqual(c.map((s) => s.lane), ["local-mlx", "local-ollama", "local-ollama-fallback", "cloud"]);
});

test("resolveCascade: MLX down drops the mlx lane (local mirror of key-gating)", () => {
  const c = resolveCascade("intake", { allowCloud: "never" }, null, {}, { mlx: false, ollama: true });
  assert.ok(!c.some((s) => s.provider === "mlx"), "mlx lane dropped when unhealthy");
  assert.equal(c[0].lane, "local-ollama");
});

test("resolveCascade: always with all keys -> [cloud lanes, then locals]", () => {
  const env = { GROQ_API_KEY: "x", ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "x" };
  const c = resolveCascade("triage", { allowCloud: "always", maxCloudTokens: 200000 }, null, env, BOTH_LOCAL);
  assert.deepEqual(
    c.map((s) => s.lane),
    ["cloud", "cloud-secondary", "cloud-tertiary", "local-mlx", "local-ollama", "local-ollama-fallback"],
  );
});

test("resolveCascade: userOverride collapses to single step", () => {
  const c = resolveCascade(
    "triage",
    { allowCloud: "always", maxCloudTokens: 200000 },
    { provider: "ollama", model: "llama3.2:3b" },
  );
  assert.equal(c.length, 1);
  assert.equal(c[0].lane, "user-override");
  assert.equal(c[0].model, "llama3.2:3b");
});

test("resolveCascade: every documented node has a routing entry", () => {
  const expected = [
    "intake",
    "triage",
    "time_block_plan",
    "decision_log",
    "follow_up_plan",
    "operating_risks",
  ];
  for (const k of expected) {
    assert.ok(NODE_ROUTING[k], `node ${k} missing from NODE_ROUTING`);
    // Local models now derive from the tier (TIER_LOCAL_MODELS); routing carries
    // the tier + cloud lanes.
    assert.ok(NODE_ROUTING[k].tier, `node ${k} tier missing`);
    assert.ok(NODE_ROUTING[k].cloud.model, `node ${k} cloud missing`);
  }
});

// ---------- per-node tier honored ----------

test("Different nodes route to different model tiers (parse vs synthesis)", () => {
  // intake = parse, triage = synthesis → different local model ids per tier.
  const intakeLocal = resolveCascade("intake", { allowCloud: "never" }, null, {}, { mlx: true, ollama: true });
  const triageLocal = resolveCascade("triage", { allowCloud: "never" }, null, {}, { mlx: true, ollama: true });
  assert.notEqual(
    intakeLocal[0].model,
    triageLocal[0].model,
    "parse and synthesis tiers collapsed to one model — tier table not honored",
  );
});

// ---------- provider shim dispatch ----------

test("providers.chat: unknown provider returns ok:false", async () => {
  const env = await providers.chat({ provider: "nopenope", model: "x" });
  assert.equal(env.ok, false);
  assert.match(env.error, /unknown provider/);
});

test("providers.chat: missing provider param returns ok:false", async () => {
  const env = await providers.chat({ model: "x" });
  assert.equal(env.ok, false);
  assert.match(env.error, /missing 'provider'/);
});

test("anthropic.chat: missing ANTHROPIC_API_KEY returns missing-key envelope", async () => {
  const orig = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const env = await anthropicChat({ model: "claude-anything", messages: [{ role: "user", content: "x" }] });
    assert.equal(env.ok, false);
    assert.equal(env.provider, "anthropic");
    assert.equal(env.reason, FAILURE_REASONS.MISSING_KEY);
  } finally {
    if (orig != null) process.env.ANTHROPIC_API_KEY = orig;
  }
});

test("openai.chat: missing OPENAI_API_KEY returns missing-key envelope", async () => {
  const orig = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const env = await openaiChat({ model: "gpt-anything", messages: [{ role: "user", content: "x" }] });
    assert.equal(env.ok, false);
    assert.equal(env.provider, "openai");
    assert.equal(env.reason, FAILURE_REASONS.MISSING_KEY);
  } finally {
    if (orig != null) process.env.OPENAI_API_KEY = orig;
  }
});

// ---------- groq missing key path ----------

test("groq.chat: missing GROQ_API_KEY returns missing-key envelope", async () => {
  const env = { ...process.env };
  delete process.env.GROQ_API_KEY;
  const out = await pkgChat({ provider: "groq", model: "llama-3.3-70b-versatile", messages: [{ role: "user", content: "x" }] });
  process.env = env;
  assert.equal(out.ok, false);
  assert.equal(out.reason, FAILURE_REASONS.MISSING_KEY);
});

// ---------- telemetry write ----------

test("recordTelemetry: appends one JSONL row per call", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cos-tel-"));
  try {
    await recordTelemetry(dir, {
      node: "intake",
      attempt: 1,
      lane: "local-primary",
      provider: "ollama",
      model: "qwen3:8b-q4_K_M",
      tokens_in: 120,
      tokens_out: 88,
      ms: 1234,
      parsed_ok: true,
      fallback_reason: null,
      parse_retry: false,
    });
    await recordTelemetry(dir, {
      node: "triage",
      attempt: 2,
      lane: "cloud",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      tokens_in: 410,
      tokens_out: 220,
      ms: 870,
      parsed_ok: true,
      fallback_reason: "http-error",
      parse_retry: false,
    });
    const text = await readFile(join(dir, "telemetry.jsonl"), "utf8");
    const lines = text.trim().split("\n");
    assert.equal(lines.length, 2);
    const r1 = JSON.parse(lines[0]);
    const r2 = JSON.parse(lines[1]);
    assert.equal(r1.node, "intake");
    assert.equal(r2.node, "triage");
    assert.equal(r2.fallback_reason, "http-error");
    assert.ok(r1.ts && r2.ts, "ts present");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- end-to-end cascade with mocked providers ----------

test("runChiefOfStaff: cascade falls back from local to cloud on local error", async () => {
  const mod = await import("../lib/cos-runner.mjs");

  // The cascade builder filters cloud lanes lacking API keys. Set a stub key
  // so the groq lane is included. The mocked chat impl ignores the value.
  const origGroq = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = "test-stub";

  const calls = [];
  setChatImpl(async (opts) => {
    calls.push({ provider: opts.provider, model: opts.model });
    if (opts.provider === "ollama") {
      return {
        ok: false,
        error: "simulated ollama down",
        retryable: true,
        provider: "ollama",
        model: opts.model,
        reason: FAILURE_REASONS.HTTP,
      };
    }
    if (opts.provider === "groq") {
      const fakeJson = '{"weekOf":"2026-W19","fixedEvents":[],"flexibleEvents":[],"baseline":{"deepWorkHours":0,"adminHours":0,"contextSwitches":0,"openLoopRisk":"low"},"notes":[],"topThree":[],"blocks":[],"decisions":[],"items":[],"missingOwners":[],"risks":[]}';
      return {
        ok: true,
        text: fakeJson,
        parsed: JSON.parse(fakeJson),
        raw: { stub: true },
        tokens_in: 100,
        tokens_out: 50,
        provider: "groq",
        model: opts.model,
      };
    }
    return { ok: false, error: "no", retryable: false, provider: opts.provider, model: opts.model, reason: "unknown" };
  });

  const dir = await mkdtemp(join(tmpdir(), "cos-cascade-"));
  try {
    const events = [];
    const { transcript } = await mod.runChiefOfStaff({
      schedule: '{"weekOf":"2026-W19","events":[]}',
      goals: "test",
      allowCloud: "on-failure",
      maxCloudTokens: 200000,
      onEvent: (ev) => events.push(ev),
      runDir: dir,
    });
    // Every node must have ended up on groq.
    for (const [, node] of Object.entries(transcript.nodes)) {
      assert.equal(node.provider, "groq", `${node.name} should have fallen back to groq`);
      assert.equal(node.lane, "cloud");
    }
    // Telemetry should record ollama failures AND groq successes.
    const tel = (await readFile(join(dir, "telemetry.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const ollamaFails = tel.filter((r) => r.provider === "ollama" && !r.parsed_ok);
    const groqWins = tel.filter((r) => r.provider === "groq" && r.parsed_ok);
    assert.ok(ollamaFails.length > 0, "expected ollama failure rows in telemetry");
    assert.ok(groqWins.length >= 6, "expected groq success rows for all 6 nodes");
  } finally {
    setChatImpl(null);
    if (origGroq != null) process.env.GROQ_API_KEY = origGroq; else delete process.env.GROQ_API_KEY;
    await rm(dir, { recursive: true, force: true });
  }
});

test("runChiefOfStaff: allowCloud=never never reaches groq", async () => {
  const mod = await import("../lib/cos-runner.mjs");

  const seen = new Set();
  setChatImpl(async (opts) => {
    seen.add(opts.provider);
    return {
      ok: false,
      error: "simulated all-local down",
      retryable: true,
      provider: opts.provider,
      model: opts.model,
      reason: FAILURE_REASONS.HTTP,
    };
  });

  const dir = await mkdtemp(join(tmpdir(), "cos-strict-"));
  try {
    const { transcript } = await mod.runChiefOfStaff({
      schedule: '{"weekOf":"2026-W19","events":[]}',
      goals: "test",
      allowCloud: "never",
      onEvent: () => {},
      runDir: dir,
    });
    assert.ok(!seen.has("groq"), "groq must not be touched under allowCloud=never");
    for (const [, node] of Object.entries(transcript.nodes)) {
      assert.ok(node.error, "every node should have errored cleanly under strict-local");
    }
  } finally {
    setChatImpl(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("runChiefOfStaff: parse-retry fires on null parse, succeeds on retry", async () => {
  const mod = await import("../lib/cos-runner.mjs");

  // Track per-(provider,model) call counts so we can return null first then valid second.
  const counts = new Map();
  setChatImpl(async (opts) => {
    // The runner's warmup also calls chat; let it succeed quickly.
    if (opts.messages?.[0]?.content?.includes('Return {"ok":true}')) {
      return {
        ok: true,
        text: '{"ok":true}',
        parsed: { ok: true },
        raw: null,
        tokens_in: 1,
        tokens_out: 1,
        provider: opts.provider,
        model: opts.model,
      };
    }
    const k = `${opts.provider}:${opts.model}`;
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    if (n === 1) {
      // Malformed JSON — triggers parse-retry.
      return {
        ok: true,
        text: "this is not json {{{",
        parsed: null,
        raw: null,
        tokens_in: 50,
        tokens_out: 10,
        provider: opts.provider,
        model: opts.model,
      };
    }
    // Retry succeeds.
    const fakeJson = '{"weekOf":"2026-W19","fixedEvents":[],"flexibleEvents":[],"baseline":{"deepWorkHours":0,"adminHours":0,"contextSwitches":0,"openLoopRisk":"low"},"notes":[],"topThree":[],"blocks":[],"decisions":[],"items":[],"missingOwners":[],"risks":[]}';
    return {
      ok: true,
      text: fakeJson,
      parsed: JSON.parse(fakeJson),
      raw: null,
      tokens_in: 100,
      tokens_out: 50,
      provider: opts.provider,
      model: opts.model,
    };
  });

  const dir = await mkdtemp(join(tmpdir(), "cos-retry-"));
  try {
    const { transcript } = await mod.runChiefOfStaff({
      schedule: '{"weekOf":"2026-W19","events":[]}',
      goals: "test",
      allowCloud: "never",
      onEvent: () => {},
      runDir: dir,
    });
    // All nodes should have succeeded on a LOCAL lane after a parse-retry. Which
    // local backend wins (local-mlx vs local-ollama) depends on live server
    // health probed at run time — both are mocked to succeed via setChatImpl, so
    // the surviving primary local lane wins. Assert local + parsed, not a specific
    // backend (health is environmental, not part of this test's contract).
    for (const [, node] of Object.entries(transcript.nodes)) {
      assert.ok(node.lane.startsWith("local-"), `${node.name} should win on a local lane, got ${node.lane}`);
      assert.ok(node.parsed != null);
    }
    const tel = (await readFile(join(dir, "telemetry.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    // Different nodes share models (triage/time_block_plan/operating_risks
    // all use gemma4:26b), so the per-(provider,model) counter only triggers
    // a parse-retry the FIRST time each model is touched. Two distinct local
    // primary models in the routing table → at least 2 retry rows.
    const retries = tel.filter((r) => r.parse_retry === true && r.parsed_ok === true);
    assert.ok(retries.length >= 2, `expected ≥2 retry rows, got ${retries.length}`);
    // Every node must still land on a parsed result via local-primary.
    const parsedNodes = Object.values(transcript.nodes).filter((n) => n.parsed != null);
    assert.equal(parsedNodes.length, 6, "every node should have ended with a parsed result");
  } finally {
    setChatImpl(null);
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- G1: parallel fan-out of independent nodes ----------

test("runChiefOfStaff: decision_log/follow_up_plan/operating_risks run in parallel", async () => {
  const mod = await import("../lib/cos-runner.mjs");

  const FAKE_JSON = '{"weekOf":"2026-W19","fixedEvents":[],"flexibleEvents":[],"baseline":{"deepWorkHours":0,"adminHours":0,"contextSwitches":0,"openLoopRisk":"low"},"notes":[],"topThree":[],"blocks":[],"decisions":[],"items":[],"missingOwners":[],"risks":[]}';

  // Simulate 80ms latency per node call. If the 3 leaf nodes run in parallel,
  // their wall-clock should be ~80ms, not ~240ms.
  setChatImpl(async (opts) => {
    if (opts.messages?.[0]?.content?.includes('Return {"ok":true}')) {
      return {
        ok: true, text: '{"ok":true}', parsed: { ok: true }, raw: null,
        tokens_in: 1, tokens_out: 1, provider: opts.provider, model: opts.model,
      };
    }
    await new Promise((r) => setTimeout(r, 80));
    return {
      ok: true, text: FAKE_JSON, parsed: JSON.parse(FAKE_JSON), raw: null,
      tokens_in: 100, tokens_out: 50, provider: opts.provider, model: opts.model,
    };
  });

  const dir = await mkdtemp(join(tmpdir(), "cos-parallel-"));
  try {
    const { transcript } = await mod.runChiefOfStaff({
      schedule: '{"weekOf":"2026-W19","events":[]}',
      goals: "test",
      allowCloud: "never",
      onEvent: () => {},
      runDir: dir,
    });

    const leaves = ["decision_log", "follow_up_plan", "operating_risks"];
    const ts = leaves.map((k) => ({
      key: k,
      start: Date.parse(transcript.nodes[k].startedAt),
      end: Date.parse(transcript.nodes[k].endedAt),
      dur: transcript.nodes[k].durationMs,
    }));
    const summed = ts.reduce((a, b) => a + b.dur, 0);
    const wall = Math.max(...ts.map((x) => x.end)) - Math.min(...ts.map((x) => x.start));
    // Wall-clock for the fan-out wave should be much less than the sum of
    // individual durations — at least < 70% of summed when they run together.
    assert.ok(
      wall < summed * 0.7,
      `expected fan-out (wall=${wall}ms) << summed (${summed}ms); leaves did not run concurrently`,
    );
  } finally {
    setChatImpl(null);
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- G2: warmup uses smallest model in cascade ----------

test("runChiefOfStaff: warmup picks smallest local model, not synthesis", async () => {
  const mod = await import("../lib/cos-runner.mjs");

  const FAKE_JSON = '{"weekOf":"2026-W19","fixedEvents":[],"flexibleEvents":[],"baseline":{"deepWorkHours":0,"adminHours":0,"contextSwitches":0,"openLoopRisk":"low"},"notes":[],"topThree":[],"blocks":[],"decisions":[],"items":[],"missingOwners":[],"risks":[]}';
  let warmupModel = null;

  setChatImpl(async (opts) => {
    if (opts.messages?.[0]?.content?.includes('Return {"ok":true}')) {
      warmupModel = opts.model;
      return {
        ok: true, text: '{"ok":true}', parsed: { ok: true }, raw: null,
        tokens_in: 1, tokens_out: 1, provider: opts.provider, model: opts.model,
      };
    }
    return {
      ok: true, text: FAKE_JSON, parsed: JSON.parse(FAKE_JSON), raw: null,
      tokens_in: 100, tokens_out: 50, provider: opts.provider, model: opts.model,
    };
  });

  const dir = await mkdtemp(join(tmpdir(), "cos-warm-"));
  try {
    // Capture the warmup TARGET from either path: the warmup chat call (model
    // not resident) OR the warmup-skip event (model already loaded in Ollama —
    // environment-dependent, since prior live runs may have loaded it). Both
    // prove the SMALLEST model was chosen, which is the test's contract.
    await mod.runChiefOfStaff({
      schedule: '{"weekOf":"2026-W19","events":[]}',
      goals: "test",
      allowCloud: "never",
      onEvent: (evt) => {
        if ((evt.type === "warmup" || evt.type === "warmup-skip") && evt.model) {
          warmupModel = evt.model;
        }
      },
      runDir: dir,
    });
    assert.ok(warmupModel, "warmup should have run or been skipped-as-loaded");
    // Smallest model in cascade is llama3.2:3b (parse fallback). Warmup must
    // NOT pick the 26B synthesis model.
    assert.notEqual(warmupModel, "gemma4:26b", `warmup picked synthesis model ${warmupModel}`);
    // Should be one of the small models.
    assert.ok(
      ["llama3.2:3b", "qwen3:8b-q4_K_M"].includes(warmupModel),
      `warmup picked unexpected model ${warmupModel}`,
    );
  } finally {
    setChatImpl(null);
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- G3/G4: Anthropic provider — JSON parse + cache_control ----------

test("anthropic.chat: parses prefilled-{ JSON and reports cache tokens when present", async () => {
  // Stub the global fetch for this single test.
  const origFetch = globalThis.fetch;
  let capturedBody = null;
  let capturedHeaders = null;
  globalThis.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    capturedHeaders = init.headers;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: '"weekOf":"2026-W19","fixedEvents":[],"flexibleEvents":[],"baseline":{"deepWorkHours":0,"adminHours":0,"contextSwitches":0,"openLoopRisk":"low"},"notes":[],"topThree":[],"blocks":[],"decisions":[],"items":[],"missingOwners":[],"risks":[]}' }],
        usage: { input_tokens: 120, output_tokens: 88, cache_read_input_tokens: 60, cache_creation_input_tokens: 0 },
      }),
    };
  };
  const orig = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-stub";
  try {
    const env = await anthropicChat({
      model: "claude-haiku-4-5-20251001",
      system: [
        { type: "text", text: "STATIC RULES", cache_control: { type: "ephemeral" } },
        { type: "text", text: "DYNAMIC ROLE INFO" },
      ],
      messages: [{ role: "user", content: "produce JSON" }],
    });
    assert.equal(env.ok, true);
    assert.equal(env.parsed?.weekOf, "2026-W19");
    assert.equal(env.cache_read_tokens, 60);
    // Headers right
    assert.equal(capturedHeaders["x-api-key"], "test-stub");
    assert.equal(capturedHeaders["anthropic-version"], "2023-06-01");
    // Prefilled "{" assistant turn
    const lastMsg = capturedBody.messages[capturedBody.messages.length - 1];
    assert.equal(lastMsg.role, "assistant");
    assert.equal(lastMsg.content, "{");
    // System block carries cache_control on the static block, not the dynamic one
    assert.equal(capturedBody.system[0].cache_control?.type, "ephemeral");
    assert.equal(capturedBody.system[1].cache_control, undefined);
  } finally {
    globalThis.fetch = origFetch;
    if (orig != null) process.env.ANTHROPIC_API_KEY = orig; else delete process.env.ANTHROPIC_API_KEY;
  }
});

// ---------- G5: OpenAI strict json_schema mode driven from node.schema ----------

test("openai.chat: uses strict json_schema mode when jsonSchema is provided", async () => {
  const origFetch = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, init) => {
    capturedBody = JSON.parse(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"x":1}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 3 },
      }),
    };
  };
  const orig = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-stub";
  try {
    const env = await openaiChat({
      model: "gpt-5-mini",
      system: "sys",
      messages: [{ role: "user", content: "u" }],
      jsonSchema: { type: "object", properties: { x: { type: "number" } }, required: ["x"], additionalProperties: false },
      jsonSchemaName: "test_output",
    });
    assert.equal(env.ok, true);
    assert.equal(env.parsed?.x, 1);
    assert.equal(capturedBody.response_format.type, "json_schema");
    assert.equal(capturedBody.response_format.json_schema.strict, true);
    assert.equal(capturedBody.response_format.json_schema.name, "test_output");
    assert.deepEqual(capturedBody.response_format.json_schema.schema.required, ["x"]);
  } finally {
    globalThis.fetch = origFetch;
    if (orig != null) process.env.OPENAI_API_KEY = orig; else delete process.env.OPENAI_API_KEY;
  }
});

// ---------- G6: cascade extends through Anthropic and OpenAI when prior cloud lanes fail ----------

test("runChiefOfStaff: cascade extends to anthropic + openai when groq fails", async () => {
  const mod = await import("../lib/cos-runner.mjs");

  // All 3 cloud keys present so all cloud lanes are eligible
  const origs = {
    GROQ_API_KEY: process.env.GROQ_API_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  process.env.GROQ_API_KEY = "x";
  process.env.ANTHROPIC_API_KEY = "x";
  process.env.OPENAI_API_KEY = "x";

  const FAKE_JSON = '{"weekOf":"2026-W19","fixedEvents":[],"flexibleEvents":[],"baseline":{"deepWorkHours":0,"adminHours":0,"contextSwitches":0,"openLoopRisk":"low"},"notes":[],"topThree":[],"blocks":[],"decisions":[],"items":[],"missingOwners":[],"risks":[]}';
  const seenLanes = new Set();
  setChatImpl(async (opts) => {
    if (opts.messages?.[0]?.content?.includes('Return {"ok":true}')) {
      return { ok: true, text: '{"ok":true}', parsed: { ok: true }, raw: null, tokens_in: 1, tokens_out: 1, provider: opts.provider, model: opts.model };
    }
    if (opts.provider === "ollama" || opts.provider === "groq") {
      return { ok: false, error: `${opts.provider} simulated failure`, retryable: true, provider: opts.provider, model: opts.model, reason: FAILURE_REASONS.HTTP };
    }
    if (opts.provider === "anthropic") {
      seenLanes.add("anthropic");
      return { ok: true, text: FAKE_JSON, parsed: JSON.parse(FAKE_JSON), raw: null, tokens_in: 100, tokens_out: 50, cache_read_tokens: 50, cache_write_tokens: 0, provider: "anthropic", model: opts.model };
    }
    if (opts.provider === "openai") {
      seenLanes.add("openai");
      return { ok: true, text: FAKE_JSON, parsed: JSON.parse(FAKE_JSON), raw: null, provider: "openai", model: opts.model };
    }
    return { ok: false, error: "no", retryable: false, provider: opts.provider, model: opts.model, reason: "unknown" };
  });

  const dir = await mkdtemp(join(tmpdir(), "cos-cloud-"));
  try {
    const { transcript } = await mod.runChiefOfStaff({
      schedule: '{"weekOf":"2026-W19","events":[]}',
      goals: "test",
      allowCloud: "on-failure",
      onEvent: () => {},
      runDir: dir,
    });
    // All nodes should land on anthropic (the next cloud lane after groq fails)
    for (const [, n] of Object.entries(transcript.nodes)) {
      assert.equal(n.provider, "anthropic", `${n.name} should have escalated to anthropic`);
      assert.equal(n.lane, "cloud-secondary");
    }
    assert.ok(seenLanes.has("anthropic"));
    // Verify telemetry has cache_read_tokens recorded
    const tel = (await readFile(join(dir, "telemetry.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    const anyCacheRead = tel.find((r) => r.cache_read_tokens === 50);
    assert.ok(anyCacheRead, "expected at least one telemetry row with cache_read_tokens");
  } finally {
    setChatImpl(null);
    for (const [k, v] of Object.entries(origs)) {
      if (v != null) process.env[k] = v; else delete process.env[k];
    }
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- G7: feedback-loop reads prior learning-ledger.json ----------

test("runChiefOfStaff: loads ≤2 promoted lessons into triage + time_block_plan only", async () => {
  const mod = await import("../lib/cos-runner.mjs");
  const { writeFile, mkdir } = await import("node:fs/promises");

  // Set up a parent dir with a prior run + ledger and a fresh runDir.
  const parent = await mkdtemp(join(tmpdir(), "cos-ledger-"));
  const priorRun = join(parent, "prior-run");
  await mkdir(priorRun, { recursive: true });
  await writeFile(
    join(priorRun, "learning-ledger.json"),
    JSON.stringify({
      promoted: [
        { lesson: "Always batch admin into Friday afternoons" },
        { lesson: "Protect 9-11am for deep work" },
        { lesson: "Third lesson — should NOT be loaded (limit 2)" },
      ],
    }),
  );
  const runDir = join(parent, "current-run");
  await mkdir(runDir, { recursive: true });

  const seen = {}; // node key -> system text seen by chat()
  setChatImpl(async (opts) => {
    if (opts.messages?.[0]?.content?.includes('Return {"ok":true}')) {
      return { ok: true, text: '{"ok":true}', parsed: { ok: true }, raw: null, provider: opts.provider, model: opts.model };
    }
    // Concatenate system blocks for inspection
    const sys = Array.isArray(opts.system) ? opts.system.map((b) => b.text).join("|") : (opts.system ?? "");
    // Identify node by the unique instruction text
    let key = "?";
    const userMsg = opts.messages[0].content;
    if (userMsg.includes("schedule-intake skill")) key = "intake";
    else if (userMsg.includes("Priority Strategist")) key = "triage";
    else if (userMsg.includes("Calendar Architect")) key = "time_block_plan";
    else if (userMsg.includes("decision log")) key = "decision_log";
    else if (userMsg.includes("Follow-up Operator")) key = "follow_up_plan";
    else if (userMsg.includes("Honesty Auditor")) key = "operating_risks";
    seen[key] = sys;
    const FAKE = '{"weekOf":"2026-W19","fixedEvents":[],"flexibleEvents":[],"baseline":{"deepWorkHours":0,"adminHours":0,"contextSwitches":0,"openLoopRisk":"low"},"notes":[],"topThree":[],"blocks":[],"decisions":[],"items":[],"missingOwners":[],"risks":[]}';
    return { ok: true, text: FAKE, parsed: JSON.parse(FAKE), raw: null, provider: opts.provider, model: opts.model };
  });

  try {
    const { transcript } = await mod.runChiefOfStaff({
      schedule: '{"weekOf":"2026-W19","events":[]}',
      goals: "test",
      allowCloud: "never",
      onEvent: () => {},
      runDir,
    });
    assert.equal(transcript.lessonsLoaded, 2, "should load exactly 2 promoted lessons (cap)");
    // triage and time_block_plan see the lessons; intake/decision_log/follow_up_plan/operating_risks must not.
    assert.match(seen.triage, /Promoted lessons/);
    assert.match(seen.time_block_plan, /Promoted lessons/);
    assert.doesNotMatch(seen.intake, /Promoted lessons/);
    assert.doesNotMatch(seen.decision_log, /Promoted lessons/);
    assert.doesNotMatch(seen.follow_up_plan, /Promoted lessons/);
    assert.doesNotMatch(seen.operating_risks, /Promoted lessons/);
    // Third lesson must not appear in any system text
    for (const k of Object.keys(seen)) {
      assert.doesNotMatch(seen[k], /Third lesson/, `${k} contains the over-limit lesson`);
    }
  } finally {
    setChatImpl(null);
    await rm(parent, { recursive: true, force: true });
  }
});

// ---------- G8: role-scoped briefs — triage does NOT see Calendar Architect content ----------

test("runChiefOfStaff: each role sees only its own scoped brief", async () => {
  const mod = await import("../lib/cos-runner.mjs");

  const seen = {};
  setChatImpl(async (opts) => {
    if (opts.messages?.[0]?.content?.includes('Return {"ok":true}')) {
      return { ok: true, text: '{"ok":true}', parsed: { ok: true }, raw: null, provider: opts.provider, model: opts.model };
    }
    const sys = Array.isArray(opts.system) ? opts.system.map((b) => b.text).join("|") : (opts.system ?? "");
    const userMsg = opts.messages[0].content;
    let key = "?";
    if (userMsg.includes("schedule-intake skill")) key = "intake";
    else if (userMsg.includes("Priority Strategist")) key = "triage";
    else if (userMsg.includes("Calendar Architect")) key = "time_block_plan";
    else if (userMsg.includes("decision log")) key = "decision_log";
    else if (userMsg.includes("Follow-up Operator")) key = "follow_up_plan";
    else if (userMsg.includes("Honesty Auditor")) key = "operating_risks";
    seen[key] = sys;
    const FAKE = '{"weekOf":"2026-W19","fixedEvents":[],"flexibleEvents":[],"baseline":{"deepWorkHours":0,"adminHours":0,"contextSwitches":0,"openLoopRisk":"low"},"notes":[],"topThree":[],"blocks":[],"decisions":[],"items":[],"missingOwners":[],"risks":[]}';
    return { ok: true, text: FAKE, parsed: JSON.parse(FAKE), raw: null, provider: opts.provider, model: opts.model };
  });

  const dir = await mkdtemp(join(tmpdir(), "cos-roles-"));
  try {
    await mod.runChiefOfStaff({
      schedule: '{"weekOf":"2026-W19","events":[]}',
      goals: "test",
      allowCloud: "never",
      onEvent: () => {},
      runDir: dir,
    });
    // The team brief (cached static block) names every role — that's
    // background context. The ROLE-SCOPED brief carries each role's mission +
    // guardrails and must NOT bleed into other roles. We check for unique
    // mission/guardrail strings, not role names.
    assert.match(seen.triage, /Pick the THREE weekly outcomes/);
    assert.doesNotMatch(seen.triage, /Arrange 5–9 named time blocks/);
    assert.doesNotMatch(seen.triage, /Flag missing owners, blocked decisions/);
    assert.match(seen.time_block_plan, /Arrange 5–9 named time blocks/);
    assert.doesNotMatch(seen.time_block_plan, /Pick the THREE weekly outcomes/);
    assert.match(seen.operating_risks, /Flag missing owners, blocked decisions/);
    assert.doesNotMatch(seen.operating_risks, /Pick the THREE weekly outcomes/);
    // Intake has no role mapping → no role brief at all
    assert.doesNotMatch(seen.intake, /Mission:/);
  } finally {
    setChatImpl(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("runChiefOfStaff: normalizes ICS input, injects feedback, passes seed, and emits quality scorecard", async () => {
  const mod = await import("../lib/cos-runner.mjs");

  const seen = {};
  const seeds = [];
  setChatImpl(async (opts) => {
    seeds.push(opts.seed);
    if (opts.messages?.[0]?.content?.includes('Return {"ok":true}')) {
      return { ok: true, text: '{"ok":true}', parsed: { ok: true }, raw: null, provider: opts.provider, model: opts.model };
    }
    const sys = Array.isArray(opts.system) ? opts.system.map((b) => b.text).join("|") : (opts.system ?? "");
    const userMsg = opts.messages[0].content;
    let key = "?";
    if (userMsg.includes("schedule-intake skill")) key = "intake";
    else if (userMsg.includes("Priority Strategist")) key = "triage";
    else if (userMsg.includes("Calendar Architect")) key = "time_block_plan";
    else if (userMsg.includes("decision log")) key = "decision_log";
    else if (userMsg.includes("Follow-up Operator")) key = "follow_up_plan";
    else if (userMsg.includes("Honesty Auditor")) key = "operating_risks";
    seen[key] = sys;

    const parsedByKey = {
      intake: {
        weekOf: "2026-06-15",
        fixedEvents: [],
        flexibleEvents: [],
        baseline: { deepWorkHours: 2, adminHours: 3, contextSwitches: 6, openLoopRisk: "medium" },
        notes: [],
      },
      triage: {
        topThree: [
          { outcome: "Ship migration review", owner: "Ty", leverageRationale: "Highest leverage", dueBy: "Friday" },
          { outcome: "Resolve partner ask", owner: "Sam", leverageRationale: "Blocks revenue", dueBy: "Wednesday" },
          { outcome: "Prepare board metric", owner: "Dana", leverageRationale: "Avoids late churn", dueBy: "Thursday" },
        ],
        rejected: [],
        notes: [],
      },
      time_block_plan: {
        blocks: [
          { day: "Monday", start: "09:00", end: "10:00", mode: "Deep work", why: "Protect focus" },
          { day: "Tuesday", start: "09:00", end: "10:00", mode: "Partner work", why: "Unblock ask" },
          { day: "Wednesday", start: "09:00", end: "10:00", mode: "Board metric", why: "Reduce churn" },
          { day: "Thursday", start: "09:00", end: "10:00", mode: "Review", why: "Close loop" },
          { day: "Friday", start: "09:00", end: "10:00", mode: "Learning review", why: "Promote lesson" },
        ],
        protectedHours: 5,
        contextSwitches: 4,
        tradeoffs: [],
      },
      decision_log: {
        decisions: [
          { title: "Migration scope", options: ["small", "full"], recommendation: "small", status: "needs approval", owner: "Ty" },
        ],
      },
      follow_up_plan: {
        items: [{ owner: "Sam", action: "Confirm partner ask", dueBy: "Wednesday", channel: "Slack" }],
        missingOwners: [],
      },
      operating_risks: {
        risks: [{ risk: "Context switching", severity: "medium", mitigation: "Batch admin" }],
        unverifiedClaims: [],
      },
    };
    const parsed = parsedByKey[key] ?? parsedByKey.intake;
    return { ok: true, text: JSON.stringify(parsed), parsed, raw: null, provider: opts.provider, model: opts.model };
  });

  const dir = await mkdtemp(join(tmpdir(), "cos-ics-feedback-"));
  try {
    const { transcript } = await mod.runChiefOfStaff({
      schedule: `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:fixture
DTSTART:20260615T090000
DTEND:20260615T100000
SUMMARY:Deep work on migration
END:VEVENT
END:VCALENDAR`,
      goals: "test",
      feedback: { actualFocus: "4 hours", followThrough: "missed partner follow-up" },
      seed: 42,
      allowCloud: "never",
      modelOverride: { provider: "ollama", model: "qwen3:8b-q4_K_M" },
      onEvent: () => {},
      runDir: dir,
    });
    assert.equal(transcript.input.schedule.sourceType, "ics");
    assert.equal(transcript.input.schedule.eventCount, 1);
    assert.equal(transcript.seed, 42);
    assert.ok(seeds.some((seed) => seed === 42), "node calls should receive deterministic seed");
    assert.match(seen.triage, /Weekly feedback/);
    assert.match(seen.time_block_plan, /missed partner follow-up/);
    assert.doesNotMatch(seen.intake, /Weekly feedback/);
    assert.equal(transcript.qualityScorecard.score, transcript.qualityScorecard.maxScore);
  } finally {
    setChatImpl(null);
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- G9: telemetry rows include role field ----------

test("runChiefOfStaff: telemetry rows carry role (or null for intake / _warmup / _run)", async () => {
  const mod = await import("../lib/cos-runner.mjs");

  setChatImpl(async (opts) => {
    if (opts.messages?.[0]?.content?.includes('Return {"ok":true}')) {
      return { ok: true, text: '{"ok":true}', parsed: { ok: true }, raw: null, provider: opts.provider, model: opts.model };
    }
    const FAKE = '{"weekOf":"2026-W19","fixedEvents":[],"flexibleEvents":[],"baseline":{"deepWorkHours":0,"adminHours":0,"contextSwitches":0,"openLoopRisk":"low"},"notes":[],"topThree":[],"blocks":[],"decisions":[],"items":[],"missingOwners":[],"risks":[]}';
    return { ok: true, text: FAKE, parsed: JSON.parse(FAKE), raw: null, provider: opts.provider, model: opts.model };
  });

  const dir = await mkdtemp(join(tmpdir(), "cos-rolerows-"));
  try {
    await mod.runChiefOfStaff({
      schedule: '{"weekOf":"2026-W19","events":[]}',
      goals: "test",
      allowCloud: "never",
      onEvent: () => {},
      runDir: dir,
    });
    const tel = (await readFile(join(dir, "telemetry.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    // Every row must have the role key (even if null).
    for (const r of tel) {
      assert.ok("role" in r, `row missing role field: ${JSON.stringify(r)}`);
    }
    // Triage rows must carry role="priority_strategist". Intake rows must carry role=null.
    const triageRows = tel.filter((r) => r.node === "triage");
    assert.ok(triageRows.length > 0);
    for (const r of triageRows) assert.equal(r.role, "priority_strategist");
    const intakeRows = tel.filter((r) => r.node === "intake");
    for (const r of intakeRows) assert.equal(r.role, null);
    // Honesty Auditor rows must carry role="honesty_auditor"
    const orRows = tel.filter((r) => r.node === "operating_risks");
    for (const r of orRows) assert.equal(r.role, "honesty_auditor");
  } finally {
    setChatImpl(null);
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------- F4: per-node tier honored end-to-end ----------

test("runChiefOfStaff: per-node tier produces different models in telemetry", async () => {
  const mod = await import("../lib/cos-runner.mjs");

  setChatImpl(async (opts) => {
    const fakeJson = '{"weekOf":"2026-W19","fixedEvents":[],"flexibleEvents":[],"baseline":{"deepWorkHours":0,"adminHours":0,"contextSwitches":0,"openLoopRisk":"low"},"notes":[],"topThree":[],"blocks":[],"decisions":[],"items":[],"missingOwners":[],"risks":[]}';
    return {
      ok: true,
      text: fakeJson,
      parsed: JSON.parse(fakeJson),
      raw: null,
      tokens_in: 100,
      tokens_out: 50,
      provider: opts.provider,
      model: opts.model,
    };
  });

  const dir = await mkdtemp(join(tmpdir(), "cos-tier-"));
  try {
    const { transcript } = await mod.runChiefOfStaff({
      schedule: '{"weekOf":"2026-W19","events":[]}',
      goals: "test",
      allowCloud: "never",
      onEvent: () => {},
      runDir: dir,
    });
    // intake = parse tier, triage = synthesis tier. The winning local model is
    // the tier's model for whichever local backend survived the health probe
    // (mlx if up, else ollama). The core invariant: per-tier model ids differ.
    const intakeTier = NODE_ROUTING.intake.tier;
    const triageTier = NODE_ROUTING.triage.tier;
    const intakeModels = [TIER_LOCAL_MODELS[intakeTier].mlx, TIER_LOCAL_MODELS[intakeTier].ollama, TIER_LOCAL_MODELS[intakeTier].ollamaFallback];
    const triageModels = [TIER_LOCAL_MODELS[triageTier].mlx, TIER_LOCAL_MODELS[triageTier].ollama, TIER_LOCAL_MODELS[triageTier].ollamaFallback];
    assert.ok(intakeModels.includes(transcript.nodes.intake.model), `intake model ${transcript.nodes.intake.model} not in parse tier`);
    assert.ok(triageModels.includes(transcript.nodes.triage.model), `triage model ${transcript.nodes.triage.model} not in synthesis tier`);
    assert.notEqual(
      transcript.nodes.intake.model,
      transcript.nodes.triage.model,
      "tier table collapsed — intake (parse) and triage (synthesis) should not share a model",
    );
  } finally {
    setChatImpl(null);
    await rm(dir, { recursive: true, force: true });
  }
});
