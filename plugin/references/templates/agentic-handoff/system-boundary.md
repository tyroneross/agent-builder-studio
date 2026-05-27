# System Boundary Template

> Use one system-boundary block per deployed agent system, alongside the [agent manifest](agent-manifest.md). The boundary names what is inside and outside the system: its mission, in-scope and out-of-scope tasks, the external tools and agents it relies on, the human roles that participate, the data sources it reads, the systems of record it writes to, and the world-changing actions it is allowed to perform. Most safety reviews start here — if the boundary is fuzzy, autonomy and tool-permission decisions downstream cannot be evaluated.

```yaml
system_boundary:
  agent_system_name:
  primary_mission:
  users_served:
  in_scope_tasks:
    - "<task this system is responsible for>"
  out_of_scope_tasks:
    - "<task this system is explicitly not responsible for>"
  external_tools:
    - "<MCP server, API, browser, shell, database>"
  external_agents:
    - "<A2A peer or external orchestrator>"
  human_roles:
    - "<role>: <decisions this human owns>"
  data_sources:
    - "<source>: <read | read+write> <classification>"
  systems_of_record:
    - "<system>: <what the agent may write>"
  actions_that_change_the_world:
    - "<action>: <approval gate>"
```

Use this block early — before tool contracts, before role cards, before the autonomy ladder is set. The boundary is what the rest of the handoff is bounded by.

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-template-pack-addendum-v2.md` (Perplexity v2 addendum, "System boundary").
