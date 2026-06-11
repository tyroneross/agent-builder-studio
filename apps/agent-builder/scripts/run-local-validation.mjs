#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AGENT_STRUCTURES } from "../agent-structures/index.js";
import { runAgentStructure } from "../sandbox/runner.js";
import { buildLocalValidationScorecard } from "../sandbox/local-validation-scorecard.js";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

const HELP = `
Agent Builder local validation runner

USAGE
  node scripts/run-local-validation.mjs [flags]

FLAGS
  --llm <mode>              fixture | auto | ollama. Default: ollama.
  --model <name>            Ollama model name.
  --root <dir>              Sandbox output root. Default: ./runs/local-validation/<timestamp>/sandbox.
  --state <path>            Resume state path. Default: <root>/validation-state.json.
  --chunk-size <n>          Run only the next n pending structures.
  --scenario-limit <n>      Pass through to the sandbox runner.
  --structures <a,b,c>      Limit to structure IDs.
  --continue-on-error       Keep going after a structure failure.
  --json                    Print final state JSON.
  --help                    Show this banner.
`;

if (hasFlag("--help") || hasFlag("-h")) {
  process.stdout.write(HELP.trim() + "\n");
  process.exit(0);
}

const llmMode = readFlag("--llm") ?? "ollama";
const model = readFlag("--model");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const root = resolve(readFlag("--root") ?? join(ROOT, "runs", "local-validation", timestamp, "sandbox"));
const statePath = resolve(readFlag("--state") ?? join(root, "validation-state.json"));
const chunkSizeRaw = Number(readFlag("--chunk-size"));
const chunkSize = Number.isInteger(chunkSizeRaw) && chunkSizeRaw > 0 ? chunkSizeRaw : Infinity;
const scenarioLimit = readFlag("--scenario-limit");
const selectedIds = new Set((readFlag("--structures") ?? "").split(",").map((item) => item.trim()).filter(Boolean));
const continueOnError = hasFlag("--continue-on-error");
const json = hasFlag("--json");

const structures = selectedIds.size
  ? AGENT_STRUCTURES.filter((structure) => selectedIds.has(structure.id))
  : AGENT_STRUCTURES;

if (structures.length === 0) {
  throw new Error("No matching structures selected.");
}

await mkdir(root, { recursive: true });
const state = await loadState(statePath) ?? {
  schemaVersion: "agent-builder.local-validation.v1",
  startedAt: new Date().toISOString(),
  root,
  llmMode,
  model: model ?? null,
  scenarioLimit: scenarioLimit ?? null,
  selectedStructures: structures.map((structure) => structure.id),
  results: {},
  runOrder: [],
};

const pending = structures.filter((structure) => !state.results[structure.id]).slice(0, chunkSize);

if (!json) {
  console.log(`[local-validation] state=${statePath}`);
  console.log(`[local-validation] root=${root}`);
  console.log(`[local-validation] pending=${pending.length}/${structures.length}`);
}

for (const structure of pending) {
  if (!json) console.log(`[local-validation] running ${structure.id}`);
  try {
    const result = await runAgentStructure(structure, {
      root,
      llmMode,
      model,
      scenarioLimit,
    });
    state.results[structure.id] = result;
    state.runOrder.push(structure.id);
    await saveState(statePath, refreshSummary(state, structures));
  } catch (error) {
    const result = {
      id: structure.id,
      label: structure.label,
      passed: false,
      score: 0,
      maxScore: 0,
      errors: [error?.message ?? String(error)],
      scenarios: [],
      provider: llmMode,
      model: model ?? "none",
      outputDir: null,
      files: [],
    };
    state.results[structure.id] = result;
    state.runOrder.push(structure.id);
    await saveState(statePath, refreshSummary(state, structures));
    if (!continueOnError) throw error;
  }
}

refreshSummary(state, structures);
await saveState(statePath, state);

if (json) {
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
} else {
  console.log(`[local-validation] completed=${state.summary.completed}/${state.summary.total}`);
  console.log(`[local-validation] passed=${state.summary.passed}/${state.summary.completed}`);
  console.log(`[local-validation] score=${state.summary.score}/${state.summary.maxScore}`);
  console.log(`[local-validation] scorecard=${state.qualityScorecard.score}/${state.qualityScorecard.maxScore} ${state.qualityScorecard.status}`);
}

if (state.summary.failed > 0) process.exitCode = 1;

function refreshSummary(state, structures) {
  const results = structures.map((structure) => state.results[structure.id]).filter(Boolean);
  const passed = results.filter((result) => result.passed).length;
  const score = results.reduce((sum, result) => sum + Number(result.score ?? 0), 0);
  const maxScore = results.reduce((sum, result) => sum + Number(result.maxScore ?? 0), 0);
  state.updatedAt = new Date().toISOString();
  state.summary = {
    total: structures.length,
    completed: results.length,
    pending: structures.length - results.length,
    passed,
    failed: results.length - passed,
    score,
    maxScore,
    scorePercent: maxScore ? Math.round((score / maxScore) * 1000) / 10 : 0,
  };
  state.qualityScorecard = buildLocalValidationScorecard(results);
  return state;
}

async function loadState(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, "utf8"));
}

async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function readFlag(name) {
  const prefix = `${name}=`;
  const equal = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (equal) return equal.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}
