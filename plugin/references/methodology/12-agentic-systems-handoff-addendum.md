# Agentic Systems Handoff Addendum

> **Reference:** Perplexity research, captured 2026-05-02. Companion to the LLM product-development template pack (research entry: `product-dev.llm-product-development-template-pack`). This addendum is specific to agentic systems — autonomy, tool permissions, orchestration topology, memory, handoffs, evaluation. Cross-saved at `~/dev/research/topics/product-dev/product-dev.agentic-systems-template-pack-addendum.md`.
>
> **See also:**
> - `13-agentic-product-dev-synthesis.md` — the cross-source merge of this addendum with the ChatGPT addendum, plus mapping onto Agent Builder's catalog, templates, prompt contracts, and generated artifacts.
> - `~/dev/research/topics/product-dev/product-dev.agentic-systems-template-pack-addendum-v2.md` — **Perplexity v2 (supersedes this addendum's source)**: revised A0–A4 autonomy ladder, cross-source merge with ChatGPT, default agent role decomposition, staged implementation, operational thresholds, and the new `system_boundary` and `flow_topology` schemas.
> - `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` — the ChatGPT-sourced companion addendum (multi-agent role decomposition, handoff envelope, autonomy levels, evaluation scorecard, operational metrics).
> - `references/templates/agentic-handoff/` — 15 reusable schemas (role cards, handoff envelopes, tool contracts, guardrails, traceability matrix, agent manifest, eval scorecard, spec-lint, ADR, human checkpoints, system boundary, flow topology) synthesized from the research addenda.

## Executive summary

Agentic systems need a different handoff package than ordinary software products. A normal app handoff can describe users, workflows, data, UI, architecture, and tests. An agentic-system handoff must also define autonomy boundaries, tool permissions, orchestration topology, memory behavior, handoff rules, guardrails, observability, evaluation, and how the system decides when to ask humans for help.

The core design principle is that an LLM coding agent should not be told only "build an agent." It needs a complete operating model: what the agent is for, what success means, what actions it may take, what tools it can use, what data it can see, when it must stop, when it must ask for approval, how agents hand work to each other, and how the system will be evaluated in production.

The most important architectural choice is not the framework. It is the allocation of work across deterministic code, LLM judgment, tools, humans, memory, and feedback loops. Anthropic's guidance distinguishes workflows, where LLMs and tools follow predefined code paths, from agents, where LLMs dynamically direct their own process and tool use; it recommends starting simple and adding agentic complexity only when it demonstrably improves outcomes ([Anthropic](https://www.anthropic.com/research/building-effective-agents)). This addendum translates that principle into a practical template set for ProductPilot-style automated product development.

## What is different about an agentic-system handoff

A coding agent building a regular app mostly needs to know what the app should do. A coding agent building an agentic system needs to know what the app is allowed to decide.

That means the handoff must define:

- **Purpose**: What outcome the agent exists to produce.
- **North Star**: The measurable result that defines whether the agent is useful.
- **Operating boundary**: What the agent should and should not attempt.
- **Autonomy level**: Whether the agent suggests, drafts, executes reversible actions, or executes high-impact actions.
- **Tool surface**: What tools the agent can access, with permission scopes and approval gates.
- **Context surface**: What memory, files, resources, APIs, and prior work the agent can use.
- **Control flow**: Whether work is sequential, parallel, interactive, routed, iterative, or delegated to other agents.
- **Handoffs**: How work moves between agents, tools, humans, and coding systems.
- **Evaluation**: What tests, traces, metrics, and acceptance signals prove that the agent works.
- **Safety**: How the system prevents excessive agency, tool misuse, memory poisoning, privilege abuse, and unsafe tool execution.

The practical implication is that agentic-system handoffs need a richer set of artifacts than conventional PRDs. A good handoff is closer to an operating manual, control plan, architecture brief, tool contract, and evaluation plan combined.

## Industrial and systems engineering lens

An agent should be designed as a socio-technical production system, not only as a prompt. The useful unit of analysis is the full work system:

```text
Mission
  -> Inputs
  -> Agent reasoning and workflow
  -> Tools and external systems
  -> Outputs and actions
  -> Feedback
  -> Controls and improvement loop
```

From an industrial and systems engineering perspective, the handoff should specify the system's transformation process, constraints, resources, controls, feedback loops, failure modes, and performance measures. The NIST AI Risk Management Framework is useful here because it frames AI risk management as an iterative lifecycle of govern, map, measure, and manage, including context, intended use, human oversight, production monitoring, safety, security, privacy, transparency, accountability, and post-deployment response processes ([NIST AI Resource Center](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/)).

### System boundary

Define what is inside and outside the agentic system:

```yaml
system_boundary:
  agent_system_name:
  primary_mission:
  users_served:
  in_scope_tasks:
  out_of_scope_tasks:
  external_tools:
  external_agents:
  human_roles:
  data_sources:
  systems_of_record:
  actions_that_change_the_world:
```

### Functional allocation

Every agentic system should allocate work across four execution modes:

| Function type | Best implemented by | Examples |
|---|---|---|
| Deterministic computation | Code | Validation, parsing, schema checks, permission checks, routing thresholds |
| Judgment under ambiguity | LLM | Classifying intent, drafting, summarizing, deciding which method to apply |
| External action | Tool or API | Sending email, updating CRM, editing repo, querying database |
| Accountability and exception handling | Human | Approving high-impact actions, resolving ambiguous policy conflicts |

The coding agent needs this allocation because overusing the LLM creates instability, while overcoding too much removes the flexibility that agents are meant to provide.

### Feedback and control

Agentic systems should include explicit feedback loops:

- **Task feedback**: Did the tool call work?
- **User feedback**: Did the user accept, edit, reject, or override?
- **Evaluator feedback**: Did a reviewer agent or test suite detect a problem?
- **Environment feedback**: Did an API, database, file system, browser, or external agent return a result?
- **Production feedback**: Did real users complete tasks successfully?

ReAct-style research supports this general pattern by interleaving reasoning traces and task-specific actions so the model can update plans, handle exceptions, and use external sources or environments to gather information ([ReAct paper](https://arxiv.org/abs/2210.03629)). For production systems, the reasoning trace does not need to expose hidden chain-of-thought; it does need observable state, tool calls, decisions, and results.

## Core architecture choices an LLM coding agent must know

### Workflow or agent

The first question is whether the system needs an agent at all.

| Use case | Prefer | Why |
|---|---|---|
| Fixed, repeatable process | Workflow | Predictable order, easier testing, lower autonomy risk |
| Many distinct categories | Router workflow | Specialized handling without full autonomy |
| Independent subtasks | Parallel workflow | Faster execution and multiple perspectives |
| Complex task decomposition | Orchestrator-worker | Dynamic subtasks with centralized synthesis |
| Output improves through critique | Evaluator-optimizer | Clear quality criteria and feedback loop |
| Open-ended task with unpredictable steps | Agent | Tool use and process are dynamically selected |

Anthropic describes prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer, and agents as progressively more complex patterns, with agents best suited to open-ended problems where hardcoded paths are not feasible ([Anthropic](https://www.anthropic.com/research/building-effective-agents)). LangGraph's documentation uses the same distinction between workflows with predetermined code paths and agents that dynamically define their process and tool usage ([LangChain](https://docs.langchain.com/oss/python/langgraph/workflows-agents)).

### Single agent, multi-agent, or skills

The second question is whether the system should have one agent, multiple agents, or one agent with modular skills.

| Pattern | Use when | Avoid when |
|---|---|---|
| Single agent with tools | Task is cohesive and tool count is manageable | Tool list is too large or domain context is too broad |
| Single agent with skills | Domain knowledge can be loaded on demand | The agent needs parallel independent workers |
| Router to specialists | Inputs fall into known categories | Routing labels are unclear or overlap heavily |
| Subagents as tools | Centralized control matters and specialists can work independently | Specialists need direct user dialogue |
| Handoffs | The active agent should change based on task state | Central control and auditability matter more |
| Custom graph workflow | You need deterministic sequence, branching, loops, and human checkpoints | A simple agent loop is sufficient |

LangChain's multi-agent guidance warns that not every complex task requires multiple agents; a single agent with the right tools and prompt can often be enough, while multi-agent patterns become valuable when one agent has too many tools, needs specialized context, or must obey sequential constraints ([LangChain](https://docs.langchain.com/oss/python/langchain/multi-agent)).

### Sequential, parallel, interactive, or feedback-loop flow

The coding agent needs an explicit data-flow pattern:

```yaml
flow_topology:
  pattern: "sequential | parallel | router | orchestrator_worker | evaluator_optimizer | interactive | hybrid"
  why_this_pattern:
  state_owner:
  stop_condition:
  retry_policy:
  human_checkpoint_policy:
  parallel_branches:
    - branch_name:
      input:
      output:
      merge_rule:
  feedback_loops:
    - evaluator:
      criterion:
      max_iterations:
      escalation:
```

Parallelism is useful when subtasks are independent, but it is unsafe when each step depends on cumulative context. Anthropic notes that parallel workflows work well for sectioning independent subtasks or voting across multiple attempts, while sequential workflows are better when each step builds on the previous one ([Anthropic](https://www.anthropic.com/research/building-effective-agents)).

### SDK or build from scratch

The coding agent needs a decision framework for SDK selection.

| Choice | Use when | Tradeoff |
|---|---|---|
| Direct model API plus custom loop | You need maximum control and a simple first version | More custom plumbing for tools, traces, guardrails, and sessions |
| OpenAI Agents SDK | You want built-in agent loop, tools, handoffs, guardrails, sessions, human-in-the-loop, MCP tool calling, sandbox agents, and tracing | Best when the project is comfortable with SDK conventions and OpenAI runtime assumptions |
| LangGraph | You need explicit state, graph workflows, loops, branching, persistence, human-in-the-loop, long-running execution, and durable state | More architecture work, but more control over orchestration |
| Existing app framework plus lightweight agent service | You have an existing product and only need bounded agent features | Less portable as a general agent platform |
| Full custom multi-agent platform | You need deep control over identity, permissions, memory, routing, tool execution, and enterprise governance | Highest engineering burden |

OpenAI's Agents SDK provides primitives for agents, tools, handoffs, guardrails, sessions, human-in-the-loop, MCP server tool calling, sandbox agents, and tracing; it is useful when the runtime should manage turns, tool execution, guardrails, handoffs, or sessions ([OpenAI Agents SDK](https://openai.github.io/openai-agents-python/)). LangGraph positions itself as a low-level orchestration framework for long-running, stateful agents with persistence, memory, streaming, human-in-the-loop oversight, debugging, and deployment support ([LangChain](https://docs.langchain.com/oss/python/langgraph/overview)).

## MCP, A2A, custom tools, and agent-to-agent communication

### MCP for agent-to-tool connectivity

MCP should be considered when an agent needs standardized access to external tools, data, or resources. MCP tools are model-controlled, meaning the model can discover and invoke them automatically based on context; each tool has a name, metadata, input schema, optional output schema, and invocation path ([Model Context Protocol](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)).

MCP resources provide context such as files, database schemas, or application-specific information, each identified by a URI and optionally annotated with audience, priority, and last-modified metadata ([Model Context Protocol](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)). MCP prompts allow servers to expose structured prompt templates with arguments and embedded resources, which makes them useful for maintaining prompt libraries that can be discovered and invoked consistently ([Model Context Protocol](https://modelcontextprotocol.io/specification/2025-06-18/server/prompts)).

### A2A for agent-to-agent connectivity

A2A should be considered when independent agents need to communicate, delegate tasks, or collaborate across frameworks or vendors. The A2A protocol is an open standard originally developed by Google and donated to the Linux Foundation; it is designed for agent-to-agent interoperability and enables agents to delegate subtasks, exchange information, and coordinate without sharing internal memory, tools, or proprietary logic ([A2A Protocol](https://a2a-protocol.org/latest/)).

### How to choose MCP, A2A, both, or neither

| Need | Recommended choice |
|---|---|
| Agent needs to call APIs, query databases, or access files | MCP or custom tools |
| Agent needs structured context from resources | MCP resources |
| Agent needs reusable prompt templates | MCP prompts or internal prompt registry |
| Agent needs to collaborate with external agents | A2A |
| One product controls all agents and tools internally | Custom tool contracts may be enough |
| Enterprise ecosystem with many tools and agents | MCP plus A2A |

The important distinction is that MCP standardizes agent-to-tool interaction, while A2A standardizes agent-to-agent communication ([Model Context Protocol](https://modelcontextprotocol.io/specification/2025-11-25/server/tools), [A2A Protocol](https://a2a-protocol.org/latest/)).

## Tool permissions and autonomy

Tool permissions are one of the highest-risk parts of agentic systems. OWASP defines excessive agency as damaging action enabled by excessive functionality, excessive permissions, or excessive autonomy, and recommends least-privilege tool permissions, user-scoped authorization, human approval for high-impact actions, and downstream authorization rather than relying on the LLM to decide what is allowed ([OWASP GenAI Security Project](https://genai.owasp.org/llmrisk2023-24/llm08-excessive-agency/)).

### Permission tiers

| Tier | Capability | Examples | Default approval |
|---|---|---|---|
| T0 | No tool access | Draft text only | No approval |
| T1 | Read-only local context | Read project docs, inspect state | No approval if data is in scope |
| T2 | Read external systems | Search docs, query CRM, read GitHub issues | Approval depends on data sensitivity |
| T3 | Write reversible changes | Create draft, stage file, update non-public record | Usually preview or undo required |
| T4 | External communication | Send email, post Slack, create ticket, comment on PR | Human approval required |
| T5 | Irreversible or high-impact action | Delete data, deploy production, spend money, change permissions | Strong human approval required |

### Tool contract template

```yaml
tool_contract:
  tool_name:
  purpose:
  owner:
  type: "function | MCP | hosted | shell | browser | external_api | agent"
  input_schema:
  output_schema:
  allowed_actions:
  forbidden_actions:
  permission_tier:
  auth_scope:
  data_access_scope:
  rate_limits:
  timeout:
  side_effects:
  requires_human_approval:
  approval_preview_fields:
  rollback_strategy:
  audit_log_fields:
  failure_modes:
  test_cases:
```

### Tooling decision questions

1. What tools does the agent need to complete the task?
2. Which tools already exist as APIs, MCP servers, SDK functions, CLIs, or internal services?
3. Which tools need to be built?
4. Which tool calls are read-only, reversible, externally visible, or irreversible?
5. What data can each tool access?
6. What user identity or service identity does each tool execute under?
7. What actions require approval?
8. What happens if the tool fails, times out, returns partial data, or returns malicious content?
9. What must be logged for audit and debugging?
10. What tool outputs should be sanitized before re-entering the LLM context?

OpenAI's Agents SDK guardrail documentation notes that agent-level input and output guardrails do not automatically cover every tool pathway, and that tool guardrails apply only to custom function tools rather than hosted tools, built-in execution tools, or handoff calls ([OpenAI Agents SDK guardrails](https://openai.github.io/openai-agents-python/guardrails/)). This means a ProductPilot handoff should not simply say "add guardrails." It should specify where guardrails run, which tool paths they cover, and which high-impact actions require deterministic authorization outside the LLM.

## Memory, context, and files such as soul.md

Agentic systems need explicit memory design. Memory is not just chat history. It includes working state, long-term preferences, task artifacts, tool results, decisions, assumptions, and policies.

### Memory types

| Memory type | Purpose | Storage pattern |
|---|---|---|
| Working state | Current run facts, decisions, intermediate outputs | Runtime state object or graph checkpoint |
| Session memory | Conversation and artifacts within one user thread | Thread-scoped store |
| Long-term memory | Durable preferences, user facts, learned patterns | User-scoped database with update policy |
| Episodic memory | Past task traces and outcomes | Trace store or case library |
| Semantic memory | Docs, policies, product knowledge | Retrieval store or MCP resources |
| Procedural memory | Skills, prompts, playbooks, tool-use rules | Prompt registry, skills directory, MCP prompts |
| Governance memory | approvals, waivers, incidents, audit trails | Append-only audit log |

LangGraph's memory guidance distinguishes short-term thread memory from longer-term memory, and describes state as data that can include conversation history, uploaded files, retrieved documents, or generated artifacts ([LangChain](https://docs.langchain.com/oss/python/concepts/memory)). MCP resources can expose context such as files, database schemas, or application-specific information with URI identity and priority annotations, making them useful as a structured context layer ([Model Context Protocol](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)).

### The role of soul.md

An agent may need a `soul.md`, `constitution.md`, or `operating-principles.md` file when judgment, brand, values, or consistent behavior matters. It should not be a vague persona document. It should define stable decision principles that shape behavior across tasks.

Recommended `soul.md` sections:

- Mission
- North Star
- Users served
- Operating principles
- What the agent should optimize for
- What the agent must never do
- Tone and interaction style
- Autonomy boundaries
- Escalation principles
- Decision tie-breakers
- Examples of good judgment
- Examples of bad judgment

Use `soul.md` when the agent needs durable judgment. Do not use it as a substitute for tool permissions, schemas, evals, or policies.

## Recommended file set for agentic-system handoff

An agentic-system build should produce a folder like this:

```text
agentic-system/
  00-agent-brief.md
  01-agent-operating-model.md
  02-agent-architecture.md
  03-workflow-graph.md
  04-state-and-memory-spec.md
  05-tool-registry.md
  06-permissions-and-autonomy-policy.md
  07-mcp-a2a-integration-plan.md
  08-prompt-library-spec.md
  09-guardrails-and-safety-case.md
  10-evaluation-and-observability-plan.md
  11-human-handoff-and-escalation.md
  12-deployment-runbook.md
  13-coding-agent-handoff.md
  adr/
    ADR-001-agent-sdk-selection.md
    ADR-002-orchestration-topology.md
    ADR-003-memory-design.md
    ADR-004-tool-permission-model.md
  prompts/
    system.md
    developer.md
    router.md
    evaluator.md
    tool-use.md
    refusal-and-escalation.md
  schemas/
    agent-manifest.schema.json
    state.schema.json
    tool-contract.schema.json
    handoff.schema.json
    eval-case.schema.json
  evals/
    eval-plan.md
    eval-cases.yaml
  soul.md
```

Not every project needs every file. The minimum viable handoff for a simple agent is:

```text
00-agent-brief.md
01-agent-operating-model.md
02-agent-architecture.md
04-state-and-memory-spec.md
05-tool-registry.md
06-permissions-and-autonomy-policy.md
10-evaluation-and-observability-plan.md
13-coding-agent-handoff.md
```

## Templates

> Full template bodies are preserved in the canonical research entry to keep this methodology file readable. See `~/dev/research/topics/product-dev/product-dev.agentic-systems-template-pack-addendum.md` for the complete templates: Agent Brief, Operating Model, Architecture, Workflow Graph, State & Memory Spec, Tool Registry, Permissions & Autonomy Policy, MCP/A2A Integration Plan, Prompt Library Spec, Guardrails & Safety Case, Evaluation & Observability Plan, Human Handoff & Escalation, Deployment Runbook, and Coding-Agent Handoff.

Highlights worth surfacing inline for the agent-builder skill:

### Permissions and Autonomy Policy — autonomy levels (canonical)

| Level | Description | Allowed examples | Forbidden examples |
|---|---|---|---|
| A0 | Answer only | Explain, summarize | Tool calls |
| A1 | Suggest | Recommend actions | Execute actions |
| A2 | Draft | Draft email, draft PR comment | Send or publish |
| A3 | Execute reversible | Create draft record, run read query | Delete, send, spend |
| A4 | Execute with approval | Merge after approval, send after approval | Skip approval |
| A5 | High autonomy | Routine operations within strict policy | High-impact exceptions |

### Agent manifest template

```yaml
agent_manifest:
  name:
  version:
  mission:
  north_star_metric:
  users:
  autonomy_level:
  architecture_pattern:
  sdk_choice:
  model_routes:
    router:
    planner:
    executor:
    evaluator:
  tools:
    - name:
      permission_tier:
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

## Agent-specific questionnaire

The questionnaire should be adaptive. The full question bank should cover Purpose & outcome, Users & operating context, Autonomy, Tools & connections, Agent architecture, Memory & context, Handoffs, and Evaluation & operations. Full list preserved in the research entry.

## Adaptive question routing for agentic systems

ProductPilot should not ask all questions up front. It should infer safe defaults where possible and ask only blocking questions.

### Ask immediately

Ask the human when the answer determines:

- The agent's mission.
- The level of autonomy.
- High-impact tool permissions.
- Whether the agent can communicate externally.
- Whether the agent can write, delete, spend money, or deploy.
- Data sensitivity and compliance constraints.
- Whether memory should persist across sessions.
- Human approval gates.

### Infer safely

Infer by default when the decision is reversible or conventional:

- Use a simple workflow before multi-agent orchestration.
- Use deterministic code for validation and permission checks.
- Use structured outputs for state and tool contracts.
- Log all tool calls.
- Start with read-only tool permissions.
- Require approval for external communications.
- Add evaluation cases before raising autonomy.

### Escalate later

Defer until implementation when:

- Exact framework choice does not affect product behavior.
- Tool implementation details can be abstracted behind contracts.
- UI can be adjusted after user testing.
- Model choice can be routed behind an interface.

## Decision methods for agent architecture

- **Weighted scoring** — SDK selection across direct API, OpenAI Agents SDK, LangGraph, custom platform. Score on orchestration control, tool support, guardrails, tracing, persistence, human-in-loop, vendor flexibility, implementation speed, team familiarity, long-term maintainability.
- **AHP** — when stakeholders disagree on safety/speed/cost/control priorities and the architecture decision is hard to reverse.
- **Morphological analysis** — explore feasible agent shapes across autonomy × orchestration × tool access × memory × communication × safety dimensions; flag incompatible pairs (e.g., high-impact tool access + no human approval).
- **TRIZ** — surface contradictions: more autonomy vs less risk, more memory vs stronger privacy, more tool access vs least privilege.
- **FMEA** — score component × failure × cause × effect × severity × occurrence × detectability; produce mitigations and tests.
- **SPC / control charts** — production monitoring of task success, tool failure, approval rejection, safety tripwire, latency, cost, user correction rates.
- **Bayesian updating / case-based reasoning** — improve defaults over time from logged outcomes.
- **Design of experiments** — compare prompts, model routes, tool descriptions, guardrail thresholds; isolate effects.
- **Queueing & capacity** — concurrency limits, backpressure, timeouts, cancellation, retry, prioritization for many-user / many-agent / slow-tool systems.

## What a coding agent must know before building

Before implementing an agentic system, the coding agent should have answers to these minimum questions:

1. What is the agent's mission and North Star?
2. What tasks are in scope and out of scope?
3. What level of autonomy is allowed?
4. What tools are needed and what can each tool do?
5. Which actions require human approval?
6. What state must persist across steps?
7. What memory persists across sessions?
8. What architecture pattern should be used first?
9. What SDK or framework should be used and why?
10. How are MCP, A2A, custom tools, or internal APIs used?
11. What are the agent's stop conditions?
12. What are the retry and fallback policies?
13. What are the handoff rules?
14. What guardrails run before, during, and after tool use?
15. What traces, logs, metrics, and evals prove the system works?
16. What failure modes are unacceptable?
17. How can the agent be disabled, rolled back, or decommissioned?

## Minimal viable addendum for ProductPilot

For ProductPilot, the agentic-system version of the product-development pack should generate these outputs first:

1. `agent-brief.md`
2. `agent-operating-model.md`
3. `agent-architecture.md`
4. `state-and-memory-spec.md`
5. `tool-registry.md`
6. `permissions-and-autonomy-policy.md`
7. `evaluation-and-observability-plan.md`
8. `coding-agent-handoff.md`

The first version should ask fewer than ten questions by prioritizing:

1. Mission and North Star.
2. User and task boundary.
3. Autonomy level.
4. Required tools and data sources.
5. High-impact actions.
6. Memory and privacy expectations.
7. Workflow topology.
8. Evaluation criteria.

Everything else can start as an assumption with confidence and be corrected during review.

## Recommended first build pattern

Default to the simplest architecture that satisfies the work:

```text
User request
  -> intake and classification
  -> deterministic policy check
  -> single agent with tools
  -> evaluator
  -> human approval if needed
  -> final output or action
```

Upgrade only when evidence justifies it:

- Add routing when task categories are distinct.
- Add parallel workers when subtasks are independent.
- Add evaluator-optimizer loops when quality criteria are clear.
- Add subagents when specialized context or tool sets become too large.
- Add A2A when independently deployed agents need to collaborate.
- Add MCP when standardized tool, resource, or prompt exposure is valuable.
- Add long-term memory only when the user value justifies privacy, governance, and deletion complexity.

## Final principle

The human should define the agent's purpose, boundaries, desired outcome, and risk tolerance. The system should infer reversible implementation details, but it must make autonomy, tools, memory, handoffs, and evaluation explicit before a coding agent starts building. A great agentic-system handoff gives the coding agent enough context to build not just an impressive demo, but a controlled, observable, testable, and improvable production foundation.

## Status — enhancement queue

- ✅ ChatGPT cross-source merge: completed in `13-agentic-product-dev-synthesis.md` (2026-05-02).
- ✅ Original synthesis mapping onto Agent Builder catalog/template surfaces: completed in file 13 (see "How this maps onto Agent Builder surfaces").
- ✅ Reusable template suite under `plugin/references/templates/agentic-handoff/`: completed (15 templates + index README).
