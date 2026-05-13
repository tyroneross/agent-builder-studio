# Agentic Product Development — Synthesis

> **What this file is for.** Two research addenda (Perplexity, ChatGPT) extend Agent Builder's catalog and template set with material specific to *product-development agent systems* -- agent networks that take sparse human input and produce a buildable spec for a coding agent. This file synthesizes the two into one Agent Builder-owned reference and points at the canonical templates, prompt contracts, catalog files, and companion synthesis file. It does not duplicate the addenda; full template bodies live in `references/templates/agentic-handoff/` and the source addenda are preserved at `~/dev/research/topics/product-dev/`.
>
> **Companion files.**
> - `12-agentic-systems-handoff-addendum.md` (Perplexity-derived) — operating-model and 14-file handoff folder.
> - `~/dev/research/topics/product-dev/product-dev.agentic-systems-template-pack-addendum-v2.md` — **canonical Perplexity addendum (v2)**, with cross-source merge against the ChatGPT addendum, A0–A4 autonomy ladder, and the new `system_boundary` / `flow_topology` schemas.
> - `~/dev/research/topics/product-dev/product-dev.agentic-systems-template-pack-addendum.md` — Perplexity v1 (retained for traceability; superseded by v2).
> - `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` — full ChatGPT addendum.
> - `references/templates/agentic-handoff/` — 15 reusable schemas extracted from the addenda.

## Table of contents

- Why product-development agent systems need their own methodology
- The workflow-first principle
- Default architecture: triage + specialists + reviewers
- The role-card pattern
- Autonomy ladder (canonical: A0–A4)
- Ask-before policy
- Confidence scoring
- Evaluation gates specific to agent systems
- How this maps onto Agent Builder surfaces
- Implementation roadmap
- Operational metrics and review thresholds
- Open contradictions and how this synthesis resolves them

## Why product-development agent systems need their own methodology

Agent Builder's catalog, templates, prompt contracts, and generated artifacts cover **the harness layer for any agent**: tools, permissions, state, memory, evals, observability, multi-agent shape, framework selection, and output contracts. Those surfaces are product-shape agnostic.

Product-development agent systems are a specific shape worth calling out: an agent network whose job is to convert sparse human input into a buildable specification for a coding agent. ProductPilot is the working name. The 14-file handoff folder in file 12 is the *output* of that system — not the system itself.

Three things make product-development agent systems different:

1. **The work product is itself a multi-agent contract.** The output is not an answer or an action — it is a folder of versioned artifacts (brief, requirements, UX, architecture, data, tests, ADRs) consumed by a downstream coding agent. Every artifact is traceable back to a user need.
2. **Autonomy is bounded by reversibility, not by capability.** The agent can write Python; that does not mean it should pick the database. Autonomy maps to reversibility-of-impact, not to skill.
3. **Specialist review is the unit of safety.** A single generalist agent silently picking architecture, security posture, data model, and UX is the failure mode this methodology is designed to prevent.

## The workflow-first principle

> Anthropic distinguishes workflows (predefined code paths) from agents (dynamically directed). Start with the simplest workable pattern; add autonomy only when complexity is forced by the work.

For product development, this means: **deterministic workflow gates for intake, spec creation, review, build, and evaluation; agent autonomy only inside bounded sub-tasks** (drafting a section, summarizing intake, generating tests for an approved requirement).

This sits on top of the catalog's single-agent default and framework-selection posture. Agent Builder should prefer one agent with tools until the product-development job needs specialist context, independent review, or separate decision boundaries. Once a single agent is insufficient, the next default is **workflow-governed multi-agent -- not free-form orchestrator-worker**. Workflow gates carry the safety load; agents do the drafting.

## Default architecture: triage + specialists + reviewers

When a product-development job exceeds a single-agent budget, the recommended default is:

