# Agent Manifest Template

> Use one manifest per deployed agent system. The manifest is the system-level record that pulls together every other artifact — mission, North Star, architecture pattern, SDK choice, model routes, tool list, memory model, MCP/A2A protocols, guardrails, human checkpoints, evaluation strategy, observability, deployment, and deactivation. The manifest is the single document a coding agent (or a future maintainer) reads to understand what was built and what guarantees the system is meant to provide.

This template ships in two parts: the canonical Perplexity-style manifest covering the full system, and a per-agent registry block from the ChatGPT addendum that lives inside the manifest as the `agents:` section.

## System manifest (canonical)

```yaml
agent_manifest:
  name:
  version:
  mission:
  north_star_metric:
  users:
  autonomy_level:                 # see methodology/13 §autonomy ladder
  architecture_pattern:           # single | router | sequential | parallel | orchestrator-worker | evaluator-optimizer | multi-agent handoff | custom graph
  sdk_choice:                     # direct API | OpenAI Agents SDK | LangGraph | custom
  model_routes:
    router:
    planner:
    executor:
    evaluator:
  tools:
    - name:
      permission_tier:            # T0 - T5, see templates/agentic-handoff/tool-contract.md
      approval_required:
  memory:
    working_state:
    session_memory:
    long_term_memory:
  protocols:
    mcp:
    a2a:
  guardrails:
    input:
    tool:
    output:
    handoff:
  human_checkpoints:
  evals:
  observability:
  deployment:
  deactivation:
```

## Per-agent registry (sibling block inside the manifest)

```yaml
agents:
  - agent_id: "AGENT-TRIAGE"
    name: "Intake and Triage Agent"
    owner: "Product Ops"
    model: "<model>"
    autonomy_level: "A1"
    allowed_tools:
      - "artifact_read"
      - "artifact_write"
    can_handoff_to:
      - "AGENT-PRODUCT"
      - "AGENT-SECURITY"
    review_required: false
  - agent_id: "AGENT-REQ"
    name: "Requirements Agent"
    owner: "Product Ops"
    model: "<model>"
    autonomy_level: "A1"
    allowed_tools:
      - "artifact_read"
      - "artifact_write"
      - "create_requirement"
    can_handoff_to:
      - "AGENT-UX"
      - "AGENT-ARCHITECTURE"
    review_required: true
```

## Conventions

- The manifest is versioned. Bump the version on any change that affects allowed tools, autonomy levels, model routes, guardrails, or human checkpoints.
- Every agent in the `agents:` block must have a corresponding [role card](role-card.md).
- Every tool in the `tools:` block must have a corresponding [tool contract](tool-contract.md).
- Every guardrail entry must have a corresponding [guardrail definition](guardrail.md).
- The manifest is the contract a coding agent reads before building. If something is in the manifest but not implemented, that is a defect; if something is implemented but not in the manifest, that is a governance gap.

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-template-pack-addendum.md` (Perplexity addendum, "Agent manifest template"); `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` (ChatGPT addendum, "Agent registry").
