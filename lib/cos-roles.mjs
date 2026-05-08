// Per-role configuration for the Chief of Staff team.
//
// Each node maps to one role (or null, for plumbing nodes like `intake`).
// A role is a tuple of:
//   - name             human-readable role name
//   - mission          one-sentence mission stamped onto the system prompt
//   - guardrails       2-3 bullets the role must obey
//   - tierOverride     "parse" | "mid" | "synthesis" | null (null = use node tier)
//
// Why roles, not nodes:
//   - Nodes are pipeline plumbing.
//   - Roles are how the team thinks about itself.
//   - A role gets ONLY the guidance relevant to its job. Today every node
//     receives the full team brief; that's wasted tokens and noise. The brief
//     in the runner is unchanged (kept for outer context); roles add a
//     scoped overlay.
//
// Tier override precedence:
//   role.tierOverride > node.tier (which sets node.localPrimary etc.)
// The runner translates a tier override into a model swap by routing the node
// through the routing table for a different node-of-the-same-tier when a
// direct override is requested. To keep this simple, we expose a tier-keyed
// model lookup in cos-config and the runner picks the model for that tier.

export const ROLES = Object.freeze({
  priority_strategist: {
    name: "Priority Strategist",
    mission:
      "Pick the THREE weekly outcomes with the highest leverage on the user's stated goal; reject low-yield commitments by name.",
    guardrails: [
      "Never invent goals not present in the input or in the user goal.",
      "Reject committees, status meetings, and broadcast updates by default unless they tie to a top-three outcome.",
      "Use the user's exact language for the outcome name; do not paraphrase strategic terms.",
    ],
    tierOverride: null, // honor the node's default tier
  },
  calendar_architect: {
    name: "Calendar Architect",
    mission:
      "Arrange 5–9 named time blocks for the week that protect peak-energy windows for high-leverage work and batch admin into low-energy windows.",
    guardrails: [
      "Honor every fixed event in the input. If a tradeoff overrides one, surface it explicitly with `(requires approval)`.",
      "Each block must have a `mode` (deep / shallow / admin / coordination / recovery) and a `why`.",
      "Do not produce a block that overlaps a fixed event without explicit tradeoff justification.",
    ],
    tierOverride: null,
  },
  follow_up_operator: {
    name: "Follow-up Operator",
    mission:
      "Draft owner-specific follow-ups for the week. Surface every item that lacks an owner so the user can assign one before the day begins.",
    guardrails: [
      "Use 'MISSING' as the owner only when no owner is implied by the input. Surface those in `missingOwners`.",
      "Each item must have an action verb (Send / Confirm / Cancel / Reschedule / Decide / Ask).",
      "Do not invent recipients or channels.",
    ],
    tierOverride: null,
  },
  energy_analyst: {
    name: "Energy Analyst",
    mission:
      "Treat decisions as energy and leverage calls. Each decision-log entry must include the options, a recommendation, the energy/leverage rationale, and the current status.",
    guardrails: [
      "Recommendation must include the leverage rationale in 1 sentence.",
      "Status must be one of: pending / blocked / decided.",
      "Do not list a decision without at least 2 distinct options.",
    ],
    tierOverride: null,
  },
  honesty_auditor: {
    name: "Honesty Auditor",
    mission:
      "Flag missing owners, blocked decisions, overloaded calendars, and any productivity claim not tied to an observable metric.",
    guardrails: [
      "Every risk must carry severity (low/medium/high) and at least a stub mitigation.",
      "Surface any unverified productivity claim (e.g. '100x more productive') in `unverifiedClaims`.",
      "Do not soften severity to be polite; the user wants the audit to be honest.",
    ],
    // Honesty Auditor MUST run at synthesis tier even if the node it's
    // attached to is parse/mid. Drift on this one matters.
    tierOverride: "synthesis",
  },
});

// Map node key → role key. Nodes with no strategic role return null.
export const NODE_ROLE = Object.freeze({
  intake: null, // plumbing
  triage: "priority_strategist",
  time_block_plan: "calendar_architect",
  follow_up_plan: "follow_up_operator",
  decision_log: "energy_analyst",
  operating_risks: "honesty_auditor",
});

/**
 * Build the role-scoped brief that gets injected into the system prompt for
 * a node. Returns "" when the node has no role mapping (e.g. intake) — the
 * runner falls back to the node's existing instructions in that case.
 */
export function roleBriefFor(nodeKey) {
  const roleKey = NODE_ROLE[nodeKey];
  if (!roleKey) return "";
  const r = ROLES[roleKey];
  if (!r) return "";
  return [
    `Role: ${r.name}.`,
    `Mission: ${r.mission}`,
    `Guardrails:`,
    ...r.guardrails.map((g) => `- ${g}`),
  ].join("\n");
}

/**
 * Resolve the effective tier for a node. Role tier override wins.
 * Returns the role's overridden tier or null (caller uses the node's tier).
 */
export function effectiveTierOverride(nodeKey) {
  const roleKey = NODE_ROLE[nodeKey];
  if (!roleKey) return null;
  return ROLES[roleKey]?.tierOverride ?? null;
}

export function roleNameFor(nodeKey) {
  const roleKey = NODE_ROLE[nodeKey];
  return roleKey ? ROLES[roleKey].name : null;
}
