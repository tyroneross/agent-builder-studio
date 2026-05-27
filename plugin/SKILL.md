---
name: agent-builder
description: Design, evaluate, or rebuild agentic harnesses — tool use, permissions, workflow state, memory, evals, observability, multi-agent, framework selection. Activates on harness-gap symptoms too.
author: Tyrone Ross
version: 0.3.0
tags: [agentic-harness, agents, architecture, evaluation, memory, observability, frameworks, multi-agent, local-models, open-source, workflow, permissions]
category: developer-tools
difficulty: advanced
metadata:
  priority: 6
  pathPatterns:
    - '**/*harness*'
    - '**/*agent-runtime*'
    - '**/*agent_runtime*'
    - '**/*orchestrat*'
    - '**/*workflow*'
    - '**/*tool-registry*'
    - '**/*tool_registry*'
    - '**/*permission*'
    - '**/*approval*'
    - '**/*state-machine*'
    - '**/*state_machine*'
    - '**/*session*'
    - '**/*memory*'
    - '**/*eval*'
    - '**/*retry*'
    - '**/*ollama*'
    - '**/*llama-cpp*'
    - '**/*vllm*'
  importPatterns:
    - '@modelcontextprotocol/*'
    - 'langgraph'
    - '@langchain/*'
    - 'langchain'
    - '@vercel/workflow'
    - 'langchain_ollama'
    - 'langchain-ollama'
    - 'deepagents'
    - 'ollama'
    - 'llama-cpp-python'
    - 'vllm'
    - 'outlines'
    - 'instructor'
    - 'pydantic_ai'
    - 'pydantic-ai'
    - 'smolagents'
    - 'dspy'
    - 'crewai'
    - 'autogen'
    - 'claude_agent_sdk'
    - 'claude-agent-sdk'
  bashPatterns:
    - '\bnpm\s+(install|i|add)\s+[^\n]*(langgraph|langchain|@vercel/workflow|@modelcontextprotocol)\b'
    - '\bpnpm\s+(install|i|add)\s+[^\n]*(langgraph|langchain|@vercel/workflow|@modelcontextprotocol)\b'
    - '\bbun\s+(install|i|add)\s+[^\n]*(langgraph|langchain|@vercel/workflow|@modelcontextprotocol)\b'
    - '\byarn\s+add\s+[^\n]*(langgraph|langchain|@vercel/workflow|@modelcontextprotocol)\b'
    - '\b(pip|uv|uvx)\s+(install|add)\s+[^\n]*(langchain|langgraph|deepagents|ollama|llama-cpp-python|vllm|outlines|instructor|pydantic-ai|smolagents|dspy|crewai|autogen|claude-agent-sdk)\b'
  promptSignals:
    phrases:
      - "agentic harness"
      - "agent harness"
      - "ai harness"
      - "harness architecture"
      - "agent architecture"
      - "agent runtime"
      - "agent workflow runtime"
      - "tool-use architecture"
      - "tool use architecture"
      - "tool calling system"
      - "tool registry"
      - "capability registry"
      - "permission layer"
      - "approval gate"
      - "human-in-the-loop"
      - "workflow state"
      - "session persistence"
      - "durable agent"
      - "durable workflow"
      - "resume after crash"
      - "crash-safe agent"
      - "retry and idempotency"
      - "context assembly"
      - "memory system"
      - "evaluation harness"
      - "replay evals"
      - "agent observability"
      - "operator visibility"
      - "multi-agent architecture"
      - "single agent vs multi-agent"
      - "stop reasons"
      - "local model agent"
      - "open source agent"
      - "ollama agent"
      - "self-hosted agent"
      - "on-device agent"
      - "offline-first agent"
      - "local llm tool calling"
      - "framework selection"
      - "memory substrate"
    allOf:
      - [agent, harness]
      - [tool, registry]
      - [permission, approval]
      - [workflow, state]
      - [resume, retry]
      - [context, memory]
      - [evaluation, harness]
      - [multi-agent, architecture]
      - [durable, agent]
      - [operator, visibility]
      - [local, agent]
      - [open-source, model]
      - [ollama, agent]
    anyOf:
      - "agent orchestration"
      - "approval workflow"
      - "tool-calling runtime"
      - "tool calling runtime"
      - "state machine"
      - "retry policy"
      - "framework for agents"
      - "which framework"
      - "which memory store"
    noneOf: []
    minScore: 6