```text
Human input
  -> Intake / Triage Agent
  -> Product Spec Agent
  -> User Research / JTBD Agent
  -> Requirements Agent
  -> UX Blueprint Agent
  -> Architecture Agent
  -> Data / Integration Agent
  -> Security / Compliance Agent
  -> Spec Review Agent              <- traceability + lint gates
  -> [Human checkpoint: pre-build]
  -> Coding Agent
  -> QA / Evaluation Agent
  -> Release / Completion Agent
```

The orchestrator owns routing, state, and completion criteria. **Specialist agents own artifact generation. Review agents independently check work before the coding agent builds.** No single agent is allowed to silently make all product, UX, architecture, security decisions in one pass.

This is workflow-governed multi-agent. It is heavier than "one agent with tools" and it is also far cheaper than free-form multi-agent orchestration. Cost note from `catalog/01`: single agent ≈ 4× chat tokens, multi-agent ≈ 15× chat tokens. Workflow-governed multi-agent runs at roughly the same cost as multi-agent because every specialist still does an LLM call — but the safety case is dramatically stronger because every specialist is bounded and reviewed.

### Why this beats free-form multi-agent

- Each specialist has a small, well-typed input and output. Prompts stay small. Hallucination surface stays small.
- Review agents run before the coding agent gets the pack — defects are cheap to fix at the spec stage and expensive at the build stage.
- Traceability is enforced by the workflow, not by goodwill.
- Human checkpoints are at deterministic phase boundaries, not inside agent loops.

### Why this beats one giant agent

- One generalist agent collapses product, UX, architecture, data, and security decisions into a single hallucination-prone pass.
- Every decision shares the same context window — context bloat is structural, not incidental.
- There is no independent reviewer. The agent cannot find its own blind spots.
- Failure modes are systemic — when it goes wrong, it goes wrong everywhere.

## The role-card pattern

Every agent in the network gets a [role card](../templates/agentic-handoff/role-card.md): mission, allowed inputs and outputs, decisions it may make on its own, decisions it must escalate, tool permissions, quality bar, completion signal. Pair every role card with at least one [handoff envelope](../templates/agentic-handoff/handoff-envelope.md) and one [agent output contract](../templates/agentic-handoff/agent-output-contract.md).

Role cards make the agent's contract explicit. They are how this methodology answers the question "what is this agent allowed to decide on its own?" — without that, autonomy is whatever the prompt happens to permit on a given day.

Role cards live next to (not inside) the agent's system prompt. A change to a role card is a governance event; a change to a system prompt is a tuning event. Keep them separate.

## Autonomy ladder (canonical: A0–A4)

This synthesis adopts the **A0–A4 ladder** as canonical, matching Perplexity v2 and the ChatGPT addendum. Perplexity v1 used a 6-level A0–A5 ladder; v2 collapsed it to 5 levels framed by execution scope. With both current addenda agreeing on the 5-level form, the canonical decision flips to A0–A4 and the older 6-level form is retained below as a more granular variant.

### Canonical ladder (A0–A4)

| Level | Name | Agent may do | Approval required for |
|---|---|---|---|
| A0 | Draft only | Summarize, classify, draft, critique, recommend. | Any decision, write action, external call, or implementation. |
| A1 | Reversible decisions | Choose low-risk defaults, mark assumptions, proceed on reversible choices. | Low-reversibility decisions, sensitive data, external services, paid resources. |
| A2 | Bounded execution | Implement approved P0 scope in a sandbox, run tests, update local files, report. | Deployment, paid services, destructive actions, secrets, external communications. |
| A3 | Controlled production action | Execute approved production tasks under guardrails and audit. | Migrations, deletion, permission changes, user-impacting changes, policy changes. |
| A4 | Autonomous operation | Monitor and optimize within explicit policy, budgets, and rollback limits. | Material scope, policy, data, architecture, or cost changes. |

The A0–A4 form is framed by execution scope (draft → reversible decision → sandboxed execution → controlled production action → autonomous operation). Verbatim level names match Perplexity v2 § "Agent autonomy model — A0–A4".

### Perplexity v1 variant: A0–A5 (more granular)

