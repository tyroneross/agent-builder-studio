import { FRAMEWORKS, PATTERNS, SOURCE_REGISTRY } from "./patterns.js";
import {
  PROMPT_BUILDER_SOURCE_IDS,
  buildPromptBuilderContract,
  buildPromptingProfile,
} from "./prompt-builder-guidance.js";

const CORE_FILES = [
  "agent.yaml",
  "manifest.json",
  "system-prompt.md",
  "prompts/prompt-builder-contract.md",
  "tools.json",
  "evals/golden-tasks.json",
  "evals/regression-scenarios.json",
  "memory/domain-playbook.md",
  "memory/learning-ledger.json",
  "README.md",
  "sources.md",
];

export function slugify(value) {
  return String(value ?? "agent")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "agent";
}

export function findPattern(patternId) {
  return PATTERNS.find((pattern) => pattern.id === patternId) ?? PATTERNS[0];
}

export function normalizeSpec(input = {}) {
  const pattern = findPattern(input.patternId);
  return {
    projectName: input.projectName || pattern.name,
    description: input.description || pattern.description,
    patternId: pattern.id,
    structureId: input.structureId,
    runtime: input.runtime || pattern.defaultRuntime,
    framework: input.framework || pattern.recommendedFrameworks[0],
    modelProvider: input.modelProvider || pattern.defaultProvider,
    sandbox: input.sandbox || "workspace-write",
    autonomy: input.autonomy || pattern.autonomy,
    nodes: Array.isArray(input.nodes) && input.nodes.length ? input.nodes : pattern.nodes,
    edges: Array.isArray(input.edges) ? input.edges : pattern.edges,
    inputs: Array.isArray(input.inputs) && input.inputs.length ? input.inputs : pattern.inputs,
    outputs: Array.isArray(input.outputs) && input.outputs.length ? input.outputs : pattern.outputs,
    tools: Array.isArray(input.tools) ? input.tools : pattern.tools,
    memory: input.memory || pattern.memory,
    permissions: input.permissions || pattern.permissions,
    evals: Array.isArray(input.evals) ? input.evals : pattern.evals,
    learning: input.learning,
    modelProfiles: input.modelProfiles,
    sources: Array.isArray(input.sources) ? input.sources : pattern.sources,
  };
}

export function validateSpec(spec) {
  const errors = [];
  if (!spec.projectName?.trim()) errors.push("Project name is required.");
  if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) errors.push("At least one node is required.");

  const nodeIds = new Set(spec.nodes.map((node) => node.id));
  for (const node of spec.nodes) {
    if (!node.id) errors.push("Every node needs an id.");
    if (!node.title) errors.push(`Node ${node.id || "(missing id)"} needs a title.`);
  }

  for (const edge of spec.edges ?? []) {
    if (!nodeIds.has(edge.from)) errors.push(`Edge source ${edge.from} does not exist.`);
    if (!nodeIds.has(edge.to)) errors.push(`Edge target ${edge.to} does not exist.`);
  }

  return errors;
}