---

# Agent Builder

Cross-LLM skill (Claude Code, Codex, others). Frontmatter `metadata` block above is consumed by Codex for auto-triggering on file paths, imports, shell commands, and prompt signals; runtimes that don't read it ignore it without harm.

## Problem

Most AI products do not break because the model is too weak. They break at the **harness layer**: unclear tool boundaries, missing approval policy, brittle state, sloppy context assembly, no evaluation loop, weak operator visibility. This skill turns those vague issues into concrete primitives, boundaries, phases, and checks — grounded in empirical evidence from production systems.

Three complementary bodies of knowledge ship with this skill:

- **`references/methodology/`** — Agent Builder-owned research synthesis for agentic handoffs and product-development agent systems.
- **`references/catalog/`** — *what exists to choose from*. Empirical inventory: architecture types I–V, six-component harness model, frameworks (LangGraph, CrewAI, Pydantic AI, smolagents, DSPy, AutoGen, Bedrock), memory substrates, lab patterns (Anthropic, OpenAI, Perplexity, Manus, Google, Devin, Cursor).
- **Prompt Builder companion rules** — prompt contracts for generated agents, skills, plugins, eval judges, and tool-using prompts.

## Trigger Conditions

Activate when any of the following hold:

- The user is designing or rebuilding an agent, assistant, copilot, or AI workflow
- The request mentions harness architecture, tool-use architecture, tool registries, permission layers, approval gates, workflow state, session persistence, retries, resumability, memory, evals, observability, or multi-agent design
- The user wants to evaluate an existing harness for risks, missing primitives, UX gaps, or operational weakness
- The user is choosing between frameworks (LangGraph vs CrewAI vs Pydantic AI vs smolagents vs DSPy vs AutoGen vs Bedrock), memory substrates, or coordination patterns
- The symptoms point to harness problems even if the word "harness" never appears:
  - tools fire without clear permission
  - sessions fail on crash or long waits
  - context gets stale or bloated (routinely hitting 92%+ capacity)
  - tool count climbs past ~50 and quality drops
  - operators cannot see what happened or why
  - costs, retries, or handoffs are drifting out of control
  - multi-agent setup is producing loops or systemic failures

## Default Posture

1. Bias toward lean, solo-maintainable architecture.
2. Start with a single-agent design unless clear constraints justify more.
3. Require an evaluation plan even for greenfield builds.
4. Prefer explicit system boundaries, permission policy, and workflow state over prompt cleverness.
5. Translate ideas into implementation phases, success criteria, and failure tests.
6. **When justifying multi-agent, cite empirical cost**: single agent ≈ 4× chat tokens, multi-agent ≈ 15× chat tokens, 70%+ of multi-agent failures are systemic (MAST), only 11% of orgs run production agentic systems (Deloitte 2025). See `references/catalog/01-architecture-taxonomy.md` for sources.
7. **When the target is a local or open-source model**, apply the stricter local-model posture: start single-agent *always*, cull tools aggressively (Vercel 80% reduction pattern), compaction is non-negotiable (4K–32K context windows), evals are load-bearing not optional. See `references/catalog/06-local-and-open-source-models.md`.
8. **When generating prompts, skills, or plugin instructions**, use Prompt Builder as the prompt-quality source of truth: caller contract, deployment modules, tier calibration, and type-specific rules. Apply the agent contract for tool-using/stateful prompts and the plugin contract for embedded skill/plugin prompts. Preserve current-source checks against OpenAI, Anthropic, Perplexity/Sonar, and MCP prompt-template docs before claiming a prompt pattern is current.

## Step 0 — Gather Context

Before routing, make sure you have enough to work with.

For **design** work, confirm:
- what product or system the harness serves
- what actions the agent will take
- who the users are
- any known constraints (solo maintenance, existing stack, timeline, local/on-device, hardware limits)

For **evaluation** work, inspect the harness itself:
- read the codebase, agent config, skills, hooks, architecture docs
- if evidence is missing, ask for the narrowest missing input and keep moving
- do not evaluate from vibes alone

If the request is vague ("help me build an agent" or "is my harness any good"), ask one or two clarifying questions. Do not stall the conversation with an interview — get enough to pick a mode and start.

## Step 0.5 — Prompt Builder Companion

When the deliverable includes a system prompt, skill prompt, plugin instructions, tool-use prompt, eval judge, or prompt template:

