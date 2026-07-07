// Canonical canvas seed patterns — the starting graphs a host (Studio) drops on
// the canvas for each agent shape. These live in agent-pack so there is ONE
// canonical source: the governance definitions in patterns.js (PATTERNS) and
// these canvas seeds are bound together by test/pattern-consistency.test.mjs
// (same id set; every role is a canonical agent-spec role). Studio re-exports
// these rather than carrying its own copy.
//
// Each node.role is a canonical agent-spec role. Governance PATTERNS describe the
// same shapes with permission/tier/tool detail using the canonical `kind`
// vocabulary (which includes approval/verifier/state); a canvas seed may collapse
// some of those to the closest authored role (e.g. an approval gate authored as a
// guardrail node) — the binding test enforces id + role-vocabulary alignment, not
// a field-by-field projection, so each layer keeps the detail it needs.
//
// Layout: x/y/w/h are pixel coords; each node is 220x130 (matches the canvas seed
// dimensions). instructions are empty on the seed; the user fills them in.

const NODE_W = 220;
const NODE_H = 130;

// Solo Tool Agent — Type I, 5-node seed.
const SOLO_TOOL_AGENT = {
  id: "solo-tool-agent",
  name: "Solo Tool Agent",
  shortDescription: "One agent, narrow tools, explicit approvals.",
  category: "Type I",
  rolePromptOverrides: {},
  nodes: [
    { id: "intake", role: "agent", title: "Intake", description: "Normalize the user goal and identify missing inputs before routing.", instructions: "", x: 120, y: 200, w: NODE_W, h: NODE_H },
    { id: "policy", role: "guardrail", title: "Policy gate", description: "Classify read, write, network, shell, and credential intent against permissions.", instructions: "", x: 400, y: 200, w: NODE_W, h: NODE_H },
    { id: "orch", role: "orchestrator", title: "Orchestrator", description: "Choose the next action from the active tool pool.", instructions: "", x: 680, y: 200, w: NODE_W, h: NODE_H },
    { id: "exec", role: "executor", title: "Executor", description: "Run approved reads or writes and return structured results.", instructions: "", x: 680, y: 380, w: NODE_W, h: NODE_H },
    { id: "evalCheck", role: "eval", title: "Eval check", description: "Check output, permissions, and guardrail invariants.", instructions: "", x: 960, y: 290, w: NODE_W, h: NODE_H },
  ],
  edges: [
    { id: "intake->policy", from: "intake", to: "policy" },
    { id: "policy->orch", from: "policy", to: "orch" },
    { id: "orch->exec", from: "orch", to: "exec" },
    { id: "exec->evalCheck", from: "exec", to: "evalCheck" },
    { id: "orch->evalCheck", from: "orch", to: "evalCheck" },
  ],
};

// Approval Workflow — Type II, linear with one explicit human-approval branch.
const APPROVAL_WORKFLOW = {
  id: "approval-workflow",
  name: "Approval Workflow",
  shortDescription: "Deterministic steps with a human gate before any side effect.",
  category: "Type II",
  rolePromptOverrides: {},
  nodes: [
    { id: "intake", role: "agent", title: "Intake", description: "Receive the request and create a durable workflow record.", instructions: "", x: 80, y: 100, w: NODE_W, h: NODE_H },
    { id: "plan", role: "orchestrator", title: "Plan", description: "Draft the proposed action and dry-run preview.", instructions: "", x: 360, y: 100, w: NODE_W, h: NODE_H },
    { id: "approval", role: "guardrail", title: "Approval gate", description: "Pause before any side effect and capture the operator decision.", instructions: "", x: 640, y: 100, w: NODE_W, h: NODE_H },
    { id: "exec", role: "executor", title: "Executor", description: "Apply the approved change exactly once.", instructions: "", x: 920, y: 100, w: NODE_W, h: NODE_H },
    { id: "notifier", role: "agent", title: "Notifier", description: "Inform the requester and return the outcome summary.", instructions: "", x: 640, y: 320, w: NODE_W, h: NODE_H },
    { id: "audit", role: "memory", title: "Audit log", description: "Store state transitions, approvals, and the result hash.", instructions: "", x: 920, y: 320, w: NODE_W, h: NODE_H },
  ],
  edges: [
    { id: "intake->plan", from: "intake", to: "plan" },
    { id: "plan->approval", from: "plan", to: "approval" },
    { id: "approval->exec", from: "approval", to: "exec" },
    { id: "exec->notifier", from: "exec", to: "notifier" },
    { id: "exec->audit", from: "exec", to: "audit" },
  ],
};

