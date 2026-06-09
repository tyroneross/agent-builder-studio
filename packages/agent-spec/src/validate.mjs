// Extracted from agent-builder/lib/generator.js#validateSpec and reconciled with
// agent-studio/app/lib/spec-export.mjs's byte-identical hand-copy. Single source
// of truth for the agent-builder-platform monorepo. Behavior is preserved exactly so the
// studio round-trip harness passes unchanged; role validation is ADDITIVE and
// non-breaking (it never adds an error, only normalizes via canonicalRole on read).

import { isKnownRole } from "./roles.mjs";

/**
 * Validate an agent spec. Returns an array of error strings (empty = valid).
 * Contract preserved verbatim from both prior implementations:
 *   - projectName required
 *   - at least one node
 *   - every node needs id + title
 *   - every edge's from/to must reference an existing node id
 * Role/kind values are NOT a hard error (unknown roles canonicalize to "agent"
 * at read time), matching the studio's prior permissive behavior.
 */
export function validateSpec(spec) {
  const errors = [];
  if (!spec.projectName?.trim()) errors.push("Project name is required.");
  if (!Array.isArray(spec.nodes) || spec.nodes.length === 0) {
    errors.push("At least one node is required.");
  }

  const nodeIds = new Set((spec.nodes ?? []).map((node) => node.id));
  for (const node of spec.nodes ?? []) {
    if (!node.id) errors.push("Every node needs an id.");
    if (!node.title) errors.push(`Node ${node.id || "(missing id)"} needs a title.`);
  }

  for (const edge of spec.edges ?? []) {
    if (!nodeIds.has(edge.from)) errors.push(`Edge source ${edge.from} does not exist.`);
    if (!nodeIds.has(edge.to)) errors.push(`Edge target ${edge.to} does not exist.`);
  }

  return errors;
}

/**
 * Advisory role lint (non-gating). Returns nodes whose role/kind value is not a
 * known canonical role or alias. Callers may surface these as warnings; they are
 * NOT part of validateSpec's hard contract.
 */
export function lintRoles(spec) {
  const unknown = [];
  for (const node of spec.nodes ?? []) {
    const raw = node.role ?? node.kind;
    if (raw != null && !isKnownRole(raw)) {
      unknown.push({ id: node.id, value: raw });
    }
  }
  return unknown;
}
