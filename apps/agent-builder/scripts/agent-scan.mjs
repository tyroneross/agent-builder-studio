#!/usr/bin/env node
import { AGENT_STRUCTURES } from "../agent-structures/index.js";
import { buildAgentArtifacts } from "@tyroneross/agent-pack";
import { validateStructureAgainstResearch, validateStructuresAgainstResearch } from "../lib/research-validation.js";
import { runSandboxSuite } from "../sandbox/runner.js";

const args = new Set(process.argv.slice(2));
const run = args.has("--run") || args.has("--e2e");
const json = args.has("--json");
const llmMode = readFlag("--llm") ?? (run ? "auto" : "fixture");
const model = readFlag("--model");
const scenarioLimit = readFlag("--scenario-limit");

const staticRows = AGENT_STRUCTURES.map((structure) => {
  const artifacts = buildAgentArtifacts(structure.spec, { createdAt: "scan" });
  const research = validateStructureAgainstResearch(structure);
  return {
    id: structure.id,
    label: structure.label,
    category: structure.category,
    nodes: structure.spec.nodes.length,
    edges: structure.spec.edges.length,
    tools: structure.spec.tools.length,
    evals: structure.spec.evals.length,
    learning: structure.spec.learning?.domain ?? "none",
    scenarios: structure.sandbox.scenarios?.length ?? 1,
    artifacts: artifacts.files.length,
    expectedSandboxArtifacts: structure.sandbox.expectedArtifacts.length,
    researchAligned: research.passed,
    researchFailures: research.checks.filter((check) => !check.passed).map((check) => check.id),
  };
});

let e2e = null;
const researchValidation = validateStructuresAgainstResearch(AGENT_STRUCTURES);
if (run) {
  e2e = await runSandboxSuite(AGENT_STRUCTURES, { llmMode, model, scenarioLimit });
}

if (json) {
  console.log(JSON.stringify({ structures: staticRows, researchValidation, e2e }, null, 2));
} else {
  console.log(`Agent structures: ${staticRows.length}`);
  for (const row of staticRows) {
    console.log(
      `- ${row.label}: ${row.nodes} nodes, ${row.edges} edges, ${row.tools} tools, ${row.evals} evals, ${row.artifacts} generated files, research=${row.researchAligned ? "pass" : `fail:${row.researchFailures.join(",")}`}`,
    );
    console.log(`  learning=${row.learning}; scenarios=${row.scenarios}`);
  }
  console.log(`\nResearch validation: ${researchValidation.passed}/${researchValidation.total} passed`);
  if (e2e) {
    console.log(`\nSandbox e2e: ${e2e.passed}/${e2e.total} passed`);
    console.log(`Scenarios: ${e2e.totalScenarios}`);
    console.log(`Score: ${e2e.score}/${e2e.maxScore} (${e2e.scorePercent}%)`);
    console.log(`Sandbox root: ${e2e.root}`);
    for (const item of e2e.results) {
      console.log(`  ${item.passed ? "PASS" : "FAIL"} ${item.label} (${item.provider}:${item.model}) score=${item.score}/${item.maxScore}`);
    }
  }
}

if (e2e?.failed) process.exit(1);
if (researchValidation.failed) process.exit(1);

function readFlag(name) {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : undefined;
}
