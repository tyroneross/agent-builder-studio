# Tool Contract Template

> Use one tool contract per tool the agent system exposes. Tools are the contract between deterministic code and non-deterministic agents — the schema, permission tier, side effects, approval policy, audit fields, failure behavior, and test cases must be explicit. Cross-reference the [permission tiers](#permission-tier-reference) below when assigning `permission_tier`.

This template merges the comprehensive form from the Perplexity addendum with the leaner form from the ChatGPT addendum. The Perplexity form is canonical — it covers every field needed to write the tool, sandbox it, audit it, and roll it back. Agents authoring tool definitions should fill the canonical form; ChatGPT-style fields are aliases noted inline.

## Canonical schema

```yaml
tool_contract:
  tool_id: "TOOL-001"            # ChatGPT alias: tool_id
  tool_name: "create_requirement"
  purpose: "Create or update a requirement record."
  owner: "<team or service>"
  type: "function | MCP | hosted | shell | browser | external_api | agent"
  allowed_agents:                # which agent ids may call this tool
    - "AGENT-REQ"
  input_schema:
    requirement_id: "string"
    behavior: "string"
    priority: "P0 | P1 | P2"
    source: "explicit | inferred"
  output_schema:
    artifact_id: "string"
    validation_status: "valid | invalid"
  allowed_actions:
    - "<action>"
  forbidden_actions:
    - "<action>"
  permission_tier: "T0 | T1 | T2 | T3 | T4 | T5"   # see reference below
  auth_scope: "<service identity / user identity / scope>"
  data_access_scope: "<files, records, projects this tool can touch>"
  rate_limits: "<calls per minute / per run>"
  timeout: "<seconds>"
  side_effects:
    - "<external state change, if any>"
  requires_human_approval: false
  approval_preview_fields:
    - "<field shown to human approver>"
  rollback_strategy: "<how to undo, or 'none — irreversible'>"
  audit_log_fields:
    - "agent_id"
    - "task_id"
    - "input_hash"
    - "output_hash"
    - "decision_id"
  failure_modes:
    - "<failure mode>"
  error_behavior:
    - "If requirement_id already exists, return conflict instead of overwriting."
  examples:
    - input: { requirement_id: "REQ-001", priority: "P0" }
      expected_behavior: "Creates requirement and links it to source."
  test_cases:
    - "<test id>"
```

## Permission tier reference

| Tier | Capability | Examples | Default approval |
|---|---|---|---|
| T0 | No tool access | Draft text only | No approval |
| T1 | Read-only local context | Read project docs, inspect state | No approval if data is in scope |
| T2 | Read external systems | Search docs, query CRM, read GitHub issues | Approval depends on data sensitivity |
| T3 | Write reversible changes | Create draft, stage file, update non-public record | Usually preview or undo required |
| T4 | External communication | Send email, post Slack, create ticket, comment on PR | Human approval required |
| T5 | Irreversible or high-impact action | Delete data, deploy production, spend money, change permissions | Strong human approval required |

## Tool safety rules

- Tools should be narrow, named clearly, and namespaced by domain.
- Tools should reject invalid schemas rather than letting the agent improvise.
- Destructive tools require explicit approval and dry-run mode.
- Tool outputs should include enough structured data for downstream agents to verify results.
- Tool calls should be traced with input, output, agent ID, artifact ID, and decision ID.
- Tools should use least-privilege credentials and short-lived access where possible.

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-template-pack-addendum.md` (Perplexity addendum, "Tool contract template" and "Permission tiers"); `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` (ChatGPT addendum, "Tool definition template" and "Tool safety rules").
