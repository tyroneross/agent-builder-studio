// Pattern library for the agent-studio onboarding pattern picker. Pass 9.
//
// These four canonical agent shapes are adapted from agent-builder/lib/patterns.js
// (kept stand-alone — no runtime dependency on agent-builder). Each pattern is
// the source of truth for the seed graph it represents. Pattern shapes:
//
//   {
//     id: string,                 // stable id used by NewProjectForm + tests
//     name: string,               // human-readable name (used as default project name)
//     shortDescription: string,   // 1-line description shown on the picker card
//     category: string,           // text-only label ("Type I", "Type II", etc)
//     nodes: [
//       {
//         id, role, title, description,
//         x, y, w, h,
//         instructions: ""        // always empty on the seed; user fills in
//       }
//     ],
//     edges: [
//       { id, from, to }
//     ],
//     rolePromptOverrides: {}     // Pass 7 — empty by default, pattern can override
//   }
//
// Layout: nodes laid out so the seed canvas fits a 1100x700 viewport without
// overlap (canvas pan {0,0}, zoom 1). x/y/w/h are pixel coords on the canvas.
// Each node is 220x130 (matches the existing seed in projects.js v1-v8).
//
// Role mapping from agent-builder kinds to agent-studio roles:
//   agent        -> agent
//   guardrail    -> guardrail
//   orchestrator -> orchestrator
//   executor     -> executor
//   eval         -> eval
//   memory       -> memory
//   approval     -> executor   (studio doesn't have a separate approval role;
//                               approval gates run as executor with a
//                               permission instruction)
//   state        -> memory     (state stores collapse to memory in studio's
//                               six-role taxonomy)
//   verifier     -> eval       (verifiers are a kind of eval)

// Standard node footprint reused by all patterns. Matches the canvas pass-1
// seed dimensions so existing layout assumptions hold.
const NODE_W = 220;
const NODE_H = 130;

// Solo Tool Agent — the canonical 5-node seed. This is the same graph as the
// pre-pass-9 SEED_NODES/SEED_EDGES in projects.js; we move it here so the
// pattern picker and the legacy seed point at one source of truth.
const SOLO_TOOL_AGENT = {
  id: "solo-tool-agent",
  name: "Solo Tool Agent",
  shortDescription: "One agent, narrow tools, explicit approvals.",
  category: "Type I",
  rolePromptOverrides: {},
  nodes: [
    {
      id: "intake",
      role: "agent",
      title: "Intake",
      description: "Normalize the user goal and identify missing inputs before routing.",
      instructions: "",
      x: 120,
      y: 200,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "policy",
      role: "guardrail",
      title: "Policy gate",
      description: "Classify read, write, network, shell, and credential intent against permissions.",
      instructions: "",
      x: 400,
      y: 200,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "orch",
      role: "orchestrator",
      title: "Orchestrator",
      description: "Choose the next action from the active tool pool.",
      instructions: "",
      x: 680,
      y: 200,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "exec",
      role: "executor",
      title: "Executor",
      description: "Run approved reads or writes and return structured results.",
      instructions: "",
      x: 680,
      y: 380,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "evalCheck",
      role: "eval",
      title: "Eval check",
      description: "Check output, permissions, and guardrail invariants.",
      instructions: "",
      x: 960,
      y: 290,
      w: NODE_W,
      h: NODE_H,
    },
  ],
  edges: [
    { id: "intake->policy", from: "intake", to: "policy" },
    { id: "policy->orch", from: "policy", to: "orch" },
    { id: "orch->exec", from: "orch", to: "exec" },
    { id: "exec->evalCheck", from: "exec", to: "evalCheck" },
    { id: "orch->evalCheck", from: "orch", to: "evalCheck" },
  ],
};

// Approval Workflow — linear with one explicit human-approval branch.
// Intake -> Plan -> Approval gate (guardrail) -> Executor -> Notifier ->
// Audit log (memory).
const APPROVAL_WORKFLOW = {
  id: "approval-workflow",
  name: "Approval Workflow",
  shortDescription: "Deterministic steps with a human gate before any side effect.",
  category: "Type II",
  rolePromptOverrides: {},
  nodes: [
    {
      id: "intake",
      role: "agent",
      title: "Intake",
      description: "Receive the request and create a durable workflow record.",
      instructions: "",
      x: 80,
      y: 100,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "plan",
      role: "orchestrator",
      title: "Plan",
      description: "Draft the proposed action and dry-run preview.",
      instructions: "",
      x: 360,
      y: 100,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "approval",
      role: "guardrail",
      title: "Approval gate",
      description: "Pause before any side effect and capture the operator decision.",
      instructions: "",
      x: 640,
      y: 100,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "exec",
      role: "executor",
      title: "Executor",
      description: "Apply the approved change exactly once.",
      instructions: "",
      x: 920,
      y: 100,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "notifier",
      role: "agent",
      title: "Notifier",
      description: "Inform the requester and return the outcome summary.",
      instructions: "",
      x: 640,
      y: 320,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "audit",
      role: "memory",
      title: "Audit log",
      description: "Store state transitions, approvals, and the result hash.",
      instructions: "",
      x: 920,
      y: 320,
      w: NODE_W,
      h: NODE_H,
    },
  ],
  edges: [
    { id: "intake->plan", from: "intake", to: "plan" },
    { id: "plan->approval", from: "plan", to: "approval" },
    { id: "approval->exec", from: "approval", to: "exec" },
    { id: "exec->notifier", from: "exec", to: "notifier" },
    { id: "exec->audit", from: "exec", to: "audit" },
  ],
};

