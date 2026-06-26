import { FRAMEWORKS, PATTERNS, SOURCE_REGISTRY } from "./patterns.js";
import {
  PROMPT_BUILDER_SOURCE_IDS,
  buildPromptBuilderContract,
  buildPromptingProfile,
} from "./prompt-builder-guidance.js";
// Spec contract (slugify/validateSpec/toYaml) now lives in the shared package —
// single source of truth across the monorepo. Re-exported below for back-compat
// with this app's existing importers (tests, app/page.js, build-files.js).
import { slugify, validateSpec, toYaml } from "@tyroneross/agent-spec";
import {
  resolveEmittedCapabilities,
  buildComponentModelSection,
} from "./emitted-capabilities/index.mjs";
import {
  HUMAN_CHECKPOINT_NODE_KINDS,
  inferSpecProfile,
  mapToolPermissionTier,
  profileRequires,
} from "./spec-profile.js";

export { slugify, validateSpec, toYaml };

const CORE_FILES = [
  "agent-package.json",
  "package.json",
  "agent.yaml",
  "manifest.json",
  "INSTALL.md",
  "system-prompt.md",
  "prompts/prompt-builder-contract.md",
  "skills/skill-bank.json",
  "skills/skill-contract.md",
  "context/input-contract.md",
  "tools.json",
  "setup/requirements.json",
  "setup/env.example",
  "setup/install-checklist.md",
  "setup/host-deployment.md",
  "setup/local-models.md",
  "setup/vector-store.md",
  "scripts/setup-check.mjs",
  "runtime/README.md",
  "runtime/adapter-contract.md",
  "runtime/custom-loop-adapter.mjs",
  "runtime/adapters/claude-subagents.md",
  "runtime/adapters/custom-loop.md",
  "runtime/adapters/deepagents.md",
  "runtime/adapters/langgraph.md",
  "runtime/adapters/nvidia-nemo-agent-toolkit.md",
  "runtime/adapters/openai-agents-sdk.md",
  "runtime/adapters/pydantic-ai.md",
  "evals/golden-tasks.json",
  "evals/regression-scenarios.json",
  "memory/domain-playbook.md",
  "memory/learning-ledger.json",
  "README.md",
  "sources.md",
];

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
    validationProfile: input.validationProfile ?? input.specProfile ?? input.deploymentClass ?? input.agentClass,
    riskTier: input.riskTier,
    enterprise: input.enterprise,
    production: input.production,
    regulated: input.regulated,
    owners: input.owners,
    lifecycle: input.lifecycle,
    sources: Array.isArray(input.sources) ? input.sources : pattern.sources,
  };
}

// slugify, validateSpec, toYaml now imported from @tyroneross/agent-spec (top of
// file) and re-exported. The inline copies were removed during the agent-platform
// consolidation; the package is byte-equivalent (proven at extraction time).

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

const FRAMEWORK_ADAPTER_GUIDES = {
  "custom-loop": {
    language: "JavaScript",
    install: "No framework dependency required for the starter adapter.",
    runtime: "Use runtime/custom-loop-adapter.mjs to load manifests, check inputs, enforce tool metadata, and hand execution to your model/tool runner.",
  },
  "openai-agents-sdk": {
    language: "JavaScript or Python",
    install: "Install the OpenAI Agents SDK in the host project, then map manifest graph nodes to Agents, handoffs, guardrails, and tools.",
    runtime: "Use manifest.json for node/tool metadata and system-prompt.md as the top-level instructions. Keep tools.json as the source of permission truth.",
  },
  "claude-subagents": {
    language: "Markdown agent files",
    install: "Create one host subagent per graph node that needs isolated context, using system-prompt.md plus the node descriptions from manifest.json.",
    runtime: "Keep the orchestrator in the host. Do not create recursive subagent trees; preserve the package evals as acceptance checks.",
  },
  deepagents: {
    language: "Python",
    install: "Install deepagents in the host project and translate graph nodes into scoped subagents with narrow tool lists.",
    runtime: "Use tools.json to scope each subagent. Keep persistent context in memory/ and route generated files through the host virtual filesystem.",
  },
  langgraph: {
    language: "Python or JavaScript",
    install: "Install LangGraph in the host project and translate graph nodes to graph nodes, edges to transitions, and memory/ to checkpoint-backed state.",
    runtime: "Use manifest.graph as the topology source. Preserve approval, verifier, eval, and memory nodes as explicit states.",
  },
  "pydantic-ai": {
    language: "Python",
    install: "Install Pydantic AI in the host project and translate inputs/outputs to typed models before binding tools.",
    runtime: "Use context/input-contract.md as the dependency contract and tools.json as the function-tool registry.",
  },
  "nvidia-nemo-agent-toolkit": {
    language: "YAML and Python",
    install: "Install NeMo Agent Toolkit in the host project and translate manifest graph, tools, llms, and evaluators into the host workflow YAML.",
    runtime: "Keep setup/requirements.json as the portability checklist and copy evals/ into the host evaluation workflow.",
  },
};

function buildSpecProfileManifest(specProfile) {
  return {
    id: specProfile.id,
    label: specProfile.label,
    validationLevel: specProfile.validationLevel,
    audience: specProfile.audience,
    explicit: specProfile.explicit,
    inferredReason: specProfile.inferredReason,
    requiredContracts: specProfile.requiredContracts,
    contractFiles: specProfile.contractFiles,
    validationFocus: specProfile.validationFocus,
  };
}

function buildGovernanceManifest(spec, specProfile, emittedTools = []) {
  const tools = [...(spec.tools ?? []), ...emittedTools];
  const sideEffects = [...new Set(tools.map((tool) => tool.sideEffect ?? "unspecified").filter(Boolean))];
  const toolTiers = tools.map((tool) => ({
    tool: tool.name,
    permissionTier: mapToolPermissionTier(tool),
    permission: tool.permission,
    sideEffect: tool.sideEffect ?? "unspecified",
  }));
  return {
    validationLevel: specProfile.validationLevel,
    requiredContracts: specProfile.contractFiles,
    iam: profileRequires(specProfile, "agent-registry")
      ? "Define human, service, and agent identities before production use."
      : "Use host user identity unless this package is promoted to a shared runtime.",
    permissions: spec.permissions,
    sideEffects,
    toolTiers,
    observability: profileRequires(specProfile, "observability")
      ? "Record run status, tool calls, stop reasons, eval results, and accepted memory updates."
      : "Record fixture results and visible stop reasons.",
    lifecycle: profileRequires(specProfile, "lifecycle")
      ? "Require owner, version, eval gate, rollback, and deactivation policy."
      : "Version prompt, tool, and eval changes with the package.",
  };
}

