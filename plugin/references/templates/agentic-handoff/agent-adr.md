# Agent ADR Template

> Use one ADR per low-reversibility agent-system decision: SDK choice, orchestration topology, memory design, tool permission model, model routing strategy, autonomy level, deployment target. ADRs name what was decided, what alternatives were considered, why this option fits the decision criteria, and how reversible the decision is. Pair every ADR with an entry in the [agent manifest](agent-manifest.md) so deployed behavior matches recorded intent.

```markdown
# ADR-AGENT-001: <Decision title>

## Status
proposed | approved | superseded

## Context
<Why the decision matters.>

## Options considered
1. <option>
2. <option>
3. <option>

## Decision
<Selected option.>

## Rationale
<Why this option best fits decision criteria.>

## Risks
- <risk>

## Reversibility
high | medium | low

## Approval
- Required: yes | no
- Approver: <role>
```

## Conventions

- Number ADRs sequentially per agent system, prefixed with `ADR-AGENT-`. Keep them in `adr/` next to the manifest.
- Mark superseded ADRs explicitly — link the new ADR from the old one and back. Never delete an ADR.
- The Architecture Agent owns ADR drafting; the Spec Review Agent or human owner approves.
- Decisions with `Reversibility: low` are the ones worth investing AHP, weighted scoring, or morphological analysis on. Decisions with `Reversibility: high` should be made fast.

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` (ChatGPT addendum, "Architecture Decision Record for agent systems").
