#!/usr/bin/env node
// Self-consistency test for the agent-studio runtime.
//
// What this asserts:
//   1. Topology: planExecution() produces the expected level layout for the
//      seed graph (no cycle).
//   2. Headless run: every node emits node-end with parsed != null.
//   3. Brief contains a section per node.
//   4. Run artifacts (transcript.json + brief.md) are written to a tmp dir.
//
// Skip behavior: if Ollama isn't reachable at $OLLAMA_BASE_URL/api/tags, this
// script prints a clear message and exits 0. That's acceptable inside CI /
// the build-loop orchestrator's environment.
//
// Exit codes: 0 = pass or skip. 1 = test failure.

import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { runProject, planExecution } from "../app/lib/agent-runtime.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const MODEL = process.env.OLLAMA_MODEL || "gpt-oss:20b";
const QUERY = "Plan the rollout of a new internal tool.";

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK   ${msg}`);
}

async function ollamaReachable() {
  try {
    const res = await fetch(`${BASE_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return Array.isArray(body?.models);
  } catch {
    return false;
  }
}

async function main() {
  const fixturePath = path.join(__dirname, "..", "test", "fixtures", "seed-project.json");
  const project = JSON.parse(await fs.readFile(fixturePath, "utf8"));

  // Pre-flight: topology check (no cycle, every node placed).
  const plan = planExecution(project);
  const placedCount = plan.levels.reduce((acc, lvl) => acc + lvl.length, 0);
  if (placedCount !== project.canvas.nodes.length) {
    fail(`topology placed ${placedCount} nodes, expected ${project.canvas.nodes.length}`);
  }
  ok(`topology: ${plan.levels.length} levels, ${placedCount} nodes`);

  if (!(await ollamaReachable())) {
    console.log(`SKIP: ollama not reachable at ${BASE_URL}/api/tags`);
    console.log(`SKIP: set OLLAMA_BASE_URL or start ollama to run the headless self-test`);
    process.exit(0);
  }

  // Use a tmp dir as working folder so artifact writes are isolated.
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-test-"));
  project.workingFolder = tmpRoot;

  const events = [];
  const onEvent = (evt) => {
    events.push(evt);
  };

  let runResult;
  try {
    runResult = await runProject({
      project,
      query: QUERY,
      model: MODEL,
      baseUrl: BASE_URL,
      onEvent,
    });
  } catch (err) {
    fail(`runProject threw: ${err?.message || err}`);
  }

  const { transcript, brief } = runResult;

  // Persist artifacts the way the route would, so we can assert their shape.
  const runDir = path.join(tmpRoot, "runs", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, "transcript.json"), JSON.stringify(transcript, null, 2));
  await fs.writeFile(path.join(runDir, "brief.md"), brief);

  // Assertion: every node has parsed != null and no error.
  const nodeEndsById = new Map();
  for (const evt of events) {
    if (evt.type === "node-end") nodeEndsById.set(evt.id, evt);
  }
  for (const node of project.canvas.nodes) {
    const evt = nodeEndsById.get(node.id);
    if (!evt) fail(`node ${node.id} did not emit node-end`);
    if (evt.parsed == null) {
      fail(`node ${node.id} parsed JSON is null (model returned non-JSON or empty body)`);
    }
  }
  ok(`all ${project.canvas.nodes.length} nodes emitted node-end with parsed JSON`);

  // Assertion: brief contains a section per node (## <title>).
  for (const node of project.canvas.nodes) {
    if (!brief.includes(`## ${node.title}`)) {
      fail(`brief missing section for "${node.title}"`);
    }
  }
  ok(`brief contains a section per node`);

  // Assertion: artifacts on disk.
  const transcriptStat = await fs.stat(path.join(runDir, "transcript.json"));
  const briefStat = await fs.stat(path.join(runDir, "brief.md"));
  if (!transcriptStat.size) fail("transcript.json is empty");
  if (!briefStat.size) fail("brief.md is empty");
  ok(`artifacts written to ${runDir}`);

  console.log("");
  console.log("Summary:");
  console.log(`  model:     ${transcript.model}`);
  console.log(`  levels:    ${transcript.levels.map((l) => l.length).join(",")}`);
  console.log(`  nodes:     ${transcript.nodes.length}`);
  console.log(`  total ms:  ${transcript.nodes.reduce((s, n) => s + (n.durationMs || 0), 0)}`);
  console.log(`  artifacts: ${runDir}`);

  process.exit(0);
}

main().catch((err) => {
  fail(`unexpected: ${err?.stack || err?.message || err}`);
});
