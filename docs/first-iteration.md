# Agent Builder First Iteration

## What The App Does

Agent Builder turns a visual flow into a buildable agent harness contract. The first version focuses on four common patterns:

- Solo Tool Agent
- Approval Workflow
- Research Orchestrator
- Evaluator Optimizer

The UI is a local Next.js app. Users choose a pattern, drag nodes, edit each node's role and contract, select a framework/runtime, preview generated artifacts, then click **Build Agent**.

## Inputs

- Agent name and description
- Pattern
- Runtime: local Next.js, local Python, hosted API, or hybrid
- Framework recommendation: custom loop, OpenAI Agents SDK, Claude subagents, DeepAgents, LangGraph, Pydantic AI, or NVIDIA NeMo Agent Toolkit
- Flow nodes and arrows
- Node inputs, outputs, tools, model tier, and permission policy

## Outputs

The build API writes files under `generated/agents/<slug>/`:

- `agent.yaml` — portable harness contract
- `manifest.json` — normalized graph, runtime, permissions, memory, evals, and source references
- `system-prompt.md` — starter system prompt from the graph
- `prompts/prompt-builder-contract.md` — Prompt Builder invocation, agent prompt requirements, skill/plugin prompt requirements, and prompt-source references
- `tools.json` — capability registry with permission tiers and input schemas
- `evals/golden-tasks.json` — first regression suite
- `README.md` — implementation runbook
- `sources.md` — official docs and framework references to check before implementation

## User Flow

1. Pick a pattern.
2. Adjust runtime and framework.
3. Drag nodes into the desired layout.
4. Select nodes and edit contracts.
5. Connect nodes with arrows.
6. Preview files.
7. Click **Build Agent**.
8. Implement the runtime adapter from the generated files.

## Upstream Dependencies

- Existing `agent-builder` methodology and catalog references.
- Official framework docs in the source registry.
- Next.js App Router for local app and build route.
- Browser pointer events for drag interactions.

## Downstream Dependencies

- Runtime adapters for specific frameworks.
- Evaluation runner that consumes `evals/golden-tasks.json`.
- Optional doc-refresh worker that updates the source registry.
- Optional hosted export mode that returns a ZIP or opens a pull request instead of writing local files.

## Security Boundary

The first build route only writes inside `generated/agents/<slug>`. It does not accept arbitrary output directories. Generated manifests keep credentials out of prompts and require explicit approval tiers for writes, shell execution, network actions, and production side effects.