function quoteYaml(value) {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "null";
  const text = String(value);
  if (!text) return '""';
  if (/^[a-zA-Z0-9_./:-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

export function toYaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value
      .map((item) => {
        if (item && typeof item === "object") {
          const rendered = toYaml(item, indent + 2);
          return `${pad}- ${rendered.trimStart()}`;
        }
        return `${pad}- ${quoteYaml(item)}`;
      })
      .join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    return entries
      .map(([key, item]) => {
        if (Array.isArray(item)) {
          return item.length ? `${pad}${key}:\n${toYaml(item, indent + 2)}` : `${pad}${key}: []`;
        }
        if (item && typeof item === "object") {
          return `${pad}${key}:\n${toYaml(item, indent + 2)}`;
        }
        return `${pad}${key}: ${quoteYaml(item)}`;
      })
      .join("\n");
  }

  return `${pad}${quoteYaml(value)}`;
}

function selectSources(spec) {
  const ids = new Set([
    "next-app-router",
    "next-route-handlers",
    ...PROMPT_BUILDER_SOURCE_IDS,
    ...(spec.sources ?? []),
  ]);
  return SOURCE_REGISTRY.filter((source) => ids.has(source.id));
}

function frameworkLabel(id) {
  return FRAMEWORKS.find((framework) => framework.id === id)?.label ?? id;
}

function buildManifest(spec, createdAt) {
  const pattern = findPattern(spec.patternId);
  return {
    schemaVersion: "agent-builder.v1",
    name: spec.projectName,
    slug: slugify(spec.projectName),
    description: spec.description,
    pattern: {
      id: pattern.id,
      name: pattern.name,
      type: pattern.type,
      autonomy: spec.autonomy,
    },
    structureId: spec.structureId,
    runtime: spec.runtime,
    framework: {
      id: spec.framework,
      label: frameworkLabel(spec.framework),
    },
    modelProvider: spec.modelProvider,
    ...(spec.modelProfiles ? { modelProfiles: spec.modelProfiles } : {}),
    sandbox: spec.sandbox,
    inputs: spec.inputs,
    outputs: spec.outputs,
    graph: {
      nodes: spec.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        kind: node.kind,
        model: node.model ?? "inherit",
        permission: node.permission ?? "ask-first",
        tools: node.tools ?? [],
        inputs: node.inputs ?? [],
        outputs: node.outputs ?? [],
      })),
      edges: spec.edges ?? [],
    },
    permissions: spec.permissions,
    memory: spec.memory,
    learning: spec.learning,
    prompting: buildPromptingProfile(spec),
    evals: spec.evals,
    sources: selectSources(spec),
    createdAt,
  };
}

function buildSystemPrompt(spec) {
  const nodes = spec.nodes
    .map((node) => {
      const tools = (node.tools ?? []).length ? node.tools.join(", ") : "none";
      return `## ${node.title}\nRole: ${node.kind}\nPermission: ${node.permission ?? "ask-first"}\nTools: ${tools}\n\n${node.description}`;
    })
    .join("\n\n");

  return `# ${spec.projectName} System Prompt

You are operating inside the ${frameworkLabel(spec.framework)} harness generated by Agent Builder.

## Job
${spec.description}

## Inputs
${spec.inputs.map((input) => `- ${input}`).join("\n")}

## Outputs
${spec.outputs.map((output) => `- ${output}`).join("\n")}

${buildModelProfilePromptSection(spec)}

## Operating Rules
- Use the smallest active tool pool that can complete the current step.
- Treat permissions as policy, not suggestions.
- Ask before writes, shell execution, external side effects, or credential use unless the manifest explicitly allows the action.
- Keep source provenance attached to research or documentation claims.
- Stop with a visible reason when a required permission, source, or input is missing.
- Learn only through eval-gated domain updates. Candidate lessons must include provenance, a failed check or improvement signal, and a rollback note before they can enter persistent memory.

## Nodes
${nodes}

## Completion Criteria
- Required outputs are present.
- Permission invariants pass.
- Tool results are summarized with enough detail to audit the run.
- The eval suite in \`evals/golden-tasks.json\` passes or reports a clear failure reason.
`;
}

function buildModelProfilePromptSection(spec) {
  if (!spec.modelProfiles) return "";
  return `## Local Model Profile
- Hardware target: ${spec.modelProfiles.hardwareTarget}
- Runner: ${spec.modelProfiles.runner}
- Primary model: ${spec.modelProfiles.primary?.model} (${spec.modelProfiles.primary?.use})
- Fallback models: ${(spec.modelProfiles.fallbacks ?? []).map((item) => `${item.model} (${item.use})`).join("; ") || "none"}
- Stretch models: ${(spec.modelProfiles.stretch ?? []).map((item) => `${item.model} (${item.use})`).join("; ") || "none"}
- Context policy: ${spec.modelProfiles.contextPolicy}
`;
}

