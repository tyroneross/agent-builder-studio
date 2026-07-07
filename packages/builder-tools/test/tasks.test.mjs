import test from "node:test";
import assert from "node:assert/strict";

import {
  TASKS,
  buildTaskMessage,
  scoreTask,
  aggregateCondition,
} from "../index.mjs";

test("buildTaskMessage applies schema and strict-suffix factors", () => {
  const bare = buildTaskMessage(TASKS[0], { schemaInPrompt: false, strictSuffix: false });
  assert.ok(!bare.includes("matching this schema"));
  assert.ok(!bare.includes("ONLY the JSON object"));

  const loaded = buildTaskMessage(TASKS[0], { schemaInPrompt: true, strictSuffix: true });
  assert.ok(loaded.includes("matching this schema"));
  assert.ok(loaded.includes("\"required\""));
  assert.ok(loaded.includes("ONLY the JSON object"));
});

test("scoreTask enforces required fields and types", () => {
  const task = TASKS.find((item) => item.id === "meeting-extract");
  assert.equal(scoreTask(task, null).pass, false);
  assert.equal(scoreTask(task, []).pass, false);
  assert.equal(scoreTask(task, { title: "x", attendee: "Dana" }).pass, false);
  assert.equal(
    scoreTask(task, { title: "x", attendee: "Dana", duration_minutes: "45" }).pass,
    true,
  );
  assert.equal(
    scoreTask(task, { title: 5, attendee: "Dana", duration_minutes: 45 }).pass,
    false,
  );
});

test("aggregateCondition computes pass rate, latency, and failures", () => {
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
  assert.deepEqual(agg.failures, [
    { task: task.id, reason: "not-a-json-object" },
    { task: task.id, reason: "timeout" },
  ]);
});
