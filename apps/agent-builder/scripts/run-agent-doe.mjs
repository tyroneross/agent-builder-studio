#!/usr/bin/env node
import { AGENT_STRUCTURES } from "../agent-structures/index.js";
import { runSandboxSuite } from "@tyroneross/builder-tools";
import { writeAgentArtifacts } from "../lib/build-files.js";

const args = new Set(process.argv.slice(2));
const json = args.has("--json");
const llmMode = readFlag("--llm") ?? "fixture";
const model = readFlag("--model");
const scenarioLimit = readFlag("--scenario-limit");

const FACTORS = [
  {
    id: "acceptanceCriteria",
    low: false,
    high: true,
    description: "Artifacts include explicit acceptance criteria.",
  },
  {
    id: "permissionInvariants",
    low: false,
    high: true,
    description: "Artifacts include sandbox permission invariants.",
  },
  {
    id: "reflectionPrompts",
    low: false,
    high: true,
    description: "Artifacts include domain-learning reflection prompts.",
  },
];

const runs = [];
for (const factors of fullFactorial(FACTORS)) {
  const result = await runSandboxSuite(AGENT_STRUCTURES, {
    llmMode,
    model,
    scenarioLimit,
    artifactProfile: factors,
    writeAgentArtifacts,
  });
  runs.push({
    factors,
    score: result.score,
    maxScore: result.maxScore,
    scorePercent: result.scorePercent,
    passed: result.passed,
    failed: result.failed,
    totalScenarios: result.totalScenarios,
  });
}

const best = [...runs].sort((a, b) => b.score - a.score)[0];
const effects = mainEffects(FACTORS, runs);
const output = {
  design: "2^3 full factorial",
  response: "sandbox score",
  llmMode,
  model: model ?? null,
  factors: FACTORS,
  best,
  effects,
  runs,
};

if (json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(`DOE design: ${output.design}`);
  console.log(`Response: ${output.response}`);
  console.log(`Runs: ${runs.length}`);
  console.log(`Best score: ${best.score}/${best.maxScore} (${best.scorePercent}%)`);
  console.log(`Best factors: ${formatFactors(best.factors)}`);
  console.log("\nMain effects:");
  for (const effect of effects) {
    console.log(`- ${effect.factor}: ${effect.effect >= 0 ? "+" : ""}${effect.effect.toFixed(2)} score points`);
  }
  console.log("\nRuns:");
  for (const run of runs) {
    console.log(`- ${formatFactors(run.factors)} => ${run.score}/${run.maxScore} (${run.scorePercent}%)`);
  }
}

function fullFactorial(factors) {
  return factors.reduce((rows, factor) => (
    rows.flatMap((row) => [
      { ...row, [factor.id]: factor.low },
      { ...row, [factor.id]: factor.high },
    ])
  ), [{}]);
}

function mainEffects(factors, runs) {
  return factors.map((factor) => {
    const high = runs.filter((run) => run.factors[factor.id] === factor.high);
    const low = runs.filter((run) => run.factors[factor.id] === factor.low);
    return {
      factor: factor.id,
      effect: average(high.map((run) => run.score)) - average(low.map((run) => run.score)),
      description: factor.description,
    };
  }).sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect));
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatFactors(factors) {
  return Object.entries(factors)
    .map(([key, value]) => `${key}=${value ? "high" : "low"}`)
    .join(", ");
}

function readFlag(name) {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}