- Use the local Prompt Builder repo as the reusable prompt policy engine when available: `~/dev/git-folder/prompt-builder/skills/prompt-builder/`.
- Read `references/caller-contract.md` for machine-callable output, `references/deployment-modules.md` for `agent` and `plugin` deployments, and `references/type-rules.md` for agent/tooling, RAG, evaluation, and data-pipeline prompts.
- Include a prompt contract in generated outputs that names model tier, deployment, output consumer, risk level, state schema, tool registry, transition rules, termination, failure handling, examples, and validation checks.
- For plugin or skill generation, require trigger conditions, context-loading rules, input schema, action spec, output schema, edge cases, examples, and validation.
- For source-grounded or web-search prompts, apply Perplexity/Sonar-style rules: use accessible sources, state when information is unavailable, and rely on search/API result metadata for source URLs rather than asking the model to invent them.
- For OpenAI reasoning models, keep instructions direct, use delimiters or section labels, specify success criteria, and avoid unnecessary chain-of-thought prompts.
- For Anthropic/Claude prompts, define success criteria and evals first, then tune with explicit output formats, examples, XML-style structure, role boundaries, and literal scope instructions.

## Step 1 — Classify The Request

Choose one mode before reading reference files.

### `design`
User is creating a new harness, planning a major rebuild, or asking for architecture, MVP shape, or implementation sequencing.

Default reads: `references/catalog/01-architecture-taxonomy.md`, `references/catalog/02-harness-components.md`, `references/catalog/03-frameworks.md`, `references/templates/design-deliverable.md`. Add `references/catalog/06-local-and-open-source-models.md` when the target is a local/OSS model. Add `references/methodology/13-agentic-product-dev-synthesis.md` when the agent's job is to produce a buildable spec for a downstream coding agent.

### `evaluation`
User has a harness and wants gaps, risks, missing primitives, UX upgrades, or architectural cleanup.

Default reads: `references/catalog/02-harness-components.md`, `references/catalog/05-lab-patterns.md`, `references/templates/evaluation-deliverable.md`. Add `references/methodology/12-agentic-systems-handoff-addendum.md` when handoff, autonomy, tool-permission, MCP/A2A, or operations-readiness details matter.

### `design + evaluation`
User wants a target architecture and a way to verify it, compare it with an existing system, or define acceptance criteria before building.

Default reads: union of the two above.

### `catalog-lookup`
User is asking a factual question about what exists — "which framework", "how does Anthropic's orchestrator work", "what memory substrate", "what's the adoption rate of Type III", "best local model tool-calling stack". Route straight to the catalog. Do **not** dump methodology files for this mode.

Default reads: only the catalog file(s) relevant to the question. Cite the exact file and section. Surface trade-offs.

## Step 2 — Classify The Product Shape

Pick the closest shape and state the assumption if ambiguous:

| Shape | Maps to Catalog Type |
|---|---|
| chat assistant | Type I (Augmented Assistant) |
| workflow orchestrator | Type II (Workflow Automaton) or Type III (Orchestrated Team) |
| code agent | Type III (Claude Code / Devin / Cursor patterns) |
| internal copilot | Type I or Type II |
| embedded AI product feature | Type I or Type II |
| hybrid system | Type III+ |

If the target runs on a local/open-source model regardless of shape, also read `references/catalog/06-local-and-open-source-models.md`.

## Step 3 — Read The Smallest Useful Reference Set

Read only the files the request actually needs. This file is the index — do not rely on reference-to-reference chains.

