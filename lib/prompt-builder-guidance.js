export const PROMPT_BUILDER_SOURCE_IDS = [
  "prompt-builder-caller-contract",
  "prompt-builder-deployment-modules",
  "openai-prompt-guidance",
  "openai-reasoning-best-practices",
  "anthropic-prompt-best-practices",
  "perplexity-prompt-guide",
  "mcp-prompts",
];

export function buildPromptingProfile(spec) {
  const modelTier = inferModelTier(spec);
  return {
    source: "prompt-builder",
    sourceVersion: "0.1.0",
    contractFile: "prompts/prompt-builder-contract.md",
    deployment: "agent",
    modelTier,
    outputConsumer: "llm",
    riskLevel: hasSideEffects(spec) ? "high" : "medium",
    requiredPromptParts: [
      "role",
      "task",
      "constraints",
      "context",
      "output format",
      "acceptance criteria",
    ],
    agentRequirements: [
      "state schema",
      "tool registry",
      "transition rules",
      "termination",
      "failure handling",
    ],
    pluginSkillRequirements: [
      "trigger conditions",
      "input schema",
      "action or transformation spec",
      "output schema",
      "edge cases",
      "examples",
      "validation checks",
    ],
  };
}

export function buildPromptBuilderContract(spec, { frameworkLabel }) {
  const profile = buildPromptingProfile(spec);
  const toolRows = (spec.tools ?? [])
    .map(
      (tool) =>
        `| \`${tool.name}\` | ${tool.responsibility} | request/context object | declared result for downstream node | ${tool.permission} |`,
    )
    .join("\n");
  const stateShape = buildStateShape(spec);
  const transitionRows = (spec.nodes ?? [])
    .map((node) => {
      const tools = (node.tools ?? []).length ? node.tools.map((tool) => `\`${tool}\``).join(", ") : "none";
      return `| ${node.title} | ${node.kind} | ${joinOrNone(node.inputs)} | ${tools} | ${joinOrNone(node.outputs)} | ${node.permission ?? "ask-first"} |`;
    })
    .join("\n");
  const edgeRules = (spec.edges ?? [])
    .map((edge) => `- After \`${edge.from}\`, pass \`${edge.label ?? "handoff"}\` to \`${edge.to}\`.`)
    .join("\n");

  return `# Prompt Builder Contract

Use this file before writing or changing prompts for this generated package. It adapts the local Prompt Builder repo's caller contract and deployment rules to this agent spec.

## Prompt Builder Invocation

Use this contract when another agent/tool optimizes \`system-prompt.md\`, a generated skill prompt, or plugin instructions:

\`\`\`text
Use the prompt-builder skill.

raw_prompt: system-prompt.md
model_tier: ${profile.modelTier}
deployment: agent
output_consumer: llm
risk_level: ${profile.riskLevel}
target_api_supports_structured_outputs: false
\`\`\`

If this package is adapted into a Codex/Claude skill or marketplace plugin, use \`deployment: plugin\` for embedded data transformations and \`deployment: agent\` for tool-using skills that maintain state across steps.

## Six-Part Prompt Stack

Every production prompt should make these sections explicit:

1. Role: the model's job, domain, and boundaries.
2. Task: one concrete objective plus the sub-steps needed for ${frameworkLabel(spec.framework)}.
3. Constraints: permissions, grounding, credential policy, side-effect policy, and refusal rules.
4. Context: runtime, available inputs, memory, source registry, and operator assumptions.
5. Output format: exact response shape, schema, or template.
6. Acceptance criteria: testable checks that decide whether the prompt worked.

## Agent Prompt Requirements

Prompt Builder's \`deployment=agent\` rules require state, tools, transitions, termination, and failure handling.

### State Schema

\`\`\`json
${JSON.stringify(stateShape, null, 2)}
\`\`\`

### Tool Registry

| Tool | Responsibility | Input | Output | Permission |
|---|---|---|---|---|
${toolRows || "| none | No external tools declared. | n/a | n/a | deny-by-default |"}

### Transition Rules

| Node | Kind | Inputs | Tools | Outputs | Permission |
|---|---|---|---|---|---|
${transitionRows || "| Agent | agent | user_goal | none | final_answer | ask-first |"}

${edgeRules || "- Single-node flow. Stop when required outputs are complete or a blocker is explicit."}

### Termination

Stop when all required outputs are present: ${joinOrNone(spec.outputs)}. If an input, source, permission, tool, or credential is missing, stop with a visible reason instead of guessing or silently degrading.

### Failure Handling

- Retry transient tool failures once with a modified input.
- If the same tool/input pair fails twice, record the failure in state and continue only if the remaining outputs can still be honest and useful.
- If a write, network call, shell action, external side effect, or credential use is required and not explicitly approved, stop and request approval.
- Keep API keys out of prompts, manifests, and examples. Use env vars or host secret stores only.

## Skill And Plugin Prompt Requirements

When Agent Builder emits a skill or plugin surface, its prompt should add:

- Trigger conditions: when the skill/plugin activates and when it should stay silent.
- Context loading rule: which files or docs to read first, and which references are optional.
- Input schema: required user inputs, optional inputs, defaults, and unknown-field behavior.
- Action spec: what the skill/plugin actually does, including files it may create.
- Output schema: exact response or artifact shape.
- Edge cases: missing inputs, unsupported host, unavailable connector/MCP server, stale docs, and ambiguous goals.
- Examples: at least one positive example; add edge-case examples for smaller/local models.
- Validation: tests, lint, smoke run, source freshness, and secret-safety checks.

## Provider-Specific Prompt Notes

- OpenAI: use clear, specific prompts with enough context; for reasoning models keep prompts direct, avoid unnecessary chain-of-thought requests, and use delimiters/section titles for clarity.
- Anthropic: define success criteria and evals before prompt tuning; use explicit output format, examples, roles, XML-style structure, and literal scope instructions.
- Perplexity/Sonar: ask only for information likely to be publicly searchable; require the model to say when sources are unavailable; use API search parameters and response \`search_results\` for source URLs instead of asking the model to invent URLs.
- MCP prompts: expose reusable prompt templates as user-controlled prompts, validate prompt arguments, and treat prompt inputs/outputs as injection-sensitive.

## Versioning And Regression

- Treat prompts as versioned artifacts. Do not overwrite a working prompt without a rollback path.
- Record the Prompt Builder CONFIG line, score, assumptions, risk notes, and temperature hint with any accepted prompt revision.
- Re-run evals after prompt edits, model swaps, tool-registry changes, source-registry changes, or permission-policy changes.
`;
}

function inferModelTier(spec) {
  const provider = String(spec.modelProvider ?? "").toLowerCase();
  const hasLocalProfile = Boolean(spec.modelProfiles?.primary?.model);
  if (provider.includes("ollama") || provider.includes("local") || hasLocalProfile) {
    return "T3";
  }
  if (provider.includes("openai") || provider.includes("anthropic") || provider.includes("multi")) {
    return "T2";
  }
  return "T2";
}

function hasSideEffects(spec) {
  return (spec.tools ?? []).some((tool) => !["none", "read"].includes(tool.sideEffect));
}

function joinOrNone(items) {
  return (items ?? []).length ? items.join(", ") : "none";
}

function buildStateShape(spec) {
  return {
    request: {
      inputs: spec.inputs ?? [],
      activeNode: spec.nodes?.[0]?.id ?? "agent",
      approvals: [],
    },
    progress: {
      completedNodes: [],
      pendingNodes: (spec.nodes ?? []).map((node) => node.id),
      toolFailures: [],
      sources: [],
    },
    outputs: Object.fromEntries((spec.outputs ?? []).map((output) => [output, null])),
    done: false,
  };
}