function buildInteractionManifest(spec, specProfile) {
  return {
    invocation: spec.inputs.map((input) => ({ input, source: "host runtime, operator, or local file" })),
    outputContract: spec.outputs,
    approvalModel: profileRequires(specProfile, "human-checkpoints")
      ? "Human checkpoints are required for approval, escalation, or side-effect release."
      : "Ask before writes, shell execution, external calls, or missing critical inputs.",
    stopReasons: [
      "missing_required_input",
      "permission_not_granted",
      "source_or_tool_unavailable",
      "eval_or_quality_gate_failed",
    ],
  };
}

function buildManifest(spec, createdAt, specProfile) {
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
    specProfile: buildSpecProfileManifest(specProfile),
    mission: {
      purpose: spec.description,
      primaryUsers: specProfile.audience,
      successOutputs: spec.outputs,
    },
    interaction: buildInteractionManifest(spec, specProfile),
    graph: {
      nodes: spec.nodes.map((node) => ({
        id: node.id,
        title: node.title,
        kind: node.kind,
        description: node.description,
        x: node.x,
        y: node.y,
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

function buildSystemPrompt(spec, specProfile) {
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

## Spec Profile
- Class: ${specProfile.label}
- Validation level: ${specProfile.validationLevel}
- Required contracts: ${specProfile.contractFiles.map((file) => `\`${file}\``).join(", ")}
- Validation focus: ${specProfile.validationFocus.join("; ")}

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

function buildTools(spec, emittedTools = []) {
  return {
    schemaVersion: "agent-builder.tools.v1",
    policy: spec.permissions,
    tools: [...spec.tools, ...emittedTools].map((tool) => ({
      name: tool.name,
      responsibility: tool.responsibility,
      sideEffect: tool.sideEffect,
      permission: tool.permission,
      permissionTier: mapToolPermissionTier(tool),
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

function yamlContract(title, value) {
  return `# ${title}\n\n${toYaml(value)}\n`;
}

function buildSpecProfileContract(spec, manifest) {
  return {
    schemaVersion: "agent-builder.spec-profile.v1",
    agent: spec.projectName,
    slug: manifest.slug,
    profile: manifest.specProfile,
    validationMatrix: manifest.specProfile.validationFocus.map((focus) => ({
      focus,
      evidence: "Keep evidence in evals/, memory/learning-ledger.json, run traces, or host approval records.",
    })),
    scalingRule: "Use the declared profile as the minimum validation depth. Promote the profile when autonomy, side effects, users, or regulated data increase.",
  };
}

function buildSystemBoundaryContract(spec, manifest, emittedTools = []) {
  const tools = [...(spec.tools ?? []), ...emittedTools];
  const toolsWithTiers = tools.map((tool) => ({
    ...tool,
    sideEffectLabel: tool.sideEffect ?? "unspecified",
    permissionTier: mapToolPermissionTier(tool),
  }));
  return yamlContract("System Boundary Contract", {
    system_boundary: {
      agent: spec.projectName,
      slug: manifest.slug,
      profile: manifest.specProfile.id,
      mission: spec.description,
      users_served: manifest.specProfile.audience,
      runtime: spec.runtime,
      framework: spec.framework,
      sandbox: spec.sandbox,
      inputs: spec.inputs,
      outputs: spec.outputs,
      memory: {
        policy: spec.memory,
        files: ["memory/domain-playbook.md", "memory/learning-ledger.json"],
      },
      external_tools: toolsWithTiers
        .filter((tool) => !["T0", "T1"].includes(tool.permissionTier))
        .map((tool) => tool.name),
      actions_that_change_the_world: toolsWithTiers
        .filter((tool) => ["T3", "T4", "T5"].includes(tool.permissionTier))
        .map((tool) => ({
          tool: tool.name,
          side_effect: tool.sideEffectLabel,
          permission: tool.permission,
          permission_tier: tool.permissionTier,
        })),
      not_in_scope: [
        "Storing secrets inside prompts, manifests, evals, or memory files",
        "Using tools outside tools.json without updating contracts and evals",
      ],
    },
  });
}

function buildToolContracts(spec, manifest, emittedTools = []) {
  const tools = [...(spec.tools ?? []), ...emittedTools];
  return yamlContract("Tool Contracts", {
    tool_contracts: {
      agent: spec.projectName,
      slug: manifest.slug,
      policy: spec.permissions,
      permission_tiers: "T0 none, T1 read, T2 network, T3 write, T4 shell, T5 destructive or privileged",
      tools: tools.map((tool) => ({
        name: tool.name,
        responsibility: tool.responsibility,
        side_effect: tool.sideEffect ?? "unspecified",
        permission: tool.permission,
        permission_tier: mapToolPermissionTier(tool),
        allowed_when: "The current node needs this tool and required inputs are present.",
        denied_when: "The tool is outside scope, requested permission is missing, or the action changes a system outside the declared boundary.",
        audit_fields: ["run_id", "node_id", "tool", "permission_tier", "inputs_summary", "result_summary", "stop_reason"],
      })),
    },
  });
}

function buildFlowTopologyContract(spec, manifest) {
  return yamlContract("Flow Topology Contract", {
    flow_topology: {
      agent: spec.projectName,
      slug: manifest.slug,
      pattern: manifest.pattern,
      state_owner: spec.runtime.includes("local") ? "local package runtime" : "host runtime or framework checkpoint store",
      graph: {
        nodes: spec.nodes.map((node) => ({
          id: node.id,
          kind: node.kind,
          title: node.title,
          inputs: node.inputs ?? [],
          outputs: node.outputs ?? [],
          permission: node.permission ?? "ask-first",
        })),
        edges: spec.edges ?? [],
      },
      retry_policy: "Retry only idempotent read or reasoning steps by default. Require approval before retrying side-effect tools.",
      termination_policy: "Stop when required outputs are complete, a required permission is denied, a source is unavailable, or an eval gate fails.",
    },
  });
}

function buildGuardrailsContract(spec, manifest) {
  return yamlContract("Guardrails Contract", {
    guardrails: {
      agent: spec.projectName,
      slug: manifest.slug,
      profile: manifest.specProfile.id,
      input_guardrails: [
        "Reject or stop on missing required inputs.",
        "Keep secrets out of prompts, eval fixtures, and persistent memory.",
      ],
      planning_guardrails: [
        "Use the smallest active graph path and tool pool that can complete the task.",
        "Do not add agents, tools, or memory stores without updating contracts and evals.",
      ],
      tool_guardrails: [
        "Enforce tools.json permission and permissionTier before every tool call.",
        "Ask before writes, shell execution, network side effects, credential use, or production actions.",
      ],
      output_guardrails: [
        "Emit required outputs with provenance or stop reasons.",
        "Run golden tasks before declaring the package ready.",
      ],
      memory_guardrails: [
        "Promote durable lessons only after the learning gate passes.",
        "Keep rejected or candidate lessons in memory/learning-ledger.json.",
      ],
    },
  });
}

function buildHumanCheckpointsContract(spec, manifest) {
  const checkpointNodes = spec.nodes.filter((node) => HUMAN_CHECKPOINT_NODE_KINDS.includes(node.kind));
  return yamlContract("Human Checkpoints Contract", {
    human_checkpoints: {
      agent: spec.projectName,
      slug: manifest.slug,
      profile: manifest.specProfile.id,
      required_for: [
        "Permission escalation",
        "Persistent memory promotion",
        "External side effects",
        "Eval failure override",
      ],
      graph_checkpoints: checkpointNodes.map((node) => ({
        node_id: node.id,
        title: node.title,
        kind: node.kind,
        decision_fields: ["approve", "reject", "request_changes", "stop_reason"],
      })),
      default_decision: "stop unless the host records an explicit approval",
    },
  });
}

function buildAgentRegistryContract(spec, manifest) {
  const owners = spec.owners ?? {};
  return yamlContract("Agent Registry Contract", {
    agent_registry: {
      agent: spec.projectName,
      slug: manifest.slug,
      profile: manifest.specProfile.id,
      owner: owners.primary ?? "TBD before production",
      accountable_team: owners.team ?? "TBD before production",
      runtime_identity: owners.runtimeIdentity ?? `${manifest.slug}-runtime`,
      human_operators: owners.humanOperators ?? ["TBD before production"],
      service_accounts: owners.serviceAccounts ?? [],
      graph_roles: spec.nodes.map((node) => ({
        role_id: `${manifest.slug}-${slugify(node.id)}`,
        node_id: node.id,
        title: node.title,
        kind: node.kind,
        permission_default: node.permission ?? "ask-first",
        tools: node.tools ?? [],
      })),
    },
  });
}

function buildObservabilityContract(spec, manifest) {
  const enterprise = manifest.specProfile.id === "enterprise";
  return yamlContract("Observability Contract", {
    observability: {
      agent: spec.projectName,
      slug: manifest.slug,
      profile: manifest.specProfile.id,
      required_events: [
        "run_started",
        "node_started",
        "tool_requested",
        "tool_completed",
        "node_completed",
        "run_completed",
        "run_stopped",
        "eval_completed",
        ...(enterprise ? ["approval_recorded", "memory_promotion_requested", "lifecycle_change"] : []),
      ],
      trace_fields: [
        "run_id",
        "profile",
        "node_id",
        "tool",
        "permission_tier",
        "inputs_summary",
        "outputs_summary",
        "stop_reason",
        "eval_summary",
      ],
      metrics: [
        "task_success_rate",
        "permission_denial_rate",
        "eval_pass_rate",
        "tool_error_rate",
        ...(enterprise ? ["approval_latency", "rollback_count", "policy_violation_count"] : []),
      ],
    },
  });
}

function buildLifecycleContract(spec, manifest) {
  const lifecycle = spec.lifecycle ?? {};
  return yamlContract("Lifecycle Contract", {
    lifecycle: {
      agent: spec.projectName,
      slug: manifest.slug,
      profile: manifest.specProfile.id,
      owner: lifecycle.owner ?? spec.owners?.primary ?? "TBD before production",
      versioning: lifecycle.versioning ?? "Version every prompt, tool, permission, graph, memory, and eval change.",
      promotion_gates: lifecycle.promotionGates ?? [
        "setup:check passes",
        "runtime:check passes",
        "golden tasks pass",
        "permission tiers reviewed",
        "rollback path documented",
      ],
      rollback: lifecycle.rollback ?? "Restore the previous package version and disable new tool permissions.",
      deactivation: lifecycle.deactivation ?? "Remove host routing, revoke credentials, and preserve audit logs.",
    },
  });
}

function buildContractFiles(spec, manifest, emittedTools = []) {
  const builders = {
    "contracts/spec-profile.json": () => `${JSON.stringify(buildSpecProfileContract(spec, manifest), null, 2)}\n`,
    "contracts/system-boundary.yaml": () => buildSystemBoundaryContract(spec, manifest, emittedTools),
    "contracts/tool-contracts.yaml": () => buildToolContracts(spec, manifest, emittedTools),
    "contracts/flow-topology.yaml": () => buildFlowTopologyContract(spec, manifest),
    "contracts/guardrails.yaml": () => buildGuardrailsContract(spec, manifest),
    "contracts/human-checkpoints.yaml": () => buildHumanCheckpointsContract(spec, manifest),
    "contracts/agent-registry.yaml": () => buildAgentRegistryContract(spec, manifest),
    "contracts/observability.yaml": () => buildObservabilityContract(spec, manifest),
    "contracts/lifecycle.yaml": () => buildLifecycleContract(spec, manifest),
  };

  return manifest.specProfile.contractFiles
    .filter((path) => !CORE_FILES.includes(path))
    .map((path) => {
      const build = builders[path];
      if (!build) throw new Error(`No contract builder registered for ${path}`);
      return { path, content: build() };
    });
}

function markdownList(items, empty = "- none") {
  return items?.length ? items.map((item) => `- ${item}`).join("\n") : empty;
}

function nodeSkillId(manifest, node) {
  return `${manifest.slug}-${slugify(node.id)}-skill`;
}

function buildSkillBank(spec, manifest, emittedSkills = []) {
  const nodeSkills = spec.nodes.map((node) => ({
    id: nodeSkillId(manifest, node),
    type: "graph-node",
    nodeId: node.id,
    title: `${node.title} skill`,
    purpose: node.description,
    whenToUse: `Load when the graph is executing or modifying the ${node.title} node.`,
    inputs: node.inputs ?? [],
    outputs: node.outputs ?? [],
    tools: node.tools ?? [],
    permission: node.permission ?? "ask-first",
    requiredFiles: ["manifest.json", "tools.json", "skills/skill-contract.md"],
  }));

  return {
    schemaVersion: "agent-builder.skill-bank.v1",
    agent: spec.projectName,
    slug: manifest.slug,
    purpose: "Portable skill inventory for running, modifying, or composing this generated agent.",
    loadPolicy: {
      default: "Load the core operating skill first, then load only the node skills needed for the current graph phase.",
      chaining: "Use skill chains when one node output becomes the next node input. Every handoff must carry status, summary, evidence, open questions, and stop reasons.",
      modification: "Modify a skill in place for local wording or path changes, wrap it for host-specific guardrails, and fork it when ownership, permission tiers, or eval gates diverge.",
    },
    skills: [
      {
        id: `${manifest.slug}-operating-skill`,
        type: "core",
        title: `${spec.projectName} operating skill`,
        purpose: spec.description,
        whenToUse: `Load when running, installing, evaluating, or modifying ${spec.projectName}.`,
        inputs: spec.inputs,
        outputs: spec.outputs,
        tools: spec.tools.map((tool) => tool.name),
        memory: ["memory/domain-playbook.md", "memory/learning-ledger.json"],
        evals: ["evals/golden-tasks.json", "evals/regression-scenarios.json"],
        requiredFiles: ["system-prompt.md", "manifest.json", "agent.yaml", "tools.json", "context/input-contract.md"],
      },
      ...nodeSkills,
      ...emittedSkills,
    ],
    chains: (spec.edges ?? []).map((edge) => ({
      id: `${slugify(edge.from)}-to-${slugify(edge.to)}`,
      fromSkill: nodeSkillId(manifest, { id: edge.from }),
      toSkill: nodeSkillId(manifest, { id: edge.to }),
      handoff: edge.label ?? "handoff",
      requiredFields: ["status", "summary", "inputs", "outputs", "evidence", "openQuestions", "stopReason"],
    })),
  };
}

function buildSkillContractMarkdown(spec, manifest) {
  const nodeSections = spec.nodes
    .map((node) => `### ${node.title}

- Skill ID: \`${nodeSkillId(manifest, node)}\`
- Node ID: \`${node.id}\`
- Kind: \`${node.kind}\`
- Load when: ${node.description}
- Inputs:
${markdownList(node.inputs?.map((input) => `\`${input}\``))}
- Outputs:
${markdownList(node.outputs?.map((output) => `\`${output}\``))}
- Tool scope:
${markdownList(node.tools?.map((tool) => `\`${tool}\``))}
- Permission default: \`${node.permission ?? "ask-first"}\`
`)
    .join("\n");

  const chains = spec.edges?.length
    ? spec.edges.map((edge) => `- \`${nodeSkillId(manifest, { id: edge.from })}\` -> \`${nodeSkillId(manifest, { id: edge.to })}\`: ${edge.label ?? "handoff"}`).join("\n")
    : "- none";

  return `# Skill Contract

This file turns the generated graph into reusable skill slots. Use it when installing this package into Claude, Codex, an API-key runtime, or another agent host.

## Core Skill

- Skill ID: \`${manifest.slug}-operating-skill\`
- Purpose: ${spec.description}
- Required files: \`system-prompt.md\`, \`manifest.json\`, \`agent.yaml\`, \`tools.json\`, \`context/input-contract.md\`
- Memory files: \`memory/domain-playbook.md\`, \`memory/learning-ledger.json\`
- Eval files: \`evals/golden-tasks.json\`, \`evals/regression-scenarios.json\`

## Skill Slots

${nodeSections}

## Skill Chaining

Use chaining only when the receiving skill needs a finished output, evidence bundle, or stop reason from the previous skill. Do not chain for unrelated context loading.

${chains}

Every chain handoff must include:

- \`status\`
- \`summary\`
- \`inputs\`
- \`outputs\`
- \`evidence\`
- \`openQuestions\`
- \`stopReason\`

## Modification Rules

1. Modify in place when only paths, examples, local naming, or host wording changes.
2. Wrap the skill when adding host-specific permissions, output formatting, logging, or approval gates.
3. Fork the skill when the owner, permission tier, eval gate, or durable memory store changes.
4. Keep skill changes paired with \`evals/golden-tasks.json\` updates when behavior changes.

${buildComponentModelSection()}`;
}

function buildHostDeploymentMarkdown(spec, manifest) {
  const providerEnv = providerEnvRequirements(spec);
  const requiredKeys = providerEnv.required.length
    ? providerEnv.required.map((name) => `\`${name}\``).join(", ")
    : providerEnv.anyOf.length
      ? providerEnv.anyOf[0].vars.map((name) => `\`${name}\``).join(" or ")
      : "none for this provider configuration";

  return `# Host Deployment

Use this guide to install \`${manifest.slug}\` into an API-key runtime, Claude, Codex, or a hybrid multi-agent setup without depending on the Agent Builder source tree.

## Shared Readiness Gates

1. Copy this package as one folder.
2. Set required API-key environment variables: ${requiredKeys}.
3. Run \`npm run setup:check\`.
4. Run \`npm run runtime:check\`.
5. Run the golden tasks in \`evals/golden-tasks.json\`.
6. Keep accepted lessons in \`memory/domain-playbook.md\` and scenario history in \`memory/learning-ledger.json\`.

## API-key Runtime

- Load \`manifest.json\`, \`system-prompt.md\`, \`tools.json\`, \`skills/skill-bank.json\`, and \`context/input-contract.md\`.
- Use \`tools.json\` as the permission source before every side effect.
- Use \`skills/skill-contract.md\` to split work into reusable callable skills or functions.
- Keep secrets in the host environment or secret manager, never in package files.

## Claude

- Use \`system-prompt.md\` as the primary instruction body.
- Convert graph-node entries from \`skills/skill-bank.json\` into Claude skills or subagents only when isolated context is useful.
- Keep \`skills/skill-contract.md\` with the skill files so handoffs, modification rules, and eval gates remain visible.
- Run the package evals after changing instructions or tool permissions.

## Codex

- Use \`system-prompt.md\` and \`manifest.json\` as the agent contract, then map repo-local instructions into \`AGENTS.md\` or Codex skills.
- Keep \`tools.json\` as the allowlist/approval reference.
- Use \`skills/skill-bank.json\` to decide which skill to load for each graph phase.
- Run \`npm run setup:check\`, \`npm run runtime:check\`, and the relevant repo tests before delivery.

## Hybrid Host

- Keep \`manifest.json\`, \`tools.json\`, \`skills/skill-bank.json\`, \`memory/\`, and \`evals/\` as shared truth.
- Assign one owner per skill chain handoff.
- Use the chain fields from \`skills/skill-contract.md\` for cross-agent handoff envelopes.
- Treat eval failures as blockers before promoting memory or widening autonomy.
`;
}

function buildReadme(spec, manifest, packageFiles) {
  return `# ${spec.projectName}

${spec.description}

This directory is an installable Agent Builder package. Copy the whole folder, not individual files, into another project's agent directory and point that runtime at \`manifest.json\` or \`agent.yaml\`.

## Generated Files

${packageFiles.map((file) => `- \`${file}\``).join("\n")}

## Runtime

- Pattern: ${manifest.pattern.name} (${manifest.pattern.type})
- Framework: ${manifest.framework.label}
- Model provider: ${spec.modelProvider}
- Sandbox: ${spec.sandbox}
- Spec profile: ${manifest.specProfile.label} (${manifest.specProfile.validationLevel})

## Required Contracts

${manifest.specProfile.contractFiles.map((file) => `- \`${file}\``).join("\n")}

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

Install this package with \`INSTALL.md\`. If the host already supports ${manifest.framework.label}, point it at \`manifest.json\`; otherwise start from \`runtime/adapters/${spec.framework}.md\` and \`runtime/custom-loop-adapter.mjs\`.
`;
}

function buildInstallMarkdown(spec, manifest) {
  return `# Install ${spec.projectName}

This folder is the complete generated agent package for \`${manifest.slug}\`.

## Package Folder

- Canonical builder output: \`generated/agents/${manifest.slug}/\`
- Package root after copying elsewhere: this directory
- Required entrypoints: \`manifest.json\`, \`agent.yaml\`, \`system-prompt.md\`, \`tools.json\`, \`skills/skill-bank.json\`
- Setup contract: \`setup/requirements.json\`
- Environment template: \`setup/env.example\`
- Input contract: \`context/input-contract.md\`
- Skill contract: \`skills/skill-contract.md\`
- Host deployment guide: \`setup/host-deployment.md\`
- Runtime adapter contract: \`runtime/adapter-contract.md\`
- Spec profile: \`contracts/spec-profile.json\`
- Profile contracts: ${manifest.specProfile.contractFiles.map((file) => `\`${file}\``).join(", ")}

## Install Into Another Project

1. Copy the entire \`generated/agents/${manifest.slug}/\` folder into the target location, for example \`agents/${manifest.slug}/\`.
2. From inside the copied folder, inspect \`setup/requirements.json\` and copy \`setup/env.example\` to the target host's secret/env mechanism.
3. Run \`npm run setup:check\` to verify required files, API-key environment variables, local-model runner expectations, and vector-store setup notes.
4. Run \`npm run runtime:check\` for a local adapter fixture check.
5. Point the target runtime or adapter at \`manifest.json\`.
6. Keep the relative subfolders intact: \`prompts/\`, \`skills/\`, \`evals/\`, \`memory/\`, \`setup/\`, \`context/\`, \`runtime/\`, and \`scripts/\`.
7. Run the golden tasks in \`evals/golden-tasks.json\` before treating the installed agent as ready.

## Do Not Split These Files

The package contract depends on the manifest, graph, tools, prompt contract, evals, and memory files staying together. If a host needs a different install path, copy the folder as a unit and adapt paths at the host boundary.
`;
}

function buildAgentPackageManifest(spec, manifest, packageFiles) {
  return {
    schemaVersion: "agent-builder.package.v1",
    packageType: "installable-agent",
    selfContained: true,
    name: spec.projectName,
    slug: manifest.slug,
    canonicalBuilderOutput: `generated/agents/${manifest.slug}`,
    packageRoot: ".",
    entrypoints: {
      manifest: "manifest.json",
      agentConfig: "agent.yaml",
      systemPrompt: "system-prompt.md",
      tools: "tools.json",
      skillBank: "skills/skill-bank.json",
      skillContract: "skills/skill-contract.md",
      install: "INSTALL.md",
      requirements: "setup/requirements.json",
      envTemplate: "setup/env.example",
      hostDeployment: "setup/host-deployment.md",
      inputContract: "context/input-contract.md",
      setupCheck: "scripts/setup-check.mjs",
      runtimeAdapterContract: "runtime/adapter-contract.md",
      runtimeCheck: "runtime/custom-loop-adapter.mjs",
      specProfile: "contracts/spec-profile.json",
    },
    specProfile: manifest.specProfile,
    installTargets: [
      `agents/${manifest.slug}`,
      `.agents/${manifest.slug}`,
      `generated/agents/${manifest.slug}`,
    ],
    files: packageFiles,
    setup: {
      requirements: "setup/requirements.json",
      envTemplate: "setup/env.example",
      hostDeployment: "setup/host-deployment.md",
      setupCheckCommand: "npm run setup:check",
      vectorStoreGuide: "setup/vector-store.md",
      localModelGuide: "setup/local-models.md",
    },
    runtime: {
      adapterContract: "runtime/adapter-contract.md",
      fixtureCheckCommand: "npm run runtime:check",
      selectedFrameworkGuide: `runtime/adapters/${spec.framework}.md`,
      genericAdapter: "runtime/custom-loop-adapter.mjs",
      supportedFrameworkGuides: Object.keys(FRAMEWORK_ADAPTER_GUIDES).map((id) => `runtime/adapters/${id}.md`),
    },
    copyPolicy: "copy-directory-as-unit",
    createdAt: manifest.createdAt,
  };
}

function buildPortablePackageJson(spec, manifest, emittedDependencies = {}) {
  return {
    name: `agent-builder-${manifest.slug}`,
    version: "0.0.0",
    private: true,
    type: "module",
    description: `Portable Agent Builder package for ${spec.projectName}.`,
    scripts: {
      "setup:check": "node scripts/setup-check.mjs",
      "runtime:check": "node runtime/custom-loop-adapter.mjs --fixture",
      validate: "node scripts/setup-check.mjs",
    },
    ...(Object.keys(emittedDependencies).length ? { dependencies: emittedDependencies } : {}),
  };
}

function providerEnvRequirements(spec) {
  const provider = String(spec.modelProvider ?? "").toLowerCase();
  if (provider === "openai") return { required: ["OPENAI_API_KEY"], anyOf: [] };
  if (provider === "anthropic") return { required: ["ANTHROPIC_API_KEY"], anyOf: [] };
  if (provider === "groq") return { required: ["GROQ_API_KEY"], anyOf: [] };
  if (provider === "multi-provider") {
    return {
      required: [],
      anyOf: [{ name: "cloud_llm_api_key", vars: ["GROQ_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"] }],
    };
  }
  return { required: [], anyOf: [] };
}

function inferLocalModels(spec) {
  const models = [
    spec.modelProfiles?.primary,
    ...(spec.modelProfiles?.fallbacks ?? []),
    ...(spec.modelProfiles?.stretch ?? []),
  ].filter(Boolean);

  return {
    required: String(spec.modelProvider ?? "").toLowerCase() === "ollama" || models.length > 0,
    runner: spec.modelProfiles?.runner ?? (String(spec.modelProvider ?? "").toLowerCase() === "ollama" ? "Ollama" : null),
    hardwareTarget: spec.modelProfiles?.hardwareTarget ?? null,
    contextPolicy: spec.modelProfiles?.contextPolicy ?? null,
    models,
  };
}

function inferVectorStore(spec) {
  const haystack = JSON.stringify({
    description: spec.description,
    inputs: spec.inputs,
    outputs: spec.outputs,
    memory: spec.memory,
    tools: spec.tools,
  }).toLowerCase();
  const required = /\b(vector|embedding|embeddings|semantic|rag|retrieval|similarity)\b/.test(haystack);
  return {
    required,
    defaultPath: "data/vector-store",
    envVars: required ? ["VECTOR_STORE_PATH"] : [],
    note: required
      ? "Create or point VECTOR_STORE_PATH at a local vector-store directory before running retrieval-backed steps."
      : "No vector database is required by this generated spec. Persistent context is stored in memory/ unless you add retrieval-backed memory later.",
  };
}

function buildSetupRequirements(spec, manifest, packageFiles) {
  const providerEnv = providerEnvRequirements(spec);
  const localModels = inferLocalModels(spec);
  const vectorStore = inferVectorStore(spec);
  const optionalEnv = new Set(["AGENT_PACKAGE_ROOT"]);
  if (localModels.runner === "Ollama") optionalEnv.add("OLLAMA_BASE_URL");
  for (const variable of vectorStore.envVars) optionalEnv.add(variable);

  return {
    schemaVersion: "agent-builder.setup-requirements.v1",
    agent: spec.projectName,
    slug: manifest.slug,
    packageRoot: ".",
    requiredFiles: packageFiles,
    specProfile: manifest.specProfile,
    runtime: {
      framework: spec.framework,
      modelProvider: spec.modelProvider,
      sandbox: spec.sandbox,
    },
    environment: {
      required: providerEnv.required,
      anyOf: providerEnv.anyOf,
      optional: [...optionalEnv],
      secretPolicy: "Set real API keys in the host environment or secret manager. Do not paste secrets into manifest.json, agent.yaml, prompts, evals, or memory files.",
    },
    localModels,
    vectorStore,
    inputs: spec.inputs.map((name) => ({ name, required: true, source: "operator or host runtime" })),
    outputs: spec.outputs,
    installCheckCommand: "npm run setup:check",
  };
}

function buildEnvExample(spec) {
  const providerEnv = providerEnvRequirements(spec);
  const localModels = inferLocalModels(spec);
  const vectorStore = inferVectorStore(spec);
  const variables = new Set([...providerEnv.required, ...providerEnv.anyOf.flatMap((group) => group.vars)]);
  if (localModels.runner === "Ollama") variables.add("OLLAMA_BASE_URL");
  for (const variable of vectorStore.envVars) variables.add(variable);
  variables.add("AGENT_PACKAGE_ROOT");

  const defaults = {
    OLLAMA_BASE_URL: "http://localhost:11434",
    VECTOR_STORE_PATH: "./data/vector-store",
    AGENT_PACKAGE_ROOT: ".",
  };
  const rows = [
    "# Copy this template into the target host's environment or secret manager.",
    "# Fill only the variables required by setup/requirements.json.",
    "# Never commit real API keys.",
    "",
  ];
  for (const variable of variables) {
    rows.push(`${variable}=${defaults[variable] ?? ""}`);
  }
  return `${rows.join("\n")}\n`;
}

function buildInstallChecklist(spec, manifest) {
  const localModels = inferLocalModels(spec);
  const vectorStore = inferVectorStore(spec);
  const providerEnv = providerEnvRequirements(spec);
  const envLine = providerEnv.required.length
    ? `Set required environment variables: ${providerEnv.required.map((item) => `\`${item}\``).join(", ")}.`
    : providerEnv.anyOf.length
      ? `Set at least one provider key from: ${providerEnv.anyOf[0].vars.map((item) => `\`${item}\``).join(", ")}.`
      : "No cloud API key is required by the current provider configuration.";
  const modelLine = localModels.required
    ? `Install the local model runner and pull the required model(s): ${localModels.models.map((item) => `\`${item.install}\``).join(", ")}.`
    : "No local LLM download is required by this spec.";
  const vectorLine = vectorStore.required
    ? `Create the vector-store directory and set \`${vectorStore.envVars[0]}\`, defaulting to \`${vectorStore.defaultPath}\`.`
    : "No vector database setup is required unless you add retrieval-backed memory.";

  return `# Install Checklist

1. Copy \`generated/agents/${manifest.slug}/\` as one folder.
2. Keep \`agent-package.json\`, \`manifest.json\`, \`agent.yaml\`, \`setup/\`, \`context/\`, \`skills/\`, \`runtime/\`, \`evals/\`, \`memory/\`, and \`prompts/\` together.
3. ${envLine}
4. ${modelLine}
5. ${vectorLine}
6. Run \`npm run setup:check\` from inside this folder.
7. Point the host runtime at \`manifest.json\`.
8. Run \`evals/golden-tasks.json\` before production use.
`;
}

function buildLocalModelsMarkdown(spec) {
  const localModels = inferLocalModels(spec);
  if (!localModels.required) {
    return `# Local Models

No local LLM is required by this generated spec.

Model provider: \`${spec.modelProvider}\`

If you later switch this agent to Ollama or another local runner, update \`setup/requirements.json\`, add model install commands here, and re-run \`npm run setup:check\`.
`;
  }

  return `# Local Models

- Runner: ${localModels.runner}
- Hardware target: ${localModels.hardwareTarget ?? "not specified"}
- Context policy: ${localModels.contextPolicy ?? "not specified"}

## Install Commands

${localModels.models.map((item) => `- \`${item.install}\` — ${item.use}`).join("\n")}

## Verification

1. Install the runner on the target laptop.
2. Run each install command above.
3. Run \`npm run setup:check\` from this package folder.
`;
}

