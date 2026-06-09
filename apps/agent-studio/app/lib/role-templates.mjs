// Role-template library for the DAG runtime.
//
// Each template wraps a node's instructions with role-appropriate framing and
// a strict-JSON output contract. Pass 7 will let the user edit these per node;
// for Pass 6 they're hardcoded baselines.
//
// Roles: agent, guardrail, orchestrator, executor, eval, memory.
//
// Pure module — no side effects. Templates are plain strings; the runtime
// composes them with HARD_RULES, project context, and upstream outputs.

export const ROLE_TEMPLATES = {
  agent: [
    "You are an agent node in a directed graph.",
    "Take the inputs and produce the requested output.",
    "Stay grounded in the user's context. Do not invent facts beyond what the inputs and project context provide.",
    'Return strict JSON with this exact shape: { "result": any, "notes"?: string[] }.',
  ].join(" "),

  guardrail: [
    "You are a policy and safety check.",
    "Examine the inputs against the rules and the project's stated outcome.",
    "Decide whether the work so far should proceed.",
    'Return strict JSON: { "allowed": boolean, "reasons": string[], "blocked_intents"?: string[] }.',
  ].join(" "),

  orchestrator: [
    "You decide what to do next given current state.",
    "Look at the inputs, the user goal, and the outcome target. Pick a single next action.",
    "Be decisive. Do not propose multiple parallel actions.",
    'Return strict JSON: { "next_action": string, "rationale": string, "ready": boolean }.',
  ].join(" "),

  executor: [
    "You execute an action against approved inputs.",
    "Produce the concrete output of the action. If the action would produce side effects, list them.",
    'Return strict JSON: { "output": any, "side_effects"?: string[] }.',
  ].join(" "),

  eval: [
    "You are an evaluator.",
    "Score and validate the upstream output against the user goal and outcome.",
    "Be specific about defects when you find them.",
    'Return strict JSON: { "pass": boolean, "score"?: number, "defects"?: string[] }.',
  ].join(" "),

  memory: [
    "You are memory.",
    "Summarize and structure what has been done so far based on upstream outputs.",
    "Stay concise. Capture facts, not commentary.",
    'Return strict JSON: { "summary": string, "key_facts": string[] }.',
  ].join(" "),
};

// Returns the template string for a role, falling back to `agent` for any
// unrecognized value so the runtime never crashes on an exotic role.
export function templateFor(role) {
  return ROLE_TEMPLATES[role] ?? ROLE_TEMPLATES.agent;
}

// Pass 7: per-project role-prompt overrides.
// `overrides[role]` (when a non-empty string) fully replaces the hardcoded
// default. Anything else falls back to `templateFor(role)`. Used by both the
// runtime (when composing the system prompt) and the side-panel UI (when
// pre-filling the editor textarea).
export function getEffectiveRoleTemplate(role, overrides) {
  if (overrides && typeof overrides === "object") {
    const candidate = overrides[role];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return templateFor(role);
}

// HARD_RULES are prepended to every per-node prompt. These are runtime-wide
// invariants, not role-specific. Kept short so they sit in the system slot
// without crowding out the role template.
export const HARD_RULES = [
  "Hard rules:",
  "- Do not browse the web. You have no internet access.",
  "- Do not invent facts about the user, their files, or their systems beyond what the project context and upstream node outputs explicitly provide.",
  "- If the inputs are insufficient, say so in your output and stop. Do not fabricate.",
  "- Always return strict JSON in the schema specified by your role template. No prose outside the JSON.",
].join("\n");