### Research Synthesis (how to decide for buildable agent outputs)
- `references/methodology/12-agentic-systems-handoff-addendum.md` — Perplexity-derived methodology for agentic-system handoffs: autonomy boundaries, tool permission tiers (T0–T5), orchestration topology, memory taxonomy, the 14-file handoff folder, MCP/A2A guidance, OWASP/NIST safety taxonomy.
- `references/methodology/13-agentic-product-dev-synthesis.md` — cross-source synthesis (Perplexity v2 + ChatGPT) for **product-development agent systems**: workflow-first principle, triage + specialists + reviewers default architecture, role-card pattern, canonical A0–A4 autonomy ladder (Perplexity v2 + ChatGPT; Perplexity v1's A0–A5 retained as a more granular variant), ask-before policy, confidence scoring, agent-system-specific eval gates (spec lint, traceability, scorecard). Read this when the agent's job is to produce a buildable spec for a downstream coding agent.

### Catalog (what exists)
- `references/catalog/01-architecture-taxonomy.md` — Type I–V classification, adoption rates, 4 debates (single-vs-multi, frameworks-vs-raw, scaffolding-vs-minimal, augment-vs-automate), 10 verified stats, coordination patterns, architecture timeline.
- `references/catalog/02-harness-components.md` — six-component harness model (prompt / tools / memory / context / error / observability) and its mapping to generated agent, skill, plugin, prompt, and evaluation artifacts.
- `references/catalog/03-frameworks.md` — LangGraph, CrewAI, Pydantic AI, smolagents, DSPy, AutoGen, Bedrock AgentCore. Decision tree for framework selection.
- `references/catalog/04-memory-substrates.md` — filesystem-as-memory, vector DB, in-context, COALA framework, Claude Code memory tiers, Voyager skill library, DSPy optimization formats, self-improvement patterns (MCTS, OPRO, PromptBreeder, Gödel Agent).
- `references/catalog/05-lab-patterns.md` — production architecture patterns from Anthropic, OpenAI, Perplexity, LangChain DeepAgents, Manus, Google ADK, Microsoft AutoGen/Copilot, Meta Llama Stack, DeepSeek, Cohere, Devin, xAI Grok, Cursor, Windsurf.
- `references/catalog/06-local-and-open-source-models.md` — constraints and patterns for agents on local/open-source models (Ollama, llama.cpp, vLLM, Llama, Qwen, DeepSeek, Mistral, Phi, Gemma). Tool-call reliability tiers, framework fit for local deployment, failure modes, decision tree by hardware, three non-obvious insights for local agents.

### Templates (output shapes)
- `references/templates/design-deliverable.md` — use when producing a design output.
- `references/templates/evaluation-deliverable.md` — use when producing an evaluation output.
- `references/templates/agentic-handoff/` — 15 reusable schemas for product-development agent systems: role cards, handoff envelopes, agent output contracts, artifact versioning, tool contracts (with T0–T5 permission tiers), guardrails, assumption logs, traceability matrix, agent manifest, evaluation scorecard, spec-lint checklist, agent ADRs, human checkpoints, system boundaries, and flow topologies. Index at `references/templates/agentic-handoff/README.md`. Use alongside `methodology/13-agentic-product-dev-synthesis.md`.

### Examples (calibration)
- `examples/design-solo-pr-review-agent.md` — worked design deliverable for a solo-maintainer PR review agent.
- `examples/evaluation-research-orchestrator.md` — worked evaluation deliverable for a Type III research orchestrator with 9 specialists.

## Operating Rules

- Convert vague ambitions into concrete harness primitives.
- Push back on unnecessary complexity.
- Treat workflow state, permissions, context assembly, and evaluation as first-class architecture, not cleanup tasks.
- Separate universal harness primitives from product-specific manifestation.
- For evaluation requests, present findings first and improvement sequence second.
- For design requests, include how the design will be tested before calling it done.
- When recommending a framework, memory substrate, or multi-agent pattern, **cite the catalog file** you pulled it from.

## Output Contract

### For `design`
- recommended harness shape
- core primitives and subsystem boundaries
- MVP boundary
- phased implementation plan
- verification and acceptance criteria

### For `evaluation`
- findings ordered by severity or leverage
- missing or weak primitives
- user experience and operational gaps
- prioritized upgrade path
- tests or checks that confirm the fixes

### For `design + evaluation`
- target architecture
- comparison against current or likely failure modes
- implementation phases
- acceptance criteria
- evaluation plan covering regressions, safety, and UX

### For `catalog-lookup`
- direct answer to the factual question
- trade-offs relative to alternatives in the same catalog file
- source citation (`catalog/NN-filename.md § Section`)
- one-line pointer to the methodology file that operationalizes the choice, if applicable

## Final Check Before Responding

- Did you keep the design lean enough for a solo developer unless the request clearly demanded more?
- Did you avoid recommending multi-agent coordination by default?
- Did you include evaluation, not just construction?
- Did you give the user an operational path forward instead of abstract theory?
- If you recommended multi-agent, a framework, or a memory substrate, did you cite the catalog file you pulled it from?
- If the target is a local/open-source model, did you apply the stricter posture from `catalog/06-local-and-open-source-models.md` (single-agent always, cull tools, compaction mandatory, evals non-optional)?
