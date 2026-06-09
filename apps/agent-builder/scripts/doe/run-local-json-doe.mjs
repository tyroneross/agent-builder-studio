#!/usr/bin/env node
// Local-model JSON-adherence DOE: MLX lane vs Ollama lane.
//
// Makes the nightly-DOE contract REAL and manually invokable:
//   npm run doe:local-json            # live run against local backends
//   npm run doe:local-json -- --fixture   # deterministic, no LLM (tests/CI)
//
// The nightlyLocalDoe feature flag stays default-off; this runner only ever
// executes when a human invokes it. Design + analysis are delegated to the
// numpy-only engine copied from multi-goal (doe.py + objectives.py).
//
// Factors (2^3 full factorial, symmetric across backends — Ollama has no
// schema passthrough, so schema pressure is applied at the prompt level):
//   backend          ollama | mlx        (same 3B Llama weight class)
//   schema_in_prompt false  | true       (inline JSON schema vs terse field list)
//   strict_suffix    false  | true       ("ONLY JSON" hard suffix vs nothing)
//
// Responses per condition: pass_rate (maximize, weight .7) and
// mean_latency_ms (minimize, weight .3) over the task set x replicates.
//
// Output: evals/doe/local-json-passrate-<stamp>.json (design, raw per-task
// results, engine analysis, environment fingerprint).

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chat, probeMlx, probeOllama, DEFAULT_MLX_URL } from "@tyroneross/local-llm";
import { TASKS, buildTaskMessage, aggregateCondition } from "./tasks.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const ENGINE = join(HERE, "doe.py");

const OLLAMA_MODEL = process.env.DOE_OLLAMA_MODEL ?? "llama3.2:3b";
const MLX_MODEL = process.env.DOE_MLX_MODEL ?? "mlx-community/Llama-3.2-3B-Instruct-4bit";

const FACTORS = [
  { name: "backend", low: "ollama", high: "mlx" },
  { name: "schema_in_prompt", low: false, high: true },
  { name: "strict_suffix", low: false, high: true },
];

const OBJECTIVES = [
  { name: "pass_rate", direction: "higher", weight: 0.7 },
  { name: "mean_latency_ms", direction: "lower", weight: 0.3 },
];

const SYSTEM = "You are a structured-data extraction node inside a generated agent. Answer with JSON.";

