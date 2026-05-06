# Modular Chief of Staff Architecture Plan

Date: 2026-04-30

## Research Anchors

- MemGPT / Letta: memory hierarchy, persistent state, self-editable memory, and
  context management should be first-class architecture concepts.
- LangGraph: durable execution and human-in-the-loop require checkpointable
  workflows, explicit thread/run state, and resumable approval boundaries.
- MCP: tools need schemas, structured outputs, trust/safety annotations, audit,
  timeouts, and user confirmation for sensitive operations.
- Magentic-One: keep an orchestrator/ritual layer that can add or remove
  specialized agents later without rewriting the system.
- OpenAI Agents SDK: guardrails and tracing should be separate from agent logic.

## Target Layers

```text
src/
  server/          HTTP server, request parsing, route composition
  core/            policy, workspace, audit, approvals
  rituals/         durable CoS workflows
  tools/           deterministic capabilities exposed to rituals/agents
  integrations/    Ollama, calendar, future Apple/Gmail/Outlook/Slack adapters
  public/          browser UI
```

## Execution Steps

1. Create route modules and make `src/server.mjs` a thin entrypoint.
2. Move core safety/workspace/approval modules under `src/core`.
3. Move Ollama and ICS code under `src/integrations`.
4. Split the daily planner into schema, prompt, fallback, renderer, and runner.
5. Add placeholder ritual modules for weekly review, meeting prep, and
   end-of-day review with clear contracts.
6. Add a tool registry with permission metadata for future model/tool routing.
7. Add architecture boundary tests.
8. Update docs and run validation.

## Boundary Rules

- `server/**` may import `core`, `rituals`, `tools`, and `integrations`.
- `rituals/**` may import `core`, `tools`, and `integrations`.
- `tools/**` may import `core` and `integrations`.
- `integrations/**` may import `core/policy` only when needed.
- `core/**` must not import `server`, `rituals`, `tools`, or `integrations`.
- `public/**` must only call HTTP APIs.

## Validation

- `npm test`
- `npm run build`
- Static scan for delete/network violations
- NavGator scan on a temporary copy if sibling `.navgator` writes are blocked
