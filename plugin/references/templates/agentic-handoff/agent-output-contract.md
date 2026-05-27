# Agent Output Contract Template

> Use as the structured output every agent emits when it completes (or fails to complete) a task. The contract makes downstream routing deterministic: the orchestrator reads `status`, `artifacts_created`, `next_recommended_agent`, and `confidence` to decide whether to proceed, retry, escalate, or hand to a human. Agents that emit free text instead of this contract should be treated as broken.

```yaml
agent_output:
  agent_id: "<agent>"
  task_id: "<task>"
  status: "complete | partial | blocked | failed"
  artifacts_created:
    - "<artifact_id>@<version>"
  decisions_made:
    - "DEC-001"
  assumptions_added:
    - "ASSUMP-001"
  risks_added:
    - "RISK-001"
  tests_or_checks_run:
    - "CHECK-001"
  blockers:
    - "<blocker or none>"
  confidence: "low | medium | high"
  next_recommended_agent: "<agent or none>"
```

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` (ChatGPT addendum, "Agent output contract").