// Research Orchestrator — Type III, flat orchestrator-worker fan-out/join.
const RESEARCH_ORCHESTRATOR = {
  id: "research-orchestrator",
  name: "Research Orchestrator",
  shortDescription: "One orchestrator fans out to scouts, joins at a claim verifier.",
  category: "Type III",
  rolePromptOverrides: {},
  nodes: [
    { id: "lead", role: "orchestrator", title: "Lead researcher", description: "Define the scope, assign workers, and own the final synthesis.", instructions: "", x: 80, y: 240, w: NODE_W, h: NODE_H },
    { id: "source", role: "agent", title: "Source scout", description: "Find official docs, lab posts, papers, and release notes.", instructions: "", x: 360, y: 80, w: NODE_W, h: NODE_H },
    { id: "framework", role: "agent", title: "Framework analyst", description: "Compare APIs, config shapes, and integration constraints.", instructions: "", x: 360, y: 240, w: NODE_W, h: NODE_H },
    { id: "security", role: "guardrail", title: "Security analyst", description: "Assess sandboxing, credentials, tool exposure, and approval risks.", instructions: "", x: 360, y: 400, w: NODE_W, h: NODE_H },
    { id: "verifier", role: "eval", title: "Claim verifier", description: "Check claims against source tiers before synthesis.", instructions: "", x: 640, y: 240, w: NODE_W, h: NODE_H },
    { id: "synth", role: "agent", title: "Synthesizer", description: "Assemble verified claims into a reusable research packet.", instructions: "", x: 920, y: 160, w: NODE_W, h: NODE_H },
    { id: "memory", role: "memory", title: "Research memory", description: "Persist raw extracts and source quality metadata out of the prompt.", instructions: "", x: 920, y: 340, w: NODE_W, h: NODE_H },
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

// Earnings Call Research — Type III, primary-source research with a hard fact gate.
const EARNINGS_CALL_RESEARCH = {
  id: "earnings-call-research",
  name: "Earnings Call Research",
  shortDescription: "Source-backed earnings-call claims with a fact gate.",
  category: "Type III",
  rolePromptOverrides: {},
  nodes: [
    { id: "scope", role: "orchestrator", title: "Research scope", description: "Normalize company, ticker, fiscal period, question, and source policy into an auditable research plan.", instructions: "", x: 80, y: 240, w: NODE_W, h: NODE_H },
    { id: "source-plan", role: "agent", title: "Source planner", description: "Resolve issuer, period, required materials, and primary-source precedence before retrieval.", instructions: "", x: 360, y: 80, w: NODE_W, h: NODE_H },
    { id: "retrieval", role: "executor", title: "Source retrieval", description: "Retrieve or request approved earnings releases, filings, presentations, webcast records, and transcripts.", instructions: "", x: 360, y: 240, w: NODE_W, h: NODE_H },
    { id: "ingest", role: "agent", title: "Document ingest", description: "Parse source documents into source-linked chunks with speaker, section, page, timestamp, or accession locators.", instructions: "", x: 640, y: 80, w: NODE_W, h: NODE_H },
    { id: "claim-extractor", role: "agent", title: "Claim extractor", description: "Extract metric, value, period, speaker, quote, source ID, and confidence rows.", instructions: "", x: 640, y: 240, w: NODE_W, h: NODE_H },
    { id: "fact-gate", role: "eval", title: "Fact gate", description: "Cross-check material claim rows, classify support status, and block unsupported claims from synthesis.", instructions: "", x: 920, y: 160, w: NODE_W, h: NODE_H },
    { id: "synthesis", role: "agent", title: "Cited synthesis", description: "Write the research brief from verified claims only with citations and an unverified-claims appendix.", instructions: "", x: 1200, y: 80, w: NODE_W, h: NODE_H },
    { id: "research-memory", role: "memory", title: "Research memory", description: "Persist approved source aliases, rejected claims, and eval-gated lessons without treating unsupported facts as truth.", instructions: "", x: 1200, y: 260, w: NODE_W, h: NODE_H },
  ],
  edges: [
    { id: "scope->source-plan", from: "scope", to: "source-plan" },
    { id: "source-plan->retrieval", from: "source-plan", to: "retrieval" },
    { id: "retrieval->ingest", from: "retrieval", to: "ingest" },
    { id: "ingest->claim-extractor", from: "ingest", to: "claim-extractor" },
    { id: "claim-extractor->fact-gate", from: "claim-extractor", to: "fact-gate" },
    { id: "fact-gate->synthesis", from: "fact-gate", to: "synthesis" },
    { id: "synthesis->research-memory", from: "synthesis", to: "research-memory" },
    { id: "fact-gate->research-memory", from: "fact-gate", to: "research-memory" },
  ],
};

// Evaluator Optimizer — Type II, bounded generator-critic loop with stop.
const EVALUATOR_OPTIMIZER = {
  id: "evaluator-optimizer",
  name: "Evaluator Optimizer",
  shortDescription: "Generate, critique, revise — bounded loop until pass or stop.",
  category: "Type II",
  rolePromptOverrides: {},
  nodes: [
    { id: "drafter", role: "agent", title: "Drafter", description: "Produce the first candidate output from the brief and rubric.", instructions: "", x: 80, y: 220, w: NODE_W, h: NODE_H },
    { id: "critic", role: "eval", title: "Rubric critic", description: "Judge the candidate against the rubric, return pass/fail and defects.", instructions: "", x: 360, y: 100, w: NODE_W, h: NODE_H },
    { id: "reviser", role: "executor", title: "Reviser", description: "Revise only the failed dimensions and emit the next candidate.", instructions: "", x: 360, y: 360, w: NODE_W, h: NODE_H },
    { id: "verifier", role: "eval", title: "Style verifier", description: "Confirm tone, length, and formatting match acceptance.", instructions: "", x: 640, y: 220, w: NODE_W, h: NODE_H },
    { id: "memory", role: "memory", title: "Accepted memory", description: "Store the accepted output, scorecard, and iteration trace.", instructions: "", x: 920, y: 220, w: NODE_W, h: NODE_H },
  ],
  edges: [
    { id: "drafter->critic", from: "drafter", to: "critic" },
    { id: "critic->reviser", from: "critic", to: "reviser" },
    { id: "reviser->verifier", from: "reviser", to: "verifier" },
    { id: "critic->verifier", from: "critic", to: "verifier" },
    { id: "verifier->memory", from: "verifier", to: "memory" },
  ],
};

// Ordered list — the order shown in a picker grid.
export const CANVAS_PATTERNS = [
  SOLO_TOOL_AGENT,
  APPROVAL_WORKFLOW,
  RESEARCH_ORCHESTRATOR,
  EARNINGS_CALL_RESEARCH,
  EVALUATOR_OPTIMIZER,
];

export const SOLO_TOOL_AGENT_PATTERN_ID = SOLO_TOOL_AGENT.id;

export function findCanvasPattern(id) {
  return CANVAS_PATTERNS.find((p) => p.id === id) || null;
}

// Build a fresh canvas object from a pattern. Deep-clones nodes and edges so
// per-project mutations don't bleed across patterns.
export function canvasFromPattern(pattern) {
  if (!pattern) return null;
  return {
    nodes: pattern.nodes.map((n) => ({ ...n })),
    edges: pattern.edges.map((e) => ({ ...e })),
    pan: { x: 0, y: 0 },
    zoom: 1,
  };
}