function engineCall(args, input) {
  const res = spawnSync("python3", [ENGINE, ...args], {
    input: input != null ? JSON.stringify(input) : undefined,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(`doe.py ${args[0]} failed (${res.status}): ${res.stderr?.slice(0, 2000)}`);
  }
  return JSON.parse(res.stdout);
}

// Deterministic fixture chat: passes iff strict_suffix or schema_in_prompt is
// set for "mlx", and only with both for "ollama" — a stable, non-trivial
// pattern so tests can assert real effect ordering without an LLM.
function fixtureChat(condition) {
  return async ({ messages }) => {
    const text = messages[0]?.content ?? "";
    const schema = /schema/i.test(text);
    const strict = /ONLY the JSON object/.test(text);
    const passes = condition.backend === "mlx" ? (schema || strict) : (schema && strict);
    const task = TASKS.find((t) => text.startsWith(t.prompt.slice(0, 24)));
    const good = Object.fromEntries(
      Object.entries(task?.fields ?? {}).map(([k, t]) => [k, t === "number" ? 7 : "value"]),
    );
    return passes
      ? { ok: true, text: JSON.stringify(good), parsed: good, tokens_in: 10, tokens_out: 10, provider: condition.backend, model: "fixture" }
      : { ok: true, text: "Sure! Here is the data you asked for.", parsed: null, tokens_in: 10, tokens_out: 10, provider: condition.backend, model: "fixture" };
  };
}

async function runCondition(condition, { replicates, fixture, timeoutMs }) {
  const doChat = fixture ? fixtureChat(condition) : chat;
  const provider = condition.backend;
  const model = provider === "mlx" ? MLX_MODEL : OLLAMA_MODEL;
  const results = [];
  for (let r = 0; r < replicates; r += 1) {
    for (const task of TASKS) {
      const userMsg = buildTaskMessage(task, {
        schemaInPrompt: condition.schema_in_prompt,
        strictSuffix: condition.strict_suffix,
      });
      const t0 = Date.now();
      const envelope = await doChat({
        provider,
        model,
        system: SYSTEM,
        messages: [{ role: "user", content: userMsg }],
        timeoutMs,
      });
      results.push({ task, envelope, ms: Date.now() - t0 });
    }
  }
  return aggregateCondition(results);
}

async function main() {
  const argv = process.argv.slice(2);
  const fixture = argv.includes("--fixture");
  const replicates = Number(argv[argv.indexOf("--replicates") + 1]) || (fixture ? 1 : 3);
  const timeoutMs = 120000;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  // Backend health gates (live mode): a down backend fails loudly up front
  // rather than producing a half-design with silent zeros.
  let health = { mlx: null, ollama: null };
  if (!fixture) {
    health = { mlx: await probeMlx(), ollama: await probeOllama() };
    if (!health.ollama) throw new Error("Ollama is not reachable; start it before the DOE run.");
    if (!health.mlx) {
      throw new Error(
        `MLX server is not reachable at ${process.env.LOCAL_MLX_URL ?? DEFAULT_MLX_URL}. Start it with:\n` +
          `  mlx_lm.server --model ${MLX_MODEL} --port 8080`,
      );
    }
  }

  const tmpFactors = join("/tmp", `doe-factors-${stamp}.json`);
  writeFileSync(tmpFactors, JSON.stringify(FACTORS));
  const design = engineCall(["generate", "--factors", tmpFactors, "--seed", "42"]);
  const rows = design.runs;

  const measured = [];
  for (const row of rows) {
    const condition = row._factors;
    process.stderr.write(`condition ${JSON.stringify(condition)} ...\n`);
    const response = await runCondition(condition, { replicates, fixture, timeoutMs });
    measured.push({ run_id: row._run_id, factors: condition, values: { pass_rate: response.pass_rate, mean_latency_ms: response.mean_latency_ms }, detail: response });
    process.stderr.write(`  pass_rate=${response.pass_rate.toFixed(2)} mean_latency_ms=${response.mean_latency_ms}\n`);
  }

  const resultsJsonl = measured
    .map((m) => JSON.stringify({ run_id: m.run_id, values: m.values, guard_ok: true }))
    .join("\n");

  // analyze via the engine with multi-objective selection
  const tmpDesign = join("/tmp", `doe-design-${stamp}.json`);
  const tmpResults = join("/tmp", `doe-results-${stamp}.jsonl`);
  const tmpObjectives = join("/tmp", `doe-objectives-${stamp}.json`);
  writeFileSync(tmpDesign, JSON.stringify(design));
  writeFileSync(tmpResults, resultsJsonl);
  writeFileSync(tmpObjectives, JSON.stringify(OBJECTIVES));
  const analysis = engineCall([
    "analyze",
    "--design", tmpDesign,
    "--results", tmpResults,
    "--objectives", tmpObjectives,
    "--selection", "scalarize",
  ]);

  const packet = {
    schemaVersion: "agent-builder.local-json-doe.v1",
    ranAt: new Date().toISOString(),
    mode: fixture ? "fixture" : "live",
    engine: "scripts/doe/doe.py (multi-goal, numpy-only)",
    design: { type: design.design_type ?? "full factorial 2^3", seed: 42, factors: FACTORS },
    objectives: OBJECTIVES,
    models: { ollama: OLLAMA_MODEL, mlx: MLX_MODEL },
    replicates,
    tasksPerCondition: TASKS.length * replicates,
    environment: fixture ? { fixture: true } : { mlxHealthy: health.mlx, ollamaHealthy: health.ollama },
    runs: measured,
    analysis,
  };

  const outDir = join(ROOT, "evals", "doe");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `local-json-passrate-${fixture ? "fixture" : stamp}.json`);
  writeFileSync(outPath, JSON.stringify(packet, null, 2));
  console.log(outPath);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
