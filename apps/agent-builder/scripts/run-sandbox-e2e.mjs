#!/usr/bin/env node
import { AGENT_STRUCTURES } from "../agent-structures/index.js";
import { runSandboxSuite } from "@tyroneross/builder-tools";
import { writeAgentArtifacts } from "../lib/build-files.js";

const args = new Set(process.argv.slice(2));
const scoreOnly = args.has("--score");
const json = args.has("--json");
const llmMode = readFlag("--llm") ?? process.env.AGENT_BUILDER_LLM ?? "auto";
const model = readFlag("--model") ?? process.env.OLLAMA_MODEL;
const scenarioLimit = readFlag("--scenario-limit");

try {
  const result = await runSandboxSuite(AGENT_STRUCTURES, { llmMode, model, scenarioLimit, writeAgentArtifacts });
  if (scoreOnly) {
    process.stdout.write(`${result.score}\n`);
  } else if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    console.log(`Sandbox root: ${result.root}`);
    console.log(`Passed: ${result.passed}/${result.total}`);
    console.log(`Scenarios: ${result.totalScenarios}`);
    console.log(`Score: ${result.score}/${result.maxScore} (${result.scorePercent}%)`);
    for (const item of result.results) {
      const mark = item.passed ? "PASS" : "FAIL";
      console.log(`${mark} ${item.label} (${item.provider}:${item.model}) score=${item.score}/${item.maxScore}`);
      for (const error of item.errors) console.log(`  - ${error}`);
    }
  }

  process.exit(result.failed === 0 ? 0 : 1);
} catch (error) {
  if (scoreOnly) {
    process.stdout.write("0\n");
  } else {
    console.error(error instanceof Error ? error.message : error);
  }
  process.exit(1);
}

function readFlag(name) {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}
