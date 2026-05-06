# Modular Architecture Research

Date: 2026-04-30

## Question

What modular architecture should support a full local-first Chief of Staff app
that can scale to richer rituals, larger local models, future massive-context
models, and gated work integrations?

## Findings

1. **Memory must be a first-class architecture layer.** MemGPT frames long-term
   agents as systems that move information between fast in-context memory and
   slower external memory. Letta's docs operationalize this through core memory
   blocks plus external/archival memory. The CoS architecture should keep a
   small working profile/current-state packet in context and store full tasks,
   commitments, decisions, meetings, and session history outside context.

2. **Human approval needs durable workflow state.** LangGraph's persistence and
   human-in-the-loop docs center on checkpoints, interrupts, and resumable
   thread IDs. The CoS should treat approvals as durable pause points, not as UI
   afterthoughts.

3. **Tools need explicit schemas, validation, and confirmation UX.** The MCP
   tools specification describes tool names, input/output schemas, structured
   content, error handling, and trust/safety expectations. The CoS tool registry
   should preserve those fields even before exposing a formal MCP server.

4. **The orchestrator should be stable while specialists can change.**
   Magentic-One uses an orchestrator that plans, tracks progress, replans, and
   delegates to specialist agents; its abstract says the modular design allows
   agents to be added or removed without retuning the whole system. The CoS
   equivalent is the ritual/orchestration layer.

5. **Future larger models do not remove the need for modularity.** Larger
   contexts reduce retrieval pressure, but do not replace permission boundaries,
   audit logs, deterministic tools, durable approvals, or testable workflow
   contracts.

## Architecture Consequence

The CoS app should be organized as:

```text
server       HTTP routes and static assets
core         policy, workspace, memory, audit, approvals
rituals      durable CoS workflows
tools        deterministic capabilities with permission metadata
integrations model, calendar, OS, email, chat adapters
public       browser UI
```

## Sources

- MemGPT: https://arxiv.org/abs/2310.08560
- Letta memory docs: https://docs.letta.com/guides/agents/memory
- LangGraph persistence: https://docs.langchain.com/oss/javascript/langgraph/persistence
- LangGraph human-in-the-loop: https://docs.langchain.com/oss/javascript/langchain/human-in-the-loop
- MCP tools specification: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- Magentic-One: https://arxiv.org/abs/2411.04468