Perplexity v1 split "draft only" into three levels (A0 answer-only, A1 suggest, A2 draft) and "execute" into two (A3 reversible, A4 with-approval), then added A5 for high-autonomy operation. The mapping to the canonical A0–A4 form:

| v1 level (A0–A5) | v1 description | Canonical (A0–A4) |
|---|---|---|
| A0 | Answer only — explain, summarize | A0 (Draft only) |
| A1 | Suggest — recommend actions | A0 (Draft only) |
| A2 | Draft — draft email, draft PR comment | A0 (Draft only) |
| A3 | Execute reversible — create draft record, run read query | A1 (Reversible decisions) or A2 (Bounded execution) — depends on whether the action is a decision or sandboxed execution |
| A4 | Execute with approval — merge or send after approval | A3 (Controlled production action) |
| A5 | High autonomy — routine ops within strict policy | A4 (Autonomous operation) |

Why the canonical flip: the A0–A4 form has cross-source agreement (Perplexity v2 + ChatGPT). The v1 distinctions between "suggest" and "draft," and between "execute reversible" and "execute with approval," are useful at review time but are recoverable inside an A0–A4 role card by adding a sub-level note (`autonomy_level: "A0 (suggest only)"`). Projects that already standardized on A0–A5 can keep using it — the mapping above is bidirectional.

### Default autonomy by phase

| Phase | Default autonomy | Reason |
|---|---:|---|
| Sparse intake | A1 | Agent can infer but should log assumptions. |
| Product spec generation | A1 | Product intent requires human validation. |
| UX and requirements draft | A1-A2 | Drafts allowed; P0 scope is reviewed. |
| Architecture decisions | A0-A1 | Low-reversibility choices need approval. |
| Data and permissions | A0-A1 | Sensitive data and retention need explicit constraints. |
| Coding (in sandbox) | A2 | Safe in sandbox after handoff approval. |
| Testing and evaluation | A2 | Agent can run tests and report results. |
| Deployment | A0-A2 | Depends on environment risk and rollback. |
| Production operation | A0-A3 | Requires governance, monitoring, incident response, override. |

The autonomy level is recorded in the [role card](../templates/agentic-handoff/role-card.md) and surfaced in the [agent manifest](../templates/agentic-handoff/agent-manifest.md). The same agent may operate at different autonomy levels at different phases — autonomy is per-task, not per-agent.

## Ask-before policy

The agent must ask a human before:

- Storing sensitive, regulated, personal, financial, medical, legal, or confidential data.
- Selecting a paid external service or creating recurring operational cost.
- Introducing distributed services, microservices, irreversible migrations, or complex infrastructure.
- Removing, weakening, or redefining a P0 requirement.
- Deploying to a user-facing environment.
- Executing destructive actions such as delete, overwrite, migration, or permission changes.
- Taking action that affects money, health, legal status, security posture, customer communication, or contractual commitments.

This list is a **minimum**. Project-specific ask-before rules should be added to the agent manifest. Ask-before policy is enforced through [guardrails](../templates/agentic-handoff/guardrail.md) and [human checkpoints](../templates/agentic-handoff/human-checkpoint.md), not through agent goodwill.

## Confidence scoring

When an agent draws an inference rather than receiving an explicit answer, it scores its own confidence. The score governs whether the agent may proceed:

```yaml
confidence_score:
  evidence_strength:
    explicit_human_input: 3
    trusted_external_source: 3
    similar_product_archetype: 2
    agent_inference_only: 1
  archetype_fit:
    direct_match: 3
    partial_match: 2
    weak_match: 1
  reversibility:
    easy_to_change: 3
    moderate_migration: 2
    hard_to_reverse: 1
  risk_adjustment:
    low_risk: 0
    medium_risk: -1
    high_risk: -2
```

Decision rule:

- **Total 7 or higher:** agent may proceed and log the assumption to the [assumption log](../templates/agentic-handoff/assumption-log.md).
- **Total 5–6:** agent may proceed only if the underlying decision is reversible and non-sensitive.
- **Total 4 or lower:** agent must ask or escalate before implementing.

