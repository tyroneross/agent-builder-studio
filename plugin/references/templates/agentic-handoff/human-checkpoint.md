# Human Checkpoint Template

> Use one checkpoint per gate where the agent system pauses for human review. Checkpoints carry the agent's recommendation, the items the human is asked to review, the human's decision, and free-form notes. Checkpoints are append-only — once a human responds, the record is closed; further changes go through a new checkpoint.

```yaml
checkpoint_id: "CHK-001"
phase: "pre-build"
requires_human: true
review_items:
  - "P0 scope"
  - "Architecture decision"
  - "Sensitive data handling"
  - "Ask-before rules"
agent_recommendation: "approve | revise | block"
human_decision: "approved | changes_requested | blocked"
notes: "<human notes>"
```

## Conventions

- Phase names should match the recommended flow: `intake`, `pre-spec`, `pre-build`, `pre-deploy`, `post-deploy`. Add new phases when the system grows new gates.
- The `agent_recommendation` field is what the system thinks should happen. The `human_decision` field is what actually happens. They must be recorded separately so the system can learn from the gap (decision reversal rate, see methodology/13 §operational metrics).
- A `blocked` decision must include notes explaining why so the responsible specialist agent can revise.
- The orchestrator must not advance past a `requires_human: true` checkpoint until `human_decision` is set.

## Required checkpoints by default

| Phase | Why it requires a human |
|---|---|
| `pre-spec` | Confirm mission, North Star, autonomy level, sensitive-data handling. |
| `pre-build` | Approve P0 scope, architecture decision, ask-before rules, security review findings. |
| `pre-deploy` | Approve deployment to user-facing environment, secrets, rollback plan. |
| `post-deploy` | Review monitoring, incidents, drift before the next build cycle. |

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` (ChatGPT addendum, "Human review checkpoint").
