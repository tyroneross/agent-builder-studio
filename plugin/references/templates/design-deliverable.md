# Design Deliverable Template

> Use when the skill is in `design` or `design + evaluation` mode. Structure the output this way — do not free-form.

---

## 1. Job Definition

State in one paragraph:
- **Who** the harness serves (user + operator)
- **What job** it owns (single sentence)
- **Actions** it may take (bullet list, ≤10)
- **What must never happen** (hard constraints — safety, cost, data)

## 2. Architecture

- **Shape:** (chat assistant / workflow orchestrator / code agent / copilot / embedded feature / hybrid)
- **Catalog type:** (Type I / II / III / IV / V — cite `catalog/01-architecture-taxonomy.md`)
- **Coordination pattern:** (prompt chain / routing / parallel / orchestrator-workers / evaluator-optimizer / hierarchical / autonomous loop)
- **Rationale:** one paragraph explaining why this shape beats the next-closest alternative

## 3. Primitives & Subsystems

List the minimum useful set. For each:
- **Name**
- **Responsibility** (one line)
- **Reads / Writes** (what state, what side effects)
- **Trust tier** (free / user-approved / admin-approved / never)
- **Audit evidence** (what log or record proves it ran correctly)

## 4. State & Lifecycle

- Request entrypoint
- Preflight checks
- First model call inputs
- State writes
- Side-effect boundaries
- Wait / resume conditions
- Completion path
- Failure path

If retries or approvals exist, name the explicit workflow states.

## 5. Context & Memory

- **Turn-one mandatory context** — what's always injected
- **Retrieved later** — what's pulled on demand
- **Persistent memory** — what survives the session, and which substrate (cite `catalog/04-memory-substrates.md` if non-obvious)
- **Provenance** — how each context item's source is tracked
- **Staleness defense** — how old context is prevented from dominating

## 6. UX & Observability

- What the user sees while work runs (streaming / spinner / live log)
- How approvals are surfaced
- Stop reasons the user can see
- Logs / health surfaces operators get
- Cost signals that matter (per-turn tokens, per-session $, per-tool invocation count)

## 7. MVP Boundary

Name the thinnest vertical slice that proves the harness works end-to-end. Everything outside this boundary is Phase 2+.

## 8. Phased Implementation

### Phase 1 — Minimum safe harness
- Entrypoint
- Orchestrator
- Capability registry
- Permission layer
- Basic state handling
- Minimal evaluation suite

### Phase 2 — Durability, richer UX, observability
Only where the product actually needs them.

### Phase 3 — Extensibility / multi-agent
Only after the core harness is stable and measurable. If Phase 3 involves multi-agent, include the cost/failure-rate citation from `catalog/01-architecture-taxonomy.md` justifying the escalation.

## 9. Evaluation Plan (before calling it done)

- **Golden tasks** — the 5–20 happy-path cases that must always work
- **Risky tasks** — inputs that probe known failure modes
- **Recovery tests** — crash, timeout, approval denial, tool failure
- **Permission boundary tests** — prove restricted tools stay restricted
- **UX acceptance** — what "feels explainable" means measurably

## 10. Key Risks

Top 3–5 risks with mitigation or acceptance note.

## 11. Framework / Substrate Choices (if applicable)

If the design commits to a framework or memory substrate, cite:
- `catalog/03-frameworks.md § <framework>` — reason for pick, reason against alternatives
- `catalog/04-memory-substrates.md § <substrate>` — reason for pick

Do not recommend a framework if the user hasn't asked for one and raw SDK calls suffice.

---

*Template · Agent Builder original deliverable format + `catalog/01` architecture selection*
