// JSON-adherence task set + pure scoring for the local-model DOE.
// Pure module (no I/O, no LLM calls) so tests can exercise scoring directly.
//
// Each task: a realistic schema-constrained extraction/structuring ask of the
// kind generated agents issue against the parse/mid tiers. `requiredFields`
// is the pass oracle: a response passes when it is valid JSON (envelope
// .parsed != null) AND every required field is present with the right type.

export const TASKS = [
  {
    id: "meeting-extract",
    prompt:
      "Extract the meeting from this note: 'Sync with Dana about the Q3 roadmap next Tuesday at 2pm, 45 minutes, bring the metrics deck.'",
    fields: { title: "string", attendee: "string", duration_minutes: "number" },
  },
  {
    id: "task-triage",
    prompt:
      "Triage this request into a ticket: 'The export button on the billing page throws a 500 when the date range is over 90 days. Customers are blocked.'",
    fields: { summary: "string", severity: "string", component: "string" },
  },
  {
    id: "schedule-parse",
    prompt:
      "Parse this schedule line: '9:30-10:15 standup with platform team (daily)'.",
    fields: { start: "string", end: "string", event: "string" },
  },
  {
    id: "contact-extract",
    prompt:
      "Extract the contact: 'Reach out to Maria Chen, VP Engineering at Northwind (maria.chen@northwind.io), about the pilot.'",
    fields: { name: "string", company: "string", email: "string" },
  },
  {
    id: "decision-structure",
    prompt:
      "Structure this decision: 'We chose Postgres over DynamoDB because the access patterns are relational and the team knows SQL; revisit if we exceed 10k writes/sec.'",
    fields: { decision: "string", rationale: "string", revisit_trigger: "string" },
  },
  {
    id: "metric-extract",
    prompt:
      "Extract the metric: 'Weekly active users grew 12% to 48,200 in the last week of May.'",
    fields: { metric_name: "string", value: "number", change_percent: "number" },
  },
];

// Build the user message for a task under a given factor condition.
//   schemaInPrompt: inline a JSON-schema-ish field spec (high) vs terse field list (low)
//   strictSuffix:   append a hard "ONLY JSON" instruction (high) vs nothing (low)
export function buildTaskMessage(task, { schemaInPrompt, strictSuffix }) {
  const parts = [task.prompt, ""];
  if (schemaInPrompt) {
    const props = Object.fromEntries(
      Object.entries(task.fields).map(([k, t]) => [k, { type: t }]),
    );
    parts.push(
      "Respond with JSON matching this schema:",
      JSON.stringify({ type: "object", properties: props, required: Object.keys(task.fields) }),
    );
  } else {
    parts.push(`Respond with a JSON object with fields: ${Object.keys(task.fields).join(", ")}.`);
  }
  if (strictSuffix) {
    parts.push("", "Return ONLY the JSON object. No prose, no markdown fences, no explanation.");
  }
  return parts.join("\n");
}

// Pass oracle: parsed JSON object with every required field present and
// type-correct. Numbers accept numeric strings ("12" passes number) — local
// 3B models often quote numerics and downstream consumers coerce.
export function scoreTask(task, parsed) {
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { pass: false, reason: "not-a-json-object" };
  }
  for (const [field, type] of Object.entries(task.fields)) {
    const v = parsed[field];
    if (v == null) return { pass: false, reason: `missing-field:${field}` };
    if (type === "number") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return { pass: false, reason: `not-a-number:${field}` };
    } else if (typeof v !== type) {
      return { pass: false, reason: `wrong-type:${field}` };
    }
  }
  return { pass: true, reason: null };
}

// Aggregate one DOE condition's task envelopes into the response row the
// analyzer consumes. `results` is [{task, envelope, ms}].
export function aggregateCondition(results) {
  let passes = 0;
  let totalMs = 0;
  const failures = [];
  for (const { task, envelope, ms } of results) {
    const verdict = envelope?.ok ? scoreTask(task, envelope.parsed) : { pass: false, reason: envelope?.reason ?? "call-failed" };
    if (verdict.pass) passes += 1;
    else failures.push({ task: task.id, reason: verdict.reason });
    totalMs += ms ?? 0;
  }
  const n = results.length || 1;
  return {
    pass_rate: passes / n,
    mean_latency_ms: Math.round(totalMs / n),
    passes,
    total: results.length,
    failures,
  };
}
