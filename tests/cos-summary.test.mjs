// Tests for lib/cos-summary.mjs — the digest used by both the CLI
// `--summary` output and the API `run-summary` SSE event.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { summarize, formatSummary, summarizeFile } from "../lib/cos-summary.mjs";

// ---------- fixture: a representative telemetry stream ----------

function fixtureRows() {
  return [
    // _run synthetic row carrying lessons_loaded
    {
      ts: "2026-05-08T10:00:00.000Z",
      node: "_run",
      role: null,
      attempt: 0,
      lane: "meta",
      provider: null,
      model: null,
      tokens_in: null,
      tokens_out: null,
      ms: 0,
      parsed_ok: true,
      fallback_reason: null,
      parse_retry: false,
      lessons_loaded: 2,
    },
    // _warmup synthetic row
    {
      ts: "2026-05-08T10:00:01.000Z",
      node: "_warmup",
      role: null,
      attempt: 1,
      lane: "warmup",
      provider: "ollama",
      model: "qwen3:8b-q4_K_M",
      tokens_in: 10,
      tokens_out: 5,
      ms: 1500,
      parsed_ok: true,
      fallback_reason: null,
      parse_retry: false,
    },
    // intake: local-primary fails, local-fallback succeeds
    {
      ts: "2026-05-08T10:00:02.000Z",
      node: "intake",
      role: "intake",
      attempt: 1,
      lane: "local-primary",
      provider: "ollama",
      model: "qwen3:8b-q4_K_M",
      tokens_in: null,
      tokens_out: null,
      ms: 200,
      parsed_ok: false,
      fallback_reason: "timeout",
      parse_retry: false,
      error: "timeout after 200ms",
    },
    {
      ts: "2026-05-08T10:00:03.000Z",
      node: "intake",
      role: "intake",
      attempt: 2,
      lane: "local-fallback",
      provider: "ollama",
      model: "llama3.2:3b",
      tokens_in: 1200,
      tokens_out: 480,
      ms: 3500,
      parsed_ok: true,
      fallback_reason: null,
      parse_retry: false,
    },
    // triage: parse retry, then succeeds on cloud
    {
      ts: "2026-05-08T10:00:07.000Z",
      node: "triage",
      role: "priority_strategist",
      attempt: 1,
      lane: "local-primary",
      provider: "ollama",
      model: "gemma4:26b",
      tokens_in: 800,
      tokens_out: 60,
      ms: 5000,
      parsed_ok: false,
      fallback_reason: "parse-failed",
      parse_retry: false,
    },
    {
      ts: "2026-05-08T10:00:12.000Z",
      node: "triage",
      role: "priority_strategist",
      attempt: 1,
      lane: "local-primary",
      provider: "ollama",
      model: "gemma4:26b",
      tokens_in: 850,
      tokens_out: 55,
      ms: 4800,
      parsed_ok: false,
      fallback_reason: "parse-failed",
      parse_retry: true,
    },
    {
      ts: "2026-05-08T10:00:18.000Z",
      node: "triage",
      role: "priority_strategist",
      attempt: 2,
      lane: "cloud",
      provider: "groq",
      model: "llama-3.3-70b-versatile",
      tokens_in: 800,
      tokens_out: 220,
      ms: 1100,
      parsed_ok: true,
      fallback_reason: null,
      parse_retry: false,
    },
    // time_block_plan: clean local-primary win
    {
      ts: "2026-05-08T10:00:20.000Z",
      node: "time_block_plan",
      role: "calendar_architect",
      attempt: 1,
      lane: "local-primary",
      provider: "ollama",
      model: "gemma4:26b",
      tokens_in: 1500,
      tokens_out: 700,
      ms: 8200,
      parsed_ok: true,
      fallback_reason: null,
      parse_retry: false,
    },
  ];
}

// ---------- summarize() shape ----------

test("summarize: per-node surfaces winner row, excludes synthetic nodes", () => {
  const s = summarize(fixtureRows());
  const nodes = s.perNode.map((n) => n.node);
  assert.deepEqual(nodes, ["intake", "triage", "time_block_plan"]);
  assert.equal(s.perNode.find((n) => n.node === "intake").lane, "local-fallback");
  assert.equal(s.perNode.find((n) => n.node === "triage").lane, "cloud");
  assert.equal(s.perNode.find((n) => n.node === "triage").provider, "groq");
});

test("summarize: parsed_ok winners reflect successful attempts", () => {
  const s = summarize(fixtureRows());
  for (const n of s.perNode) assert.equal(n.parsed_ok, true);
});

test("summarize: totals aggregate across all rows including warmup + retries", () => {
  const s = summarize(fixtureRows());
  // ms: 0 + 1500 + 200 + 3500 + 5000 + 4800 + 1100 + 8200 = 24300
  assert.equal(s.totals.total_ms, 24300);
  // tokens_in: 10 + 1200 + 800 + 850 + 800 + 1500 = 5160
  assert.equal(s.totals.total_tokens_in, 5160);
  // tokens_out: 5 + 480 + 60 + 55 + 220 + 700 = 1520
  assert.equal(s.totals.total_tokens_out, 1520);
  assert.equal(s.totals.parse_retries, 1);
  assert.equal(s.totals.lessons_loaded, 2);
  assert.equal(s.totals.cloud_calls, 1);
  assert.equal(s.totals.node_count, 3);
});

test("summarize: tolerates empty / non-array input", () => {
  assert.deepEqual(summarize([]).perNode, []);
  assert.deepEqual(summarize(null).perNode, []);
  assert.deepEqual(summarize(undefined).perNode, []);
});

test("summarize: failed-only node surfaces its last attempt with parsed_ok=false", () => {
  const rows = [
    {
      node: "intake",
      attempt: 1,
      lane: "local-primary",
      provider: "ollama",
      model: "x",
      ms: 100,
      parsed_ok: false,
      fallback_reason: "http-error",
    },
    {
      node: "intake",
      attempt: 2,
      lane: "local-fallback",
      provider: "ollama",
      model: "y",
      ms: 200,
      parsed_ok: false,
      fallback_reason: "timeout",
    },
  ];
  const s = summarize(rows);
  assert.equal(s.perNode.length, 1);
  assert.equal(s.perNode[0].parsed_ok, false);
  assert.equal(s.perNode[0].lane, "local-fallback");
  assert.equal(s.perNode[0].fallback_reason, "timeout");
});

// ---------- formatSummary() output ----------

test("formatSummary: includes totals headline and per-node rows", () => {
  const s = summarize(fixtureRows());
  const text = formatSummary(s);
  assert.match(text, /=== Run summary ===/);
  assert.match(text, /totals: 24300ms/);
  assert.match(text, /lessons_loaded=2/);
  assert.match(text, /cloud_calls=1/);
  assert.match(text, /intake\s+ok/);
  assert.match(text, /triage\s+ok\s+\d+ms\s+cloud/);
});

// ---------- summarizeFile() — reads JSONL ----------

test("summarizeFile: reads telemetry.jsonl and tolerates partial lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cos-summary-"));
  try {
    const path = join(dir, "telemetry.jsonl");
    const rows = fixtureRows();
    const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n{partial-line\n";
    await writeFile(path, text, "utf8");
    const s = await summarizeFile(path);
    assert.equal(s.perNode.length, 3);
    assert.equal(s.totals.cloud_calls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("summarizeFile: missing file returns an empty summary", async () => {
  const s = await summarizeFile("/nonexistent/path/to/telemetry.jsonl");
  assert.deepEqual(s.perNode, []);
  assert.equal(s.totals.node_count, 0);
});
