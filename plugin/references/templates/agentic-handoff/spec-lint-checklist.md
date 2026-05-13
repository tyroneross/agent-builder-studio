# Spec Lint Checklist Template

> Use as the deterministic pre-flight check the Spec Review Agent runs over the handoff pack before any human review. Spec lint is mechanical — every item is a boolean the agent can verify by reading artifacts. Spec lint failure is a hard block; do not let an agent system advance to coding while any P0 lint item is `false` (or `true` for an item phrased negatively).

```yaml
spec_lint:
  required_ids_present: true
  p0_stories_have_acceptance_criteria: true
  p0_requirements_have_tests: true
  assumptions_have_confidence_and_validation: true
  open_questions_marked_blocking_or_nonblocking: true
  sensitive_data_classified: true
  architecture_decisions_have_rationale: true
  non_goals_defined: true
  agent_decision_boundaries_defined: true
  unresolved_low_reversibility_decisions: false
```

## Conventions

- Every item must be a boolean the Spec Review Agent can verify deterministically. If an item requires judgment, move it to the [evaluation scorecard](evaluation-scorecard.md) instead.
- A failing item is not a finding — it is a block. Surface it, route the artifact back to the owning agent, and re-run lint on the next version.
- Negative-phrased items (e.g., `unresolved_low_reversibility_decisions`) pass when `false`. Keep the polarity consistent with the field name to make the YAML readable at a glance.
- Add project-specific lint items as separate fields. Do not modify or remove the core items — they are the baseline.

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` (ChatGPT addendum, "Spec lint checklist").