function buildVectorStoreMarkdown(spec) {
  const vectorStore = inferVectorStore(spec);
  if (!vectorStore.required) {
    return `# Vector Store

No vector database is required by this generated spec.

The package is still self-contained for future retrieval upgrades:

- Setup contract: \`setup/requirements.json\`
- Default local vector path if enabled later: \`${vectorStore.defaultPath}\`
- Persistent non-vector memory: \`memory/domain-playbook.md\` and \`memory/learning-ledger.json\`
`;
  }

  return `# Vector Store

This generated spec appears to need retrieval, embeddings, or vector memory.

## Default Local Setup

1. Create \`${vectorStore.defaultPath}/\` inside this package or point \`VECTOR_STORE_PATH\` at another local path.
2. Ingest source documents with stable IDs and source metadata before retrieval-backed steps run.
3. Keep the vector-store index and source manifests together when moving the agent to another laptop.

## Required Env

- \`VECTOR_STORE_PATH\`
`;
}

function buildInputContractMarkdown(spec) {
  return `# Input Contract

This file defines the context the host runtime must provide when installing or running this agent.

## Required Inputs

${spec.inputs.map((input) => `- \`${input}\` — provide through the host runtime, CLI, UI, or local files before the graph runs.`).join("\n")}

## Expected Outputs

