const PROFILE_ALIASES = {
  local: "personal",
  individual: "personal",
  prototype: "personal",
  personal: "personal",
  skill: "skill",
  "skill-only": "skill",
  team: "team",
  workflow: "team",
  departmental: "team",
  enterprise: "enterprise",
  production: "enterprise",
  regulated: "enterprise",
};

export const HUMAN_CHECKPOINT_NODE_KINDS = ["approval", "review"];
export const READINESS_CHECKPOINT_NODE_KINDS = ["approval", "review", "verifier", "guardrail", "eval"];

export const SPEC_PROFILE_DEFINITIONS = {
  skill: {
    id: "skill",
    label: "Skill or prompt package",
    validationLevel: "contract-light",
    audience: "Host agents that import the skill",
    requiredContracts: ["skill-contract"],
    validationFocus: [
      "Clear trigger conditions",
      "Input and output shape",
      "Host permission assumptions",
      "Small fixture-based acceptance checks",
    ],
  },
  personal: {
    id: "personal",
    label: "Personal or local agent",
    validationLevel: "local-safe",
    audience: "One user or a local workspace",
    requiredContracts: ["system-boundary", "tool-contracts", "observability"],
    validationFocus: [
      "Explicit tool permissions",
      "Local sandbox or read-only boundaries",
      "Visible stop reasons",
      "Golden task regression checks",
    ],
  },
  team: {
    id: "team",
    label: "Team workflow agent",
    validationLevel: "workflow-governed",
    audience: "A team or shared workflow",
    requiredContracts: [
      "system-boundary",
      "tool-contracts",
      "flow-topology",
      "guardrails",
      "human-checkpoints",
      "observability",
    ],
    validationFocus: [
      "State ownership",
      "Approval or review checkpoints",
      "Tool permission tiers",
      "Regression scenarios for handoffs and retries",
    ],
  },
  enterprise: {
    id: "enterprise",
    label: "Enterprise governed runtime",
    validationLevel: "enterprise-governed",
    audience: "Production users, systems of record, or regulated workflows",
    requiredContracts: [
      "system-boundary",
      "agent-registry",
      "tool-contracts",
      "flow-topology",
      "guardrails",
      "human-checkpoints",
      "observability",
      "lifecycle",
    ],
    validationFocus: [
      "Identity and owner registry",
      "IAM and permission tiers",
      "Audit events and run traces",
      "Lifecycle, rollback, and deactivation",
      "Eval-gated promotion",
    ],
  },
};

const CONTRACT_PATHS = {
  "skill-contract": "skills/skill-contract.md",
  "system-boundary": "contracts/system-boundary.yaml",
  "agent-registry": "contracts/agent-registry.yaml",
  "tool-contracts": "contracts/tool-contracts.yaml",
  "flow-topology": "contracts/flow-topology.yaml",
  guardrails: "contracts/guardrails.yaml",
  "human-checkpoints": "contracts/human-checkpoints.yaml",
  observability: "contracts/observability.yaml",
  lifecycle: "contracts/lifecycle.yaml",
};

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textIncludesAny(value, terms) {
  const text = String(value ?? "").toLowerCase();
  return terms.some((term) => {
    const normalized = String(term).toLowerCase();
    if (normalized.includes(" ")) {
      const phrase = normalized.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
      return new RegExp(`\\b${phrase}\\b`).test(text);
    }
    return new RegExp(`\\b${escapeRegExp(normalized)}\\b`).test(text);
  });
}

function containsProductionSignal(value) {
  return /(^|[^a-z0-9-])production\b/.test(String(value ?? "").toLowerCase());
}

function containsPrivilegedActionSignal(value) {
  return /(^|[^a-z0-9])(delete|deletes|deleted|deleting|deletion|payment|payments|deploy|deploys|deployed|deploying|deployment|credential|credentials|admin|destructive|privileged)\b/.test(
    String(value ?? "").toLowerCase(),
  );
}

function profileIdFrom(input) {
  if (!input) return undefined;
  if (typeof input === "string") return PROFILE_ALIASES[input.toLowerCase()] ?? input.toLowerCase();
  if (typeof input === "object") {
    return profileIdFrom(input.id ?? input.profile ?? input.class ?? input.kind ?? input.deploymentClass);
  }
  return undefined;
}

function normalizeProfileId(input) {
  const id = profileIdFrom(input);
  return SPEC_PROFILE_DEFINITIONS[id] ? id : undefined;
}