function buildTools(spec) {
  return {
    schemaVersion: "agent-builder.tools.v1",
    policy: spec.permissions,
    tools: spec.tools.map((tool) => ({
      name: tool.name,
      responsibility: tool.responsibility,
      sideEffect: tool.sideEffect,
      permission: tool.permission,
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          request: { type: "string" },
          context: { type: "object" },
        },
        required: ["request"],
      },
    })),
  };
}

function buildReadme(spec, manifest) {
  return `# ${spec.projectName}

${spec.description}

## Generated Files

${CORE_FILES.map((file) => `- \`${file}\``).join("\n")}

## Runtime

- Pattern: ${manifest.pattern.name} (${manifest.pattern.type})
- Framework: ${manifest.framework.label}
- Model provider: ${spec.modelProvider}
- Sandbox: ${spec.sandbox}

${buildLocalModelReadmeSection(spec)}

## User Flow

1. Receive inputs: ${spec.inputs.join(", ")}.
2. Run the graph in \`agent.yaml\`.
3. Enforce permissions from \`tools.json\` before each action.
4. Emit outputs: ${spec.outputs.join(", ")}.
5. Run \`evals/golden-tasks.json\` before treating the agent as ready.
6. Record scenario results in \`memory/learning-ledger.json\`; promote only validated lessons into \`memory/domain-playbook.md\`.

## Security Notes

- Keep credentials outside prompts and generated manifests.
- Use allowlists for filesystem and network access.
${buildSecuritySideEffectNote(spec)}
- Log tool calls separately from chat messages so audits do not depend on transcript replay.

## Next Implementation Step

Create the runtime adapter for ${manifest.framework.label}. Start from this manifest instead of copying the UI graph by hand.
`;
}

function buildSecuritySideEffectNote(spec) {
  const sideEffects = new Set((spec.tools ?? []).map((tool) => tool.sideEffect));
  const draftOnly = [...sideEffects].every((effect) => ["none", "read"].includes(effect));
  if (draftOnly) {
    return "- This generated contract is draft-only: it does not send messages, call external APIs, use credentials, or mutate production systems.";
  }
  return "- Require approval for writes, deletes, shell execution, messages, payments, and production actions.";
}

function buildLocalModelReadmeSection(spec) {
  if (!spec.modelProfiles) return "";
  const commands = [
    spec.modelProfiles.primary,
    ...(spec.modelProfiles.fallbacks ?? []),
    ...(spec.modelProfiles.stretch ?? []),
  ]
    .filter(Boolean)
    .map((profile) => `- \`${profile.install}\` — ${profile.use}`);

  return `## Local Model Setup

- Hardware target: ${spec.modelProfiles.hardwareTarget}
- Runner: ${spec.modelProfiles.runner}
- Context policy: ${spec.modelProfiles.contextPolicy}

${commands.join("\n")}
`;
}

function buildDomainPlaybook(spec) {
  const learning = spec.learning;
  if (!learning) return "# Domain Playbook\n\nNo domain-learning profile was supplied.\n";

  return `# Domain Playbook

Domain: ${learning.domain}
Mode: ${learning.mode}

## Skills To Improve

${learning.skills.map((skill) => `- ${skill}`).join("\n")}

## Metrics

${learning.metrics.map((metric) => `- ${metric}`).join("\n")}

## Learning Cycle

${learning.cycle.map((step, index) => `${index + 1}. ${step}`).join("\n")}

## Promotion Gate

- Minimum scenario passes: ${learning.promotionGate.minScenarioPasses}
- No new permission failures: ${learning.promotionGate.requiresNoNewPermissionFailures}
- Human approval for persistent memory: ${learning.promotionGate.requiresHumanApprovalForPersistentMemory}
- Roll back on regression: ${learning.promotionGate.rollbackOnRegression}

## Accepted Lessons

No accepted lessons yet. Add a lesson only after it passes the promotion gate.
`;
}

function buildLearningLedger(spec, createdAt) {
  return {
    schemaVersion: "agent-builder.learning-ledger.v1",
    agent: spec.projectName,
    domain: spec.learning?.domain ?? spec.projectName,
    createdAt,
    promotionGate: spec.learning?.promotionGate,
    runs: [],
    candidateLessons: [],
    acceptedLessons: [],
    rejectedLessons: [],
  };
}