The confidence score is not a substitute for the ask-before list. Anything in the ask-before list is a hard escalation regardless of score.

## Evaluation gates specific to agent systems

The evaluation deliverable template covers harness evaluation in general. Product-development agent systems need three additional evaluation gates -- they sit on top of, not in place of, the standard evaluation output contract:

1. **Spec lint** ([template](../templates/agentic-handoff/spec-lint-checklist.md)). Mechanical pre-flight — required IDs, P0 stories with acceptance criteria, P0 requirements with tests, assumptions with confidence and validation paths, sensitive data classified, architecture decisions with rationale, non-goals defined, agent decision boundaries defined, no unresolved low-reversibility decisions. The Spec Review Agent runs this; failure is a hard block.
2. **Traceability check** ([template](../templates/agentic-handoff/traceability-matrix.md)). Every P0 user need maps through story → requirement → UX flow → entity → test. The QA / Evaluation Agent owns the matrix. Missing columns are build blockers.
3. **Evaluation scorecard** ([template](../templates/agentic-handoff/evaluation-scorecard.md)). Seven dimensions scored 0–3: product coherence, requirement quality, traceability, architecture fit, security posture, test coverage, agent handoff readiness. Anything below 2 on a P0 dimension blocks handoff.

These are run **before the coding agent gets the pack**, not after the build. Defects are roughly an order of magnitude cheaper to fix at the spec stage than at the build stage.

## How this maps onto Agent Builder surfaces

| Agent Builder surface | What this synthesis adds |
|---|---|
| `references/catalog/01-architecture-taxonomy.md` | Workflow-governed multi-agent as the next default after single-agent for product-development jobs. Triage + specialists + reviewers as a named pattern. |
| `references/catalog/02-harness-components.md` | T0-T5 permission tier table, tool-as-contract framing, state-type taxonomy, and role-card/handoff-envelope patterns as concrete harness components. |
| `references/templates/agentic-handoff/tool-contract.md` | Tool-as-contract governance with permission tiers, approval gates, error handling, and examples. |
| `references/templates/agentic-handoff/artifact-version.md` | Artifact versioning as a durability pattern: every artifact has version, status, source inputs, change log, and confidence. |
| `references/templates/agentic-handoff/role-card.md` | Role-card pattern as the agent contract. Triage + specialists + reviewers as the named multi-agent shape. |
| `references/templates/evaluation-deliverable.md` | Spec lint, traceability matrix, and evaluation scorecard as agent-system-specific evaluation gates that run pre-build. Confidence scoring as the in-flight uncertainty manager. |
| `12-agentic-systems-handoff-addendum.md` | This file is the cross-source merge promised in file 12's TODO list. The 14-file handoff folder in file 12 stands; this file adds the *agent network* that produces it. |
| Generated `prompts/prompt-builder-contract.md` | Prompt-specific roles, variables, constraints, scoring, and fixture expectations for generated agent/skill/plugin prompts. |

The base catalog, deliverable templates, examples, and generated artifact contracts apply unchanged. This synthesis adds product-development-specific agent-network guidance without changing those foundation surfaces.

## Implementation roadmap

A four-phase roadmap matching the addenda — useful when standing up a product-development agent system from scratch.

### Phase 1: Single-orchestrator MVP

Build one orchestrator that creates the eight-file minimum handoff (per file 12) and runs spec lint. Do not build full autonomy yet. Deliverables: intake normalizer, product brief generator, requirements generator, decision criteria generator, spec lint checklist, agent handoff generator.

### Phase 2: Specialist review agents

Add independent review agents for UX, architecture, data, security, and QA. Deliverables: role cards for each specialist, handoff envelopes between them, the traceability matrix, security guardrails, the evaluation scorecard.

### Phase 3: Coding-agent integration

Connect to a coding agent (Claude Code, Codex, Replit, Cursor) using the approved handoff pack. Deliverables: build instructions, test plan, sandbox execution, completion report, known-limitations report.

