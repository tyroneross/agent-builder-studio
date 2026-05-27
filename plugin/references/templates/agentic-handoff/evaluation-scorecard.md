# Evaluation Scorecard Template

> Use as the rubric the QA / Evaluation agent (and any human reviewer) scores the handoff pack against before the Coding Agent is allowed to build. Each dimension is scored 0 to 3, with 3 meaning the artifact is buildable as-is. Anything below 2 on a P0 dimension should block handoff and route back to the responsible specialist agent.

## Scorecard

| Dimension | Score 0 | Score 1 | Score 2 | Score 3 |
|---|---|---|---|---|
| Product coherence | Contradictory | Partially coherent | Mostly coherent | Clear and aligned |
| Requirement quality | Ambiguous | Some testability | Mostly testable | Fully testable |
| Traceability | Missing | Partial | Mostly mapped | Complete P0 mapping |
| Architecture fit | Over/under-built | Some fit | Good fit | Clear, reversible, justified |
| Security posture | Unsafe | Gaps | Acceptable | Strong controls |
| Test coverage | Minimal | Some P0 | Most P0 | Full P0 + failure modes |
| Agent handoff readiness | Not buildable | Needs questions | Buildable with assumptions | Ready for coding agent |

## Decision rule

- **All dimensions 3:** Coding Agent may build without follow-up.
- **All dimensions 2 or 3:** Coding Agent may build, with assumptions logged for any 2 scores.
- **Any P0 dimension below 2:** block handoff. Route to the responsible specialist agent with the gap recorded.
- **Any score of 0:** block handoff and require human review before any further agent work.

## Conventions

- Score the pack, not individual agent runs.
- Score every revision. A scorecard from a previous version does not carry forward.
- Record the scorer (human or agent ID) and timestamp with every scorecard.
- Pair the scorecard with the [traceability matrix](traceability-matrix.md) — they answer different questions and are not substitutes for each other.

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` (ChatGPT addendum, "Evaluation scorecard").