${spec.outputs.map((output) => `- \`${output}\``).join("\n")}

## Context Portability

- Keep this folder together when moving machines.
- Put durable, human-readable project context in \`memory/domain-playbook.md\`.
- Put run history and candidate lessons in \`memory/learning-ledger.json\`.
- Put local setup values in the host environment using \`setup/env.example\`; do not store secrets in this folder.
`;
}

function buildRuntimeReadme(spec, manifest) {
  return `# Runtime Adapter

This folder contains the execution contract for \`${manifest.slug}\`.

## What Is Included

- \`adapter-contract.md\` defines the stable host/runtime contract.
- \`custom-loop-adapter.mjs\` is a zero-dependency fixture adapter that loads the package, checks required inputs, and exposes the package metadata a host runtime needs.
- \`adapters/\` contains framework-specific install notes for every framework Agent Builder supports.

## Local Check

\`\`\`bash
npm run runtime:check
\`\`\`

The fixture check does not call an LLM. It proves the package can be loaded from its own folder, that required inputs are discoverable, and that graph/tool metadata can be read without the Agent Builder repo.

## Selected Framework

- Framework: ${manifest.framework.label}
- Guide: \`runtime/adapters/${spec.framework}.md\`
`;
}

function buildAdapterContractMarkdown(spec, manifest) {
  return `# Adapter Contract

This contract lets a host runtime execute the agent without relying on the Agent Builder source tree.

## Package Boundary

- Package root: this directory's parent folder
- Manifest: \`manifest.json\`
- Graph: \`agent.yaml\` and \`manifest.json.graph\`
- System prompt: \`system-prompt.md\`
- Tool policy: \`tools.json\`
- Skill bank: \`skills/skill-bank.json\`
- Skill contract: \`skills/skill-contract.md\`
- Setup requirements: \`setup/requirements.json\`
- Spec profile: \`contracts/spec-profile.json\`
- Profile contracts: ${manifest.specProfile.contractFiles.map((file) => `\`${file}\``).join(", ")}
- Memory: \`memory/\`
- Evals: \`evals/\`

## Host Responsibilities

1. Load \`manifest.json\`, \`tools.json\`, \`skills/skill-bank.json\`, \`system-prompt.md\`, and \`context/input-contract.md\`.
2. Provide required inputs: ${spec.inputs.map((input) => `\`${input}\``).join(", ")}.
3. Enforce \`tools.json.policy\` and each tool's \`permission\` before side effects.
4. Execute graph nodes in dependency order or through the selected framework's native graph/handoff primitive.
5. Emit required outputs: ${spec.outputs.map((output) => `\`${output}\``).join(", ")}.
6. Write run traces and accepted lessons under \`memory/\` only after eval-gated review.
7. Run \`evals/golden-tasks.json\` before treating the installed package as production-ready.

## Adapter Output Shape

\`\`\`json
{
  "agent": "${spec.projectName}",
  "slug": "${manifest.slug}",
  "status": "ready | blocked | failed",
  "missingInputs": [],
  "outputs": {},
  "toolTrace": [],
  "evalSummary": {}
}
\`\`\`
`;
}

