# Handoff Envelope Template

> Use whenever one agent passes work to another, or when a human passes work into the agent system. The envelope carries the task, input artifacts at specific versions, the acceptance bar, known constraints, assumptions to preserve, open questions, escalation conditions, and a trace ID. Treat the envelope as the only source of truth the receiving agent needs to start work.

```yaml
handoff_id: "HND-001"
from_agent: "AGENT-TRIAGE"
to_agent: "AGENT-REQ"
task: "Create buildable requirements from product brief and user context."
priority: "P0 | P1 | P2"
input_artifacts:
  - artifact_id: "00-product-brief.md"
    version: "0.2"
  - artifact_id: "01-user-context.md"
    version: "0.2"
required_outputs:
  - "02-requirements.md"
acceptance_bar:
  - "Every P0 story has Given/When/Then acceptance criteria."
  - "Every P0 requirement maps to a user need."
known_constraints:
  - "Do not infer regulated-data handling without explicit confirmation."
assumptions_to_preserve:
  - "ASSUMP-003"
open_questions:
  - question_id: "OQ-002"
    blocking: false
escalation_conditions:
  - "Missing P0 workflow."
  - "Sensitive data ambiguity."
trace_id: "TRACE-123"
```

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` (ChatGPT addendum, "Handoff envelope").
