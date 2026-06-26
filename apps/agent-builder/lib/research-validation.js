import {
  READINESS_CHECKPOINT_NODE_KINDS,
  SPEC_PROFILE_DEFINITIONS,
  mapToolPermissionTier,
  profileContractPaths,
} from "@tyroneross/agent-pack";
import { buildAgentArtifacts } from "@tyroneross/agent-pack";

function structureTools(structure) {
  return structure.spec?.tools ?? [];
}

function structureNodes(structure) {
  return structure.spec?.nodes ?? [];
}

function generatedPackage(structure) {
  if (!structure.spec) return null;
  try {
    const generated = buildAgentArtifacts(structure.spec, { createdAt: "research-validation" });
    const manifestFile = generated.files.find((file) => file.path === "manifest.json");
    if (!manifestFile) return null;
    return {
      generated,
      manifest: JSON.parse(manifestFile.content),
    };
  } catch {
    return null;
  }
}

function generatedTools(structure) {
  const generated = generatedPackage(structure);
  if (!generated) return null;
  const toolsFile = generated.generated.files.find((file) => file.path === "tools.json");
  if (!toolsFile) return null;
  return JSON.parse(toolsFile.content).tools ?? [];
}

export const RESEARCH_CRITERIA = [
  {
    id: "simple-composable-default",
    source: "Anthropic Building Effective Agents",
    rule: "Prefer simple workflows or a single orchestrator unless the job needs parallel breadth.",
    check: (structure) => {
      const agentLike = structureNodes(structure).filter((node) => ["agent", "orchestrator"].includes(node.kind)).length;
      const isResearch = structure.category === "research";
      return isResearch || agentLike <= 3;
    },
  },
  {
    id: "tool-scope-control",
    source: "OpenAI Agents SDK guardrails and MAST failure taxonomy",
    rule: "Every tool needs explicit side-effect and permission metadata.",
    check: (structure) =>
      structureTools(structure).every((tool) => tool.name && tool.sideEffect && tool.permission && tool.responsibility),
  },
  {
    id: "sandboxed-write-boundary",
    source: "OpenAI Agents SDK sandboxing direction and agent security literature",
    rule: "Write-capable agents must name a sandbox boundary and avoid arbitrary output paths.",
    check: (structure) => {
      const hasWriteTool = structureTools(structure).some((tool) => ["write", "shell"].includes(tool.sideEffect));
      return !hasWriteTool || String(structure.spec.sandbox).includes("local") || String(structure.spec.sandbox).includes("sandbox");
    },
  },
  {
    id: "evals-are-first-class",
    source: "Survey on Evaluation of LLM-based Agents",
    rule: "Each structure should include multiple golden or invariant evals.",
    check: (structure) => Array.isArray(structure.spec.evals) && structure.spec.evals.length >= 3,
  },
  {
    id: "termination-visible",
    source: "MAST task verification failure modes",
    rule: "Each structure should include a verifier, eval, approval, or explicit bounded workflow node.",
    check: (structure) =>
      structureNodes(structure).some((node) => ["eval", "verifier", "approval", "guardrail"].includes(node.kind)),
  },
  {
    id: "local-model-tool-budget",
    source: "Local and open-source model agent guidance",
    rule: "Local-model structures should keep the tool set small enough for reliable tool selection.",
    check: (structure) => structureTools(structure).length <= 5,
  },
  {
    id: "eval-gated-domain-learning",
    source: "Reflexion-style learning, DSPy optimization, and agent evaluation surveys",
    rule: "Agents that learn should preserve a domain-scoped playbook, regression scenarios, and a promotion gate.",
    check: (structure) =>
      structure.spec.learning?.mode === "eval-gated-domain-learning" &&
      structure.spec.learning?.promotionGate?.rollbackOnRegression === true &&
      structure.spec.learning?.artifacts?.includes("memory/domain-playbook.md") &&
      structure.spec.learning?.artifacts?.includes("memory/learning-ledger.json"),
  },
  {
    id: "scenario-coverage",
    source: "Agent evaluation best practice",
    rule: "Each domain agent should have multiple scenario tests, not a single happy path.",
    check: (structure) => Array.isArray(structure.sandbox?.scenarios) && structure.sandbox.scenarios.length >= 3,
  },
  {
    id: "profile-scaled-validation",
    source: "Agent Builder enterprise specification comparison",
    rule: "Validation requirements should scale by profile instead of forcing enterprise gates onto every agent.",
    check: (structure) => {
      const generated = generatedPackage(structure);
      if (!generated) return false;
      const paths = new Set(generated.generated.files.map((file) => file.path));
      const definition = SPEC_PROFILE_DEFINITIONS[generated.manifest.specProfile.id];
      if (!definition) return false;
      const expectedContractFiles = profileContractPaths(definition);
      return (
        expectedContractFiles.every((path) => paths.has(path)) &&
        expectedContractFiles.every((path) => generated.manifest.specProfile.contractFiles.includes(path))
      );
    },
  },
  {
    id: "permission-tier-coverage",
    source: "Agentic systems handoff methodology",
    rule: "Every tool should map to an auditable permission tier before runtime binding.",
    check: (structure) => {
      const expectedBySideEffect = {
        none: "T0",
        read: "T1",
        network: "T2",
        write: "T3",
        shell: "T4",
      };
      const tools = generatedTools(structure);
      if (!tools) return false;
      return tools.every((tool) => {
        const tier = mapToolPermissionTier(tool);
        const sideEffect = String(tool.sideEffect ?? "").toLowerCase();
        const expected = expectedBySideEffect[sideEffect];
        return Boolean(
          tool.name &&
            tool.responsibility &&
            tool.permission &&
            sideEffect &&
            tool.permissionTier === tier &&
            (tier === "T5" || (expected && tier === expected)),
        );
      });
    },
  },
  {
    id: "profile-appropriate-checkpoints",
    source: "Enterprise and personal agent validation boundary",
    rule: "Shared or governed workflows need explicit checkpoints; personal agents can satisfy readiness through local evals and stop reasons.",
    check: (structure) => {
      const generated = generatedPackage(structure);
      if (!generated) return false;
      const profile = generated.manifest.specProfile;
      if (profile.id === "personal" || profile.id === "skill") {
        return Array.isArray(generated.manifest.evals) && generated.manifest.evals.length >= 3;
      }
      return generated.manifest.graph.nodes.some((node) => READINESS_CHECKPOINT_NODE_KINDS.includes(node.kind));
    },
  },
];

export function validateStructureAgainstResearch(structure) {
  const checks = RESEARCH_CRITERIA.map((criterion) => ({
    id: criterion.id,
    source: criterion.source,
    rule: criterion.rule,
    passed: Boolean(criterion.check(structure)),
  }));

  return {
    passed: checks.every((check) => check.passed),
    checks,
  };
}

export function validateStructuresAgainstResearch(structures) {
  const results = structures.map((structure) => ({
    id: structure.id,
    label: structure.label,
    ...validateStructureAgainstResearch(structure),
  }));

  return {
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    results,
  };
}