// Research Orchestrator — flat orchestrator-worker. Lead researcher fans out
// to three workers, joins at the verifier, then synthesizes into memory.
const RESEARCH_ORCHESTRATOR = {
  id: "research-orchestrator",
  name: "Research Orchestrator",
  shortDescription: "One orchestrator fans out to scouts, joins at a claim verifier.",
  category: "Type III",
  rolePromptOverrides: {},
  nodes: [
    {
      id: "lead",
      role: "orchestrator",
      title: "Lead researcher",
      description: "Define the scope, assign workers, and own the final synthesis.",
      instructions: "",
      x: 80,
      y: 240,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "source",
      role: "agent",
      title: "Source scout",
      description: "Find official docs, lab posts, papers, and release notes.",
      instructions: "",
      x: 360,
      y: 80,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "framework",
      role: "agent",
      title: "Framework analyst",
      description: "Compare APIs, config shapes, and integration constraints.",
      instructions: "",
      x: 360,
      y: 240,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "security",
      role: "guardrail",
      title: "Security analyst",
      description: "Assess sandboxing, credentials, tool exposure, and approval risks.",
      instructions: "",
      x: 360,
      y: 400,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "verifier",
      role: "eval",
      title: "Claim verifier",
      description: "Check claims against source tiers before synthesis.",
      instructions: "",
      x: 640,
      y: 240,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "synth",
      role: "agent",
      title: "Synthesizer",
      description: "Assemble verified claims into a reusable research packet.",
      instructions: "",
      x: 920,
      y: 160,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "memory",
      role: "memory",
      title: "Research memory",
      description: "Persist raw extracts and source quality metadata out of the prompt.",
      instructions: "",
      x: 920,
      y: 340,
      w: NODE_W,
      h: NODE_H,
    },
  ],
  edges: [
    { id: "lead->source", from: "lead", to: "source" },
    { id: "lead->framework", from: "lead", to: "framework" },
    { id: "lead->security", from: "lead", to: "security" },
    { id: "source->verifier", from: "source", to: "verifier" },
    { id: "framework->verifier", from: "framework", to: "verifier" },
    { id: "security->verifier", from: "security", to: "verifier" },
    { id: "verifier->synth", from: "verifier", to: "synth" },
    { id: "synth->memory", from: "synth", to: "memory" },
  ],
};

// Evaluator Optimizer — bounded generator-critic loop with a stop condition.
// Drafter -> Rubric critic (eval) -> (loop back) Reviser (executor) ->
// Style verifier (eval) -> Memory.
const EVALUATOR_OPTIMIZER = {
  id: "evaluator-optimizer",
  name: "Evaluator Optimizer",
  shortDescription: "Generate, critique, revise — bounded loop until pass or stop.",
  category: "Type II",
  rolePromptOverrides: {},
  nodes: [
    {
      id: "drafter",
      role: "agent",
      title: "Drafter",
      description: "Produce the first candidate output from the brief and rubric.",
      instructions: "",
      x: 80,
      y: 220,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "critic",
      role: "eval",
      title: "Rubric critic",
      description: "Judge the candidate against the rubric, return pass/fail and defects.",
      instructions: "",
      x: 360,
      y: 100,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "reviser",
      role: "executor",
      title: "Reviser",
      description: "Revise only the failed dimensions and emit the next candidate.",
      instructions: "",
      x: 360,
      y: 360,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "verifier",
      role: "eval",
      title: "Style verifier",
      description: "Confirm tone, length, and formatting match acceptance.",
      instructions: "",
      x: 640,
      y: 220,
      w: NODE_W,
      h: NODE_H,
    },
    {
      id: "memory",
      role: "memory",
      title: "Accepted memory",
      description: "Store the accepted output, scorecard, and iteration trace.",
      instructions: "",
      x: 920,
      y: 220,
      w: NODE_W,
      h: NODE_H,
    },
  ],
  edges: [
    { id: "drafter->critic", from: "drafter", to: "critic" },
    { id: "critic->reviser", from: "critic", to: "reviser" },
    { id: "reviser->verifier", from: "reviser", to: "verifier" },
    { id: "critic->verifier", from: "critic", to: "verifier" },
    { id: "verifier->memory", from: "verifier", to: "memory" },
  ],
};

// Ordered list — the order is the order shown in the picker grid.
export const PATTERNS = [
  SOLO_TOOL_AGENT,
  APPROVAL_WORKFLOW,
  RESEARCH_ORCHESTRATOR,
  EVALUATOR_OPTIMIZER,
];

export const SOLO_TOOL_AGENT_PATTERN_ID = SOLO_TOOL_AGENT.id;

export function findPatternById(id) {
  return PATTERNS.find((p) => p.id === id) || null;
}

// Build a fresh canvas object from a pattern. Deep-clones nodes and edges so
// per-project mutations don't bleed across projects.
export function canvasFromPattern(pattern) {
  if (!pattern) return null;
  return {
    nodes: pattern.nodes.map((n) => ({ ...n })),
    edges: pattern.edges.map((e) => ({ ...e })),
    pan: { x: 0, y: 0 },
    zoom: 1,
  };
}