function buildCustomLoopAdapterScript() {
  return `import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

export function loadAgentPackage(packageRoot = root) {
  const manifest = readJson(packageRoot, "manifest.json");
  const tools = readJson(packageRoot, "tools.json");
  const skillBank = readJson(packageRoot, "skills/skill-bank.json");
  const requirements = readJson(packageRoot, "setup/requirements.json");
  const systemPrompt = readText(packageRoot, "system-prompt.md");
  const inputContract = readText(packageRoot, "context/input-contract.md");
  const agentYaml = readText(packageRoot, "agent.yaml");

  return {
    packageRoot,
    manifest,
    tools,
    skillBank,
    requirements,
    systemPrompt,
    inputContract,
    agentYaml,
  };
}

export function runFixture(input = {}, packageRoot = root) {
  const loaded = loadAgentPackage(packageRoot);
  const requiredInputs = loaded.manifest.inputs ?? [];
  const missingInputs = requiredInputs.filter((name) => input[name] === undefined);
  return {
    agent: loaded.manifest.name,
    slug: loaded.manifest.slug,
    status: missingInputs.length ? "blocked" : "ready",
    missingInputs,
    graph: {
      nodes: loaded.manifest.graph?.nodes?.map((node) => node.id) ?? [],
      edges: loaded.manifest.graph?.edges?.length ?? 0,
    },
    tools: loaded.tools.tools?.map((tool) => ({
      name: tool.name,
      permission: tool.permission,
      sideEffect: tool.sideEffect,
    })) ?? [],
    skills: loaded.skillBank.skills?.map((skill) => skill.id) ?? [],
    outputs: Object.fromEntries((loaded.manifest.outputs ?? []).map((name) => [name, null])),
    evalSummary: {
      goldenTasks: readJson(packageRoot, "evals/golden-tasks.json").goldenTasks?.length ?? 0,
      status: "not-run",
    },
  };
}

function readJson(packageRoot, path) {
  return JSON.parse(readText(packageRoot, path));
}

function readText(packageRoot, path) {
  const target = resolve(packageRoot, path);
  if (!existsSync(target)) throw new Error(\`Missing required package file: \${path}\`);
  return readFileSync(target, "utf8");
}

if (process.argv.includes("--fixture")) {
  const loaded = loadAgentPackage(root);
  const fixtureInput = Object.fromEntries((loaded.manifest.inputs ?? []).map((name) => [name, \`fixture:\${name}\`]));
  console.log(JSON.stringify(runFixture(fixtureInput, root), null, 2));
}
`;
}