function hasHumanCheckpoint(spec) {
  return (spec.nodes ?? []).some((node) => HUMAN_CHECKPOINT_NODE_KINDS.includes(node.kind));
}

function hasMultiAgentTopology(spec, pattern = {}) {
  const type = String(pattern.type ?? "").toLowerCase();
  const agentLike = (spec.nodes ?? []).filter((node) => ["agent", "orchestrator", "planner", "executor"].includes(node.kind))
    .length;
  const match = type.match(/\btype\s+(iii|iv|ii|v|i)\b/);
  const level = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 }[match?.[1]] ?? 0;
  return level >= 3 || agentLike > 3;
}

function hasEnterpriseSignals(spec) {
  if (spec.enterprise === true || spec.production === true || spec.regulated === true) return true;
  if (normalizeProfileId(spec.validationProfile ?? spec.specProfile ?? spec.deploymentClass ?? spec.agentClass) === "enterprise") {
    return true;
  }
  if (textIncludesAny(spec.riskTier, ["high", "regulated", "critical"])) return true;
  const combined = [
    spec.projectName,
    spec.description,
    spec.runtime,
    spec.framework,
    ...(spec.outputs ?? []),
    ...(spec.inputs ?? []),
    ...(spec.tools ?? []).map((tool) => `${tool.name} ${tool.responsibility} ${tool.permission}`),
  ].join(" ");
  return (
    containsProductionSignal(combined) ||
    textIncludesAny(combined, [
      "enterprise",
      "regulated",
      "sox",
      "hipaa",
      "pci",
      "soc2",
      "customer data",
      "system of record",
      "iam",
    ])
  );
}

function hasSharedWorkflowSignals(spec, pattern = {}) {
  const runtime = String(spec.runtime ?? "").toLowerCase();
  return (
    runtime.includes("hosted") ||
    runtime.includes("hybrid") ||
    hasHumanCheckpoint(spec) ||
    hasMultiAgentTopology(spec, pattern)
  );
}

function buildProfile(id, reason, explicit = false) {
  const definition = SPEC_PROFILE_DEFINITIONS[id] ?? SPEC_PROFILE_DEFINITIONS.personal;
  return {
    ...definition,
    explicit,
    inferredReason: reason,
    contractFiles: profileContractPaths(definition),
  };
}

export function inferSpecProfile(spec = {}, pattern = {}) {
  const explicitInput = spec.validationProfile ?? spec.specProfile ?? spec.deploymentClass ?? spec.agentClass;
  const explicitProvided =
    explicitInput !== undefined &&
    explicitInput !== null &&
    explicitInput !== false &&
    !(typeof explicitInput === "string" && explicitInput.trim() === "");
  const explicitId = normalizeProfileId(explicitInput);
  if (explicitProvided && !explicitId) {
    throw new Error(`Unknown validation profile: ${JSON.stringify(explicitInput)}`);
  }
  if (explicitId) {
    return buildProfile(explicitId, "Explicit profile declared by the spec.", true);
  }

  if (hasEnterpriseSignals(spec)) {
    return buildProfile("enterprise", "Enterprise or regulated runtime signal detected.");
  }

  if (hasSharedWorkflowSignals(spec, pattern)) {
    return buildProfile("team", "Shared workflow, hosted runtime, multi-agent topology, or checkpoint signal detected.");
  }

  return buildProfile("personal", "No shared runtime, regulated workflow, or high-risk side-effect signal detected.");
}

export function profileContractPaths(profile) {
  const required = profile.requiredContracts ?? [];
  return [
    "contracts/spec-profile.json",
    ...required.map((contract) => CONTRACT_PATHS[contract]).filter(Boolean),
  ];
}

export function mapToolPermissionTier(tool = {}) {
  const text = `${tool.name ?? ""} ${tool.responsibility ?? ""} ${tool.permission ?? ""}`.toLowerCase();
  const sideEffect = String(tool.sideEffect ?? "").toLowerCase();
  if (["destructive", "privileged", "admin"].includes(sideEffect)) return "T5";
  if (containsPrivilegedActionSignal(text)) {
    return "T5";
  }
  if (sideEffect === "shell") return "T4";
  if (sideEffect === "write") return "T3";
  if (sideEffect === "network") return "T2";
  if (sideEffect === "read") return "T1";
  if (sideEffect === "none") return "T0";
  if (!sideEffect) return "T5";
  return "T5";
}

export function profileRequires(profile, contractId) {
  return (profile.requiredContracts ?? []).includes(contractId);
}