function buildSourcesMarkdown(spec) {
  const sources = selectSources(spec);
  return `# Source Registry

Use these references before implementing or changing the generated agent runtime.

${sources
  .map((source) => `## ${source.name}\n- Category: ${source.category}\n- Last checked: ${source.lastChecked}\n- URL: ${source.url}\n- Note: ${source.note}`)
  .join("\n\n")}
`;
}

export function buildAgentArtifacts(input, options = {}) {
  const spec = normalizeSpec(input);
  const errors = validateSpec(spec);
  if (errors.length) {
    throw new Error(errors.join(" "));
  }

  const createdAt = options.createdAt ?? new Date().toISOString();
  const manifest = buildManifest(spec, createdAt);
  const agentConfig = {
    schemaVersion: "agent-builder.agent.v1",
    name: spec.projectName,
    description: spec.description,
    runtime: spec.runtime,
    framework: spec.framework,
    modelProvider: spec.modelProvider,
    sandbox: spec.sandbox,
    inputs: spec.inputs,
    outputs: spec.outputs,
    graph: manifest.graph,
    memory: spec.memory,
    permissions: spec.permissions,
    prompting: manifest.prompting,
    learning: spec.learning,
    ...(spec.modelProfiles ? { modelProfiles: spec.modelProfiles } : {}),
  };

  const evals = {
    schemaVersion: "agent-builder.evals.v1",
    passCondition: "All golden tasks pass or produce explicit stop reasons.",
    goldenTasks: spec.evals,
  };

  const regressionScenarios = {
    schemaVersion: "agent-builder.regression-scenarios.v1",
    passCondition: "A promoted domain lesson must not reduce any scenario score.",
    scenarios: spec.learning?.exemplars?.map((name) => ({ name, status: "seed" })) ?? [],
  };

  const files = [
    { path: "agent.yaml", content: `${toYaml(agentConfig)}\n` },
    { path: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: "system-prompt.md", content: buildSystemPrompt(spec) },
    { path: "prompts/prompt-builder-contract.md", content: buildPromptBuilderContract(spec, { frameworkLabel }) },
    { path: "tools.json", content: `${JSON.stringify(buildTools(spec), null, 2)}\n` },
    { path: "evals/golden-tasks.json", content: `${JSON.stringify(evals, null, 2)}\n` },
    { path: "evals/regression-scenarios.json", content: `${JSON.stringify(regressionScenarios, null, 2)}\n` },
    { path: "memory/domain-playbook.md", content: buildDomainPlaybook(spec) },
    { path: "memory/learning-ledger.json", content: `${JSON.stringify(buildLearningLedger(spec, createdAt), null, 2)}\n` },
    { path: "README.md", content: buildReadme(spec, manifest) },
    { path: "sources.md", content: buildSourcesMarkdown(spec) },
  ];

  return {
    slug: manifest.slug,
    spec,
    files,
    warnings: buildWarnings(spec),
  };
}

function buildWarnings(spec) {
  const warnings = [];
  if (spec.runtime.includes("local") && spec.nodes.length > 6) {
    warnings.push("Local runtimes should keep active tool and agent counts small; consider splitting this into phases.");
  }
  if ((spec.edges ?? []).length === 0 && spec.nodes.length > 1) {
    warnings.push("Multiple nodes exist without edges. Add arrows so handoff and data flow are explicit.");
  }
  if (spec.framework === "custom-loop" && spec.nodes.some((node) => node.kind === "approval")) {
    warnings.push("Custom approval workflows need durable state before production side effects.");
  }
  if (spec.learning && !spec.nodes.some((node) => node.kind === "memory")) {
    warnings.push("Domain learning is configured but no memory node is visible in the graph.");
  }
  if (spec.sources?.includes("openclaw-security")) {
    warnings.push("OpenClaw-style self-hosted agents require strict network isolation and credential boundaries.");
  }
  return warnings;
}