function buildFrameworkAdapterGuide(id, spec, manifest) {
  const guide = FRAMEWORK_ADAPTER_GUIDES[id];
  return `# ${frameworkLabel(id)} Adapter Guide

Use this guide when installing \`${manifest.slug}\` into a ${frameworkLabel(id)} host.

## Language

${guide.language}

## Install

${guide.install}

## Runtime Mapping

${guide.runtime}

## Package Inputs

${spec.inputs.map((input) => `- \`${input}\``).join("\n")}

## Package Outputs

${spec.outputs.map((output) => `- \`${output}\``).join("\n")}

## Required Contract Files

- \`manifest.json\`
- \`agent.yaml\`
- \`system-prompt.md\`
- \`tools.json\`
- \`skills/skill-bank.json\`
- \`skills/skill-contract.md\`
- \`setup/requirements.json\`
- \`setup/host-deployment.md\`
- \`context/input-contract.md\`
- \`evals/golden-tasks.json\`
${manifest.specProfile.contractFiles.map((file) => `- \`${file}\``).join("\n")}

## Acceptance Check

Before production use, run:

\`\`\`bash
npm run setup:check
npm run runtime:check
\`\`\`
`;
}

function buildSetupCheckScript() {
  return `import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const requirements = JSON.parse(readFileSync(resolve(root, "setup/requirements.json"), "utf8"));
const missingFiles = requirements.requiredFiles.filter((file) => !existsSync(resolve(root, file)));
const missingEnv = requirements.environment.required.filter((name) => !process.env[name]);
const missingGroups = requirements.environment.anyOf.filter((group) => !group.vars.some((name) => process.env[name]));
const checks = {
  packageRoot: root,
  missingFiles,
  missingEnv,
  missingAnyOfGroups: missingGroups.map((group) => ({ name: group.name, vars: group.vars })),
  localModels: { required: requirements.localModels.required, runner: requirements.localModels.runner, runnerDetected: null },
  vectorStore: requirements.vectorStore,
};

if (requirements.localModels.required && requirements.localModels.runner === "Ollama") {
  const result = spawnSync("ollama", ["--version"], { encoding: "utf8" });
  checks.localModels.runnerDetected = result.status === 0;
}

console.log(JSON.stringify(checks, null, 2));

if (missingFiles.length || missingEnv.length || missingGroups.length || checks.localModels.runnerDetected === false) {
  process.exit(1);
}
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
  const specProfile = inferSpecProfile(spec, findPattern(spec.patternId));
  const manifest = buildManifest(spec, createdAt, specProfile);
  // Conditional capabilities (doc-ingest / threat-modeler / pyramid-principle)
  // resolved from the spec — one canonical surface each, emitted only when
  // the spec warrants it (no decorative slots).
  const emitted = resolveEmittedCapabilities(spec, manifest);
  manifest.governance = buildGovernanceManifest(spec, specProfile, emitted.tools);
  const contractFiles = buildContractFiles(spec, manifest, emitted.tools);
  const packageFiles = [
    ...new Set([
      ...CORE_FILES,
      ...contractFiles.map((file) => file.path),
      ...emitted.files.map((file) => file.path),
    ]),
  ];
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
    specProfile: manifest.specProfile,
    interaction: manifest.interaction,
    memory: spec.memory,
    permissions: spec.permissions,
    governance: manifest.governance,
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
    { path: "agent-package.json", content: `${JSON.stringify(buildAgentPackageManifest(spec, manifest, packageFiles), null, 2)}\n` },
    { path: "package.json", content: `${JSON.stringify(buildPortablePackageJson(spec, manifest, emitted.dependencies), null, 2)}\n` },
    { path: "agent.yaml", content: `${toYaml(agentConfig)}\n` },
    { path: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: "INSTALL.md", content: buildInstallMarkdown(spec, manifest) },
    { path: "system-prompt.md", content: buildSystemPrompt(spec, specProfile) },
    { path: "prompts/prompt-builder-contract.md", content: buildPromptBuilderContract(spec, { frameworkLabel }) },
    { path: "skills/skill-bank.json", content: `${JSON.stringify(buildSkillBank(spec, manifest, emitted.skills), null, 2)}\n` },
    { path: "skills/skill-contract.md", content: buildSkillContractMarkdown(spec, manifest) },
    { path: "context/input-contract.md", content: buildInputContractMarkdown(spec) },
    { path: "tools.json", content: `${JSON.stringify(buildTools(spec, emitted.tools), null, 2)}\n` },
    ...contractFiles,
    { path: "setup/requirements.json", content: `${JSON.stringify(buildSetupRequirements(spec, manifest, packageFiles), null, 2)}\n` },
    { path: "setup/env.example", content: buildEnvExample(spec) },
    { path: "setup/install-checklist.md", content: buildInstallChecklist(spec, manifest) },
    { path: "setup/host-deployment.md", content: buildHostDeploymentMarkdown(spec, manifest) },
    { path: "setup/local-models.md", content: buildLocalModelsMarkdown(spec) },
    { path: "setup/vector-store.md", content: buildVectorStoreMarkdown(spec) },
    { path: "scripts/setup-check.mjs", content: buildSetupCheckScript() },
    { path: "runtime/README.md", content: buildRuntimeReadme(spec, manifest) },
    { path: "runtime/adapter-contract.md", content: buildAdapterContractMarkdown(spec, manifest) },
    { path: "runtime/custom-loop-adapter.mjs", content: buildCustomLoopAdapterScript() },
    ...Object.keys(FRAMEWORK_ADAPTER_GUIDES).map((id) => ({
      path: `runtime/adapters/${id}.md`,
      content: buildFrameworkAdapterGuide(id, spec, manifest),
    })),
    { path: "evals/golden-tasks.json", content: `${JSON.stringify(evals, null, 2)}\n` },
    { path: "evals/regression-scenarios.json", content: `${JSON.stringify(regressionScenarios, null, 2)}\n` },
    { path: "memory/domain-playbook.md", content: buildDomainPlaybook(spec) },
    { path: "memory/learning-ledger.json", content: `${JSON.stringify(buildLearningLedger(spec, createdAt), null, 2)}\n` },
    { path: "README.md", content: buildReadme(spec, manifest, packageFiles) },
    { path: "sources.md", content: buildSourcesMarkdown(spec) },
    ...emitted.files,
  ];

  return {
    slug: manifest.slug,
    spec,
    files,
    warnings: buildWarnings(spec),
    emitted: emitted.summary,
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
