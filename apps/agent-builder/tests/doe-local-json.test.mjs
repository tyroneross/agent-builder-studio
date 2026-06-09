// Colocated tests for the local-JSON DOE capability (scripts/doe/).
// Engine roundtrip runs the real doe.py via python3; the runner test executes
// the full fixture pipeline (no LLM, no network).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { TASKS, buildTaskMessage, scoreTask, aggregateCondition } from "../scripts/doe/tasks.mjs";

const ROOT = process.cwd();
const ENGINE = join(ROOT, "scripts", "doe", "doe.py");

test("tasks: buildTaskMessage applies schema and strict-suffix factors", () => {
  const bare = buildTaskMessage(TASKS[0], { schemaInPrompt: false, strictSuffix: false });
  assert.ok(!/matching this schema/.test(bare));
  assert.ok(!/ONLY the JSON object/.test(bare));
  const loaded = buildTaskMessage(TASKS[0], { schemaInPrompt: true, strictSuffix: true });
  assert.ok(/matching this schema/.test(loaded));
  assert.ok(/"required"/.test(loaded));
  assert.ok(/ONLY the JSON object/.test(loaded));
});

test("tasks: scoreTask enforces required fields and types (numeric strings pass)", () => {
  const task = TASKS.find((t) => t.id === "meeting-extract");
  assert.equal(scoreTask(task, null).pass, false);
  assert.equal(scoreTask(task, []).pass, false);
  assert.equal(scoreTask(task, { title: "x", attendee: "Dana" }).pass, false, "missing field fails");
  assert.equal(scoreTask(task, { title: "x", attendee: "Dana", duration_minutes: "45" }).pass, true, "numeric string coerces");
  assert.equal(scoreTask(task, { title: 5, attendee: "Dana", duration_minutes: 45 }).pass, false, "wrong type fails");
});

test("tasks: aggregateCondition computes pass rate, latency, failures", () => {
  const task = TASKS[0];
  const good = { title: "t", attendee: "a", duration_minutes: 45 };
  const rows = [
    { task, envelope: { ok: true, parsed: good }, ms: 100 },
    { task, envelope: { ok: true, parsed: null }, ms: 300 },
    { task, envelope: { ok: false, reason: "timeout" }, ms: 200 },
  ];
  const agg = aggregateCondition(rows);
  assert.equal(agg.passes, 1);
  assert.equal(agg.total, 3);
  assert.ok(Math.abs(agg.pass_rate - 1 / 3) < 1e-9);
  assert.equal(agg.mean_latency_ms, 200);
  assert.equal(agg.failures.length, 2);
});

test("doe.py engine: generate -> analyze multi-objective roundtrip", () => {
  const factors = [
    { name: "a", low: false, high: true },
    { name: "b", low: false, high: true },
  ];
  const fPath = join("/tmp", `doe-test-factors-${process.pid}.json`);
  writeFileSync(fPath, JSON.stringify(factors));
  const gen = spawnSync("python3", [ENGINE, "generate", "--factors", fPath, "--seed", "1"], { encoding: "utf8" });
  assert.equal(gen.status, 0, gen.stderr);
  const design = JSON.parse(gen.stdout);
  assert.equal(design.design.n_runs, 4, "2^2 full factorial");
  assert.equal(design.runs.length, 4);
  assert.ok(design.runs.every((r) => typeof r._factors.a === "boolean"));

  // Synthetic response: y = a + small noise-free b effect; minimize cost.
  const dPath = join("/tmp", `doe-test-design-${process.pid}.json`);
  const rPath = join("/tmp", `doe-test-results-${process.pid}.jsonl`);
  const oPath = join("/tmp", `doe-test-objectives-${process.pid}.json`);
  writeFileSync(dPath, gen.stdout);
  const lines = design.runs.map((r) =>
    JSON.stringify({
      run_id: r._run_id,
      values: { score: (r._factors.a ? 1 : 0) + (r._factors.b ? 0.25 : 0), cost: r._factors.a ? 2 : 1 },
      guard_ok: true,
    }),
  );
  writeFileSync(rPath, lines.join("\n"));
  writeFileSync(oPath, JSON.stringify([
    { name: "score", direction: "higher", weight: 0.8 },
    { name: "cost", direction: "lower", weight: 0.2 },
  ]));
  const an = spawnSync(
    "python3",
    [ENGINE, "analyze", "--design", dPath, "--results", rPath, "--objectives", oPath, "--selection", "scalarize"],
    { encoding: "utf8" },
  );
  assert.equal(an.status, 0, an.stderr);
  const analysis = JSON.parse(an.stdout);
  const scoreEffects = analysis.per_objective.score.ranked_effects;
  assert.equal(scoreEffects[0].term, "a", "factor a dominates the score objective");
  for (const p of [fPath, dPath, rPath, oPath]) rmSync(p, { force: true });
});

test("runner --fixture executes the full pipeline and writes a packet", () => {
  const res = spawnSync("node", [join(ROOT, "scripts", "doe", "run-local-json-doe.mjs"), "--fixture"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  assert.equal(res.status, 0, res.stderr);
  const outPath = res.stdout.trim().split("\n").pop();
  const packet = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(packet.schemaVersion, "agent-builder.local-json-doe.v1");
  assert.equal(packet.mode, "fixture");
  assert.equal(packet.runs.length, 8, "2^3 full factorial");
  assert.ok(packet.analysis.per_objective.pass_rate, "multi-objective analysis present");
  // Fixture oracle: mlx passes with schema OR strict; ollama needs both.
  const mlxLoose = packet.runs.find((r) => r.factors.backend === "mlx" && r.factors.schema_in_prompt && !r.factors.strict_suffix);
  const ollamaLoose = packet.runs.find((r) => r.factors.backend === "ollama" && r.factors.schema_in_prompt && !r.factors.strict_suffix);
  assert.equal(mlxLoose.values.pass_rate, 1);
  assert.equal(ollamaLoose.values.pass_rate, 0);
});
