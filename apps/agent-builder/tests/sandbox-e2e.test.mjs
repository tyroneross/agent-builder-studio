import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_STRUCTURES } from "../agent-structures/index.js";
import { validateStructureAgainstResearch, validateStructuresAgainstResearch } from "../lib/research-validation.js";
import { runSandboxSuite } from "@tyroneross/builder-tools";
import { writeAgentArtifacts } from "../lib/build-files.js";

async function makeTestRoot(prefix) {
  const base = process.env.AGENT_BUILDER_TMPDIR || join(process.cwd(), ".tmp");
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, prefix));
}

test("all agent structures build and pass sandbox scenarios", async () => {
  const root = await makeTestRoot("agent-builder-e2e-");
  try {
    const result = await runSandboxSuite(AGENT_STRUCTURES, { root, llmMode: "fixture", writeAgentArtifacts });

    assert.equal(result.total, AGENT_STRUCTURES.length);
    assert.ok(result.total >= 6);
    assert.ok(result.totalScenarios >= AGENT_STRUCTURES.length * 3);
    assert.equal(result.failed, 0, JSON.stringify(result.results, null, 2));
    assert.equal(result.score, result.maxScore, JSON.stringify(result.results, null, 2));
    for (const item of result.results) {
      assert.ok(item.files.length >= 11);
      assert.ok(item.scenarios.length >= 3);
      assert.equal(item.provider, "local-fixture");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent structures pass research-derived architecture checks", () => {
  const result = validateStructuresAgainstResearch(AGENT_STRUCTURES);
  assert.equal(result.failed, 0, JSON.stringify(result.results, null, 2));
});

test("profile research checks validate generated contracts and allow no-tool agents", () => {
  const structure = {
    id: "no-tool-profile-fixture",
    label: "No Tool Profile Fixture",
    category: "utility",
    spec: {
      projectName: "No Tool Profile Fixture",
      description: "Local reasoning agent with no tools.",
      patternId: "solo-tool-agent",
      runtime: "local-sandbox",
      framework: "custom-loop",
      modelProvider: "ollama",
      sandbox: "local-sandbox",
      autonomy: "human-in-loop",
      inputs: ["question"],
      outputs: ["answer"],
      tools: [],
      memory: "local package memory",
      permissions: "read-only",
      nodes: [
        {
          id: "answer",
          title: "Answer",
          kind: "agent",
          description: "Answer from provided context.",
          inputs: ["question"],
          outputs: ["answer"],
          tools: [],
          permission: "allow-read",
        },
        {
          id: "eval",
          title: "Eval",
          kind: "eval",
          description: "Check answer quality.",
          inputs: ["answer"],
          outputs: ["quality_check"],
          tools: [],
          permission: "allow-read",
        },
        {
          id: "learn",
          title: "Learn",
          kind: "memory",
          description: "Promote validated lessons.",
          inputs: ["quality_check"],
          outputs: ["accepted_lessons"],
          tools: [],
          permission: "allow-read",
        },
      ],
      edges: [{ from: "answer", to: "eval" }, { from: "eval", to: "learn" }, { from: "learn", to: "answer" }],
      evals: [{ name: "a" }, { name: "b" }, { name: "c" }],
      learning: {
        mode: "eval-gated-domain-learning",
        domain: "reasoning",
        skills: ["answer"],
        metrics: ["accuracy", "grounding", "brevity"],
        cycle: ["observe", "evaluate", "promote"],
        exemplars: ["one", "two", "three"],
        artifacts: ["memory/domain-playbook.md", "memory/learning-ledger.json"],
        promotionGate: {
          rollbackOnRegression: true,
        },
      },
    },
    sandbox: {
      scenarios: [{ name: "one" }, { name: "two" }, { name: "three" }],
    },
  };

  const result = validateStructureAgainstResearch(structure);
  const checks = Object.fromEntries(result.checks.map((check) => [check.id, check.passed]));
  assert.equal(checks["profile-scaled-validation"], true);
  assert.equal(checks["permission-tier-coverage"], true);
  assert.equal(checks["profile-appropriate-checkpoints"], true);
});

test("profile research checks use normalized generated specs and fail invalid profiles without throwing", () => {
  const normalizedStructure = {
    id: "approval-defaults-fixture",
    label: "Approval Defaults Fixture",
    category: "workflow",
    spec: {
      projectName: "Approval Defaults Fixture",
      patternId: "approval-workflow",
    },
    sandbox: {
      scenarios: [{ name: "one" }, { name: "two" }, { name: "three" }],
    },
  };

  const normalizedResult = validateStructureAgainstResearch(normalizedStructure);
  const normalizedChecks = Object.fromEntries(normalizedResult.checks.map((check) => [check.id, check.passed]));
  assert.equal(normalizedChecks["profile-scaled-validation"], true);
  assert.equal(normalizedChecks["profile-appropriate-checkpoints"], true);

  const invalidResult = validateStructureAgainstResearch({
    ...normalizedStructure,
    spec: {
      ...normalizedStructure.spec,
      validationProfile: "enterprize",
    },
  });
  const invalidChecks = Object.fromEntries(invalidResult.checks.map((check) => [check.id, check.passed]));
  assert.equal(invalidChecks["profile-scaled-validation"], false);
  assert.equal(invalidChecks["profile-appropriate-checkpoints"], false);
});

test("profile research checks fail substantive checkpoint and permission regressions", () => {
  const baseSpec = {
    projectName: "Research Criteria Fixture",
    description: "Local reasoning fixture.",
    patternId: "solo-tool-agent",
    runtime: "local-sandbox",
    framework: "custom-loop",
    modelProvider: "ollama",
    sandbox: "local-sandbox",
    autonomy: "human-in-loop",
    inputs: ["request"],
    outputs: ["answer"],
    tools: [],
    memory: "local package memory",
    permissions: "read-only",
    nodes: [
      {
        id: "answer",
        title: "Answer",
        kind: "agent",
        description: "Answer from local context.",
        inputs: ["request"],
        outputs: ["answer"],
        tools: [],
        permission: "allow-read",
      },
    ],
    edges: [],
    evals: [{ name: "a" }, { name: "b" }, { name: "c" }],
    learning: {
      mode: "eval-gated-domain-learning",
      domain: "reasoning",
      skills: ["answer"],
      metrics: ["accuracy", "grounding", "brevity"],
      cycle: ["observe", "evaluate", "promote"],
      exemplars: ["one", "two", "three"],
      artifacts: ["memory/domain-playbook.md", "memory/learning-ledger.json"],
      promotionGate: {
        minScenarioPasses: 3,
        requiresNoNewPermissionFailures: true,
        requiresHumanApprovalForPersistentMemory: true,
        rollbackOnRegression: true,
      },
    },
  };
  const structure = (spec) => ({
    id: "research-criteria-fixture",
    label: "Research Criteria Fixture",
    category: "utility",
    spec,
    sandbox: {
      scenarios: [{ name: "one" }, { name: "two" }, { name: "three" }],
    },
  });
  const checksFor = (spec) =>
    Object.fromEntries(validateStructureAgainstResearch(structure(spec)).checks.map((check) => [check.id, check.passed]));

  assert.equal(checksFor({ ...baseSpec, evals: [{ name: "a" }] })["profile-appropriate-checkpoints"], false);
  assert.equal(checksFor({ ...baseSpec, validationProfile: "team" })["profile-appropriate-checkpoints"], false);
  assert.equal(
    checksFor({
      ...baseSpec,
      tools: [{ name: "opaque", responsibility: "Missing side effect.", permission: "ask-first" }],
      nodes: [{ ...baseSpec.nodes[0], tools: ["opaque"] }],
    })["permission-tier-coverage"],
    false,
  );
});

test("permission-tier research check includes emitted capability tools", () => {
  const result = validateStructureAgainstResearch({
    id: "doc-ingest-research-fixture",
    label: "Doc Ingest Research Fixture",
    category: "utility",
    spec: {
      projectName: "Doc Ingest Research Fixture",
      description: "Summarizes uploaded PDF and xlsx files for analysts.",
      patternId: "solo-tool-agent",
      runtime: "local-sandbox",
      framework: "custom-loop",
      modelProvider: "ollama",
      sandbox: "local-sandbox",
      autonomy: "human-in-loop",
      inputs: ["uploaded_pdf_file"],
      outputs: ["summary"],
      tools: [],
      memory: "local package memory",
      permissions: "read-only",
      nodes: [
        {
          id: "summarize",
          title: "Summarize",
          kind: "agent",
          description: "Summarize uploaded material.",
          inputs: ["uploaded_pdf_file"],
          outputs: ["summary"],
          tools: [],
          permission: "allow-read",
        },
        {
          id: "eval",
          title: "Eval",
          kind: "eval",
          description: "Check summary quality.",
          inputs: ["summary"],
          outputs: ["quality_check"],
          tools: [],
          permission: "allow-read",
        },
      ],
      edges: [{ from: "summarize", to: "eval" }],
      evals: [{ name: "a" }, { name: "b" }, { name: "c" }],
      learning: {
        mode: "eval-gated-domain-learning",
        domain: "documents",
        skills: ["summarize"],
        metrics: ["accuracy", "grounding", "brevity"],
        cycle: ["observe", "evaluate", "promote"],
        exemplars: ["one", "two", "three"],
        artifacts: ["memory/domain-playbook.md", "memory/learning-ledger.json"],
        promotionGate: {
          minScenarioPasses: 3,
          requiresNoNewPermissionFailures: true,
          requiresHumanApprovalForPersistentMemory: true,
          rollbackOnRegression: true,
        },
      },
    },
    sandbox: {
      scenarios: [{ name: "one" }, { name: "two" }, { name: "three" }],
    },
  });
  const checks = Object.fromEntries(result.checks.map((check) => [check.id, check.passed]));
  assert.equal(checks["permission-tier-coverage"], true);
});

test("each agent has an eval-gated domain learning profile", () => {
  for (const structure of AGENT_STRUCTURES) {
    assert.equal(structure.spec.learning.mode, "eval-gated-domain-learning");
    assert.ok(structure.spec.learning.domain);
    assert.ok(structure.spec.learning.metrics.length >= 3);
    assert.ok(structure.spec.nodes.some((node) => node.kind === "memory"));
    assert.ok(structure.spec.edges.some((edge) => edge.to === "learn"));
    assert.ok(structure.spec.edges.some((edge) => edge.from === "learn"));
  }
});
