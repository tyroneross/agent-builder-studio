# Agentic-Handoff Templates

Reusable schemas for product-development agent systems — the wire format between agents, the contracts they sign, the artifacts they version, and the gates that govern them. Synthesized from Agent Builder research notes covering Perplexity and ChatGPT addenda, then reconciled into a single canonical set. See `methodology/13-agentic-product-dev-synthesis.md` for how to apply them.

## Index

| Template | Purpose |
|---|---|
| [role-card.md](role-card.md) | Per-agent contract: mission, allowed inputs/outputs, decision boundaries, tool permissions, completion signal. |
| [handoff-envelope.md](handoff-envelope.md) | Wire format when one agent passes work to another or to a human. |
| [agent-output-contract.md](agent-output-contract.md) | Structured output every agent emits when a task ends. |
| [artifact-version.md](artifact-version.md) | Version header on every artifact (requirements, UX, architecture, data, tests, code, risk). |
| [tool-contract.md](tool-contract.md) | Per-tool schema: input/output, permission tier (T0–T5), side effects, approval, audit, rollback, failure modes. Canonical merge of Perplexity + ChatGPT shapes. |
| [guardrail.md](guardrail.md) | Per-guardrail definition: trigger, check, action, severity, escalation. Includes the OWASP-aligned risk control matrix. |
| [assumption-log.md](assumption-log.md) | One entry per inference the agent system makes, with confidence, impact-if-wrong, reversibility, validation path. |
| [traceability-matrix.md](traceability-matrix.md) | Need → story → requirement → UX → entity → test → status. Owned by the QA / Evaluation agent. |
| [agent-manifest.md](agent-manifest.md) | System-level record covering mission, architecture, model routes, tools, memory, protocols, guardrails, checkpoints, deployment, deactivation. Includes per-agent registry block. |
| [evaluation-scorecard.md](evaluation-scorecard.md) | Seven-dimension 0–3 rubric the QA agent scores the handoff pack against before the coding agent builds. |
| [spec-lint-checklist.md](spec-lint-checklist.md) | Mechanical pre-flight check the Spec Review agent runs over the pack. Failure is a hard block. |
| [agent-adr.md](agent-adr.md) | ADR template for low-reversibility agent-system decisions (SDK, topology, memory, permission model). |
| [human-checkpoint.md](human-checkpoint.md) | Per-checkpoint record: agent recommendation, items reviewed, human decision, notes. Append-only. |
| [system-boundary.md](system-boundary.md) | What is inside and outside the agent system: mission, in/out-of-scope tasks, external tools and agents, human roles, data sources, systems of record, world-changing actions. |
| [flow-topology.md](flow-topology.md) | Orchestration shape: pattern (sequential/parallel/router/orchestrator-worker/evaluator-optimizer/interactive/hybrid), state owner, stop condition, retry policy, human checkpoints, parallel branches, feedback loops. |

## Conventions

- Every template carries a **Reference** line at the bottom citing the relevant research addendum.
- Templates are reusable schemas, not the artifacts they produce. The 14-file handoff folder described in `methodology/12-agentic-systems-handoff-addendum.md` is the *output* a product-development agent system generates; these templates are the building blocks it uses.
- Templates do not duplicate prose from the addenda or from `methodology/13`. When background or rationale matters, the template links to the methodology file rather than repeating it.
- When two addenda offered competing shapes for the same concept (tool contract, agent registry), the canonical merge lives here and the rationale lives in `methodology/13` under "Open contradictions and how this synthesis resolves them."