### Phase 4: Closed-loop learning

Add case-based reasoning, assumption tracking, and post-build feedback into the case library. Deliverables: product archetype library, decision-outcome tracking, rework analysis, agent performance metrics, updated defaults and prompts.

Phase 1 should produce a runnable system. Phase 2 should produce a system worth trusting with a P0 build. Phase 3 should produce builds. Phase 4 makes the system improve over time.

## Operational metrics and review thresholds

| Metric | Definition | Direction |
|---|---|---|
| Intake completion rate | Percent of intakes producing a buildable spec without excessive follow-up. | Higher |
| Blocking-question precision | Percent of follow-up questions that truly block P0, security, data, or architecture. | Higher |
| Spec lint pass rate | Percent of generated specs passing lint on first review. | Higher |
| Traceability completeness | Percent of P0 stories mapped end-to-end. | Higher |
| Assumption reversal rate | Percent of assumptions later rejected. | Lower |
| Decision reversal rate | Percent of architecture/product decisions later reversed. | Lower |
| Build success rate | Percent of handoffs producing runnable builds. | Higher |
| Test pass rate | Percent of generated tests passing after implementation. | Higher |
| Rework rate | Percent of coding work redone due to bad specs. | Lower |
| Security finding rate | Number/severity of security findings per build. | Lower, after early discovery stabilizes |
| Time to alpha | Time from intake to runnable alpha. | Lower |
| Human approval latency | Time waiting for human approval on blockers. | Lower |

Review thresholds:

- If **spec lint pass rate** falls below 80%, improve templates before adding more agents.
- If **assumption reversal rate** exceeds 20%, tighten the follow-up question policy.
- If **build success rate** is below 70%, improve coding-agent handoff and test specs.
- If **security findings** repeat across builds, add guardrails or default policies.
- If **decision reversal rate** is high, add AHP / weighted scoring / morphological analysis for low-reversibility decisions.

## Open contradictions and how this synthesis resolves them

| Contradiction | Resolution |
|---|---|
| Autonomy ladder: Perplexity v1 A0–A5 vs ChatGPT A0–A4 vs Perplexity v2 A0–A4 | Adopt A0–A4 as canonical (Perplexity v2 + ChatGPT now agree). Perplexity v1's A0–A5 is retained as a more granular variant with a bidirectional mapping (table above). Cross-source agreement is the deciding factor; the v1 review-time distinctions are recoverable inside A0–A4 with sub-level notes on the role card. |
| Tool contract schema: Perplexity comprehensive vs ChatGPT lean | Merge into one canonical schema in `templates/agentic-handoff/tool-contract.md`. Perplexity's fields are canonical; ChatGPT's `tool_id` is an alias of `tool_id`. ChatGPT's `error_behavior` and `examples` fields are kept as additions. |
| Agent registry: Perplexity full agent manifest vs ChatGPT per-agent registry | Both are needed. The system manifest is one document; the per-agent registry is a sibling block inside it. Both shapes ship in `templates/agentic-handoff/agent-manifest.md`. |
| Handoff folder: 14 files (Perplexity) vs no specific count (ChatGPT) | The 14-file folder is the *output* of the agent system, owned by `12-agentic-systems-handoff-addendum.md`. The agent system that produces it is owned by this file. Neither file claims the other's territory. |

Anything not listed here was synthesized without a meaningful conflict — the two addenda were complementary by design, with Perplexity strongest on the artifact set and ChatGPT strongest on the agent network that produces it.

## Final principle

The human defines purpose, boundaries, desired outcome, and risk tolerance. The agent network infers reversible implementation details, drafts buildable artifacts, reviews its own work through specialist review agents, scores its confidence, escalates anything below the confidence floor or in the ask-before list, and emits a versioned, traceability-complete, lint-passing, scorecard-passing handoff pack to a coding agent.

The product-development agent system is responsible for the quality of the spec. The coding agent is responsible for the quality of the build. The boundary between them is the handoff pack, and that boundary is what this methodology is designed to make trustworthy.
