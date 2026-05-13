# Role Card Template

> Use one role card per agent in a multi-agent product-development system. The role card is the agent's contract — mission, allowed inputs and outputs, decisions it may make on its own, decisions it must escalate, tool permissions, quality bar, and completion signal. Pair every role card with at least one [handoff envelope](handoff-envelope.md) and one [agent output contract](agent-output-contract.md).

```yaml
agent_id: "AGENT-001"
name: "<Agent name>"
mission: "<one sentence>"
primary_outputs:
  - "<artifact>"
input_artifacts:
  - "<file or object>"
allowed_decisions:
  - "<decision this agent may make>"
must_escalate:
  - "<decision requiring human or orchestrator approval>"
forbidden_actions:
  - "<action>"
tools_allowed:
  - tool_name: "<tool>"
    permission: "read | write | execute | approve-required"
quality_bar:
  - "<acceptance criterion for this agent's work>"
completion_signal: "<what marks this agent's work complete>"
```

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` (ChatGPT addendum, "Role-card template").
