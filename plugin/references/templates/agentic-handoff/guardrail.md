# Guardrail Template

> Use one guardrail per discrete safety check the agent system enforces. Guardrails wrap inputs, tool calls, outputs, and handoffs — they are not soft prompts. Each guardrail names what triggers it, what check it runs, what it does on hit, and how severe the hit is. Pair with the [risk control matrix](#risk-control-matrix) below when classifying severity and escalation.

```yaml
guardrail_id: "GR-001"
name: "Sensitive Data Storage Guardrail"
applies_to:
  - "Data Agent"
  - "Coding Agent"
trigger:
  - "Artifact mentions PII, financial data, health data, legal data, credentials, or regulated records."
check:
  - "Is storage necessary for P0 workflow?"
  - "Is retention defined?"
  - "Are permissions defined?"
action:
  - "If missing, block build handoff and create OQ."
severity: "high"
escalation: "human approval required"
```

## Risk control matrix

| Risk | Control |
|---|---|
| Prompt injection | Treat retrieved/user content as untrusted; isolate instructions from data; add input and tool guardrails. |
| Sensitive data leakage | Classify data sensitivity; redact secrets; restrict logs; require approval before storage. |
| Excessive agency | Limit tools, permissions, autonomy, and action scope; use approval gates. |
| Improper output handling | Validate model output before downstream execution or display. |
| Supply-chain risk | Pin dependencies; scan packages; restrict tool installation; review generated code. |
| Cost/resource runaway | Set token, tool-call, runtime, and retry budgets. |
| Evaluation blind spots | Use acceptance tests, adversarial review, traceability checks, and human review for P0 scope. |

## Coverage note

Agent-level input and output guardrails do not automatically cover every tool pathway. In OpenAI's Agents SDK, tool guardrails apply to custom function tools but not to hosted tools, built-in execution tools, or handoff calls. Specify where each guardrail runs (before/after tool, before/after handoff, on input, on output) so coverage gaps are visible.

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` (ChatGPT addendum, "Guardrail template" and "Risk control matrix").
