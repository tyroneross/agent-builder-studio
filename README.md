# agent-builder

A comprehensive, modular skill for designing, evaluating, and improving agentic harnesses — the layer around the model that turns a language model into a product.

## Distribution model

Agent Builder has two distribution shapes:

- **RossLabs AI Toolkit marketplace plugin:** the slim skill/instruction package.
  Use this when you want Agent Builder to show up inside Claude/Codex as a
  lightweight design and evaluation skill.
- **This GitHub repo:** the full downloadable Agent Builder workbench. Use this
  when you want the local Next.js visual builder, generated agent structures,
  sandbox tests, DOE runs, example artifacts, and implementation tooling.

The marketplace plugin should stay small. The heavier app, artifact examples,
local DOE experiments, and generated outputs belong in this repo or in GitHub
release assets, not inside the RossLabs AI Toolkit package.

If you already installed the marketplace plugin, pulling this repo does not
automatically update that installed plugin. Reinstall or update the marketplace
package when the slim toolkit package changes. To get the full workbench, clone
or pull this repo directly:

```bash
git clone https://github.com/tyroneross/agent-builder.git
cd agent-builder
npm install
```

Existing checkout:

```bash
git checkout main
git pull --ff-only origin main
npm install
```

## Local visual builder

This repo now includes a local Next.js app for turning a simple flowchart into buildable agent files.

Run it:

```bash
npm install
npm run serve
```

Open `http://localhost:3028`.

First-version workflow:

1. Choose one of four common patterns: Solo Tool Agent, Approval Workflow, Research Orchestrator, or Evaluator Optimizer.
2. Drag and connect nodes on the flow canvas.
3. Edit node contracts: role, description, inputs, outputs, tools, and permission tier.
4. Pick a target runtime and framework recommendation.
5. Preview the generated YAML/JSON/files.
6. Click **Build Agent**.

The build route writes local artifacts under `generated/agents/<slug>/`:

- `agent.yaml`
- `manifest.json`
- `system-prompt.md`
- `prompts/prompt-builder-contract.md`
- `tools.json`
- `evals/golden-tasks.json`
- `evals/regression-scenarios.json`
- `memory/domain-playbook.md`
- `memory/learning-ledger.json`
- `README.md`
- `sources.md`

The build route is intentionally local-first and constrained: it does not accept arbitrary output paths, and generated artifacts are ignored by git.

Agent structure scan:

```bash
npm run agent:scan
npm run agent:scan -- --run --llm=fixture
npm run agent:scan -- --run --llm=ollama --model=tinyllama:latest
npm run agent:doe
npm run agents:artifacts:doe
```

The scan can run from the terminal or through the UI's **Agent structures** section. Current structures include Chief of Staff, PowerPoint Deck Builder, Writing, App Builder, Research Brief, Code Review, Earnings Webex Draft, and Data Analysis agents. The terminal scan reports graph shape, tool/eval counts, research-alignment checks, and optional sandbox e2e results.

Each structure now includes a prompt contract and an eval-gated domain-learning layer:

- `prompts/prompt-builder-contract.md` for Prompt Builder invocation, agent prompt requirements, skill/plugin prompt requirements, and current OpenAI/Anthropic/Perplexity/MCP prompting source links.
- `memory/domain-playbook.md` for accepted, rollback-aware lessons.
- `memory/learning-ledger.json` for scenario results, candidate lessons, and accepted lessons.
- `evals/regression-scenarios.json` for lesson regression checks.
- Four mock scenarios per agent for sandbox testing across normal, edge, and domain-specific cases.

The DOE runner (`npm run agent:doe`) runs a `2^3` full factorial test over artifact factors: acceptance criteria, permission invariants, and reflection prompts. The default generated artifacts keep all three because that setting produced the best sandbox score while preserving the test guard.

Nightly local DOE automation is currently contract-only. The actual runner is
held back and the `nightlyLocalDoe` feature flag is off by default, but the
read-only cross-repo scope, cautious local-model interpretation rules, and
morning packet shape are documented in
`docs/nightly-local-doe.md` and `references/templates/nightly-doe-contract.json`.

Sandbox runs default to `/tmp` to avoid macOS app-sandbox permission drift under `/var/folders`. Override with `AGENT_BUILDER_TMPDIR=/path/to/tmp` when needed.

See `docs/agent-optimization-report.md` for the optimization log, DOE findings, and test outputs.

Real artifact runs:

```bash
npm run agents:artifacts -- --doe --models qwen3:8b-q4_K_M,gemma4:26b,tinyllama:latest
```

This writes actual `.pptx`, `.docx`, `.xlsx`, `.csv`, `.pdf`, `.html`, `.json`, and `.md` outputs under `agent-outputs/hypothetical-local-agent-suite/`. See `docs/real-output-artifact-report.md`.

**Three bodies of knowledge, one skill:**

- **Research synthesis** — *how to decide for agent-builder outputs*. Product-development agent handoff guidance, autonomy boundaries, tool permission tiers, workflow topology, memory taxonomy, and artifact contracts. 2 Agent Builder-authored synthesis files.
- **Catalog** — *what exists*. Architecture taxonomy (Type I–V), six-component harness model, 7 framework deep dives (LangGraph / CrewAI / Pydantic AI / smolagents / DSPy / AutoGen / Bedrock), memory substrate inventory, 14 production lab patterns (Anthropic, OpenAI, Perplexity, Manus, Google, Devin, Cursor, Windsurf, and more), and dedicated guidance for agents built on local/open-source models (Ollama, llama.cpp, vLLM, Llama, Qwen, DeepSeek, Mistral). 6 catalog files.
- **Prompt contracts** — *how generated prompts stay reliable*. Generated agents include Prompt Builder contracts grounded in the local Prompt Builder repo plus current OpenAI, Anthropic, Perplexity/Sonar, and MCP prompt guidance.

Plus output templates and two fully worked examples. The single `plugin/SKILL.md` is cross-LLM — natural-language description triggers in Claude Code and other hosts; the `metadata` frontmatter block (priority, pathPatterns, importPatterns, bashPatterns, promptSignals) auto-activates on Codex.

## When it activates

Automatic triggers include requests to design or rebuild an agent/assistant/copilot, evaluate an existing harness, compare frameworks, pick a memory substrate, or diagnose symptoms like stale context, surprising tool calls, brittle sessions, missing approval controls, or costs drifting out of control. See the `description` field in `plugin/SKILL.md` for the full trigger list.

## Modes

1. `design` — new harness or major rebuild
2. `evaluation` — existing harness needs findings + upgrade path
3. `design + evaluation` — target architecture plus acceptance criteria
4. `catalog-lookup` — factual questions about what frameworks / substrates / patterns exist

## Structure

The repo holds two distinct products in one tree:

- **`plugin/`** — the slim cross-LLM skill. This is what ships via the RossLabs AI Toolkit marketplace. Stays small.
- Everything else at the repo root — the Next.js workbench app, generators, scripts, sandbox, generated artifacts. Cloned via `git clone`.

```
agent-builder/
├── plugin/                             # slim skill — marketplace package
│   ├── SKILL.md                        # entry, trigger, router (cross-LLM)
│   ├── .claude-plugin/plugin.json      # Claude Code manifest
│   ├── .codex-plugin/plugin.json       # Codex manifest
│   ├── examples/                       # 2 worked deliverables
│   └── references/
│       ├── methodology/                # Agent Builder synthesis/addenda
│       ├── catalog/                    # 6 files — what exists
│       └── templates/                  # output shapes + nightly DOE contract
├── README.md                           # this file
├── LICENSE                             # Apache-2.0
├── NOTICE                              # external reference attributions
├── metadata.json                       # skill catalog metadata
├── agents/openai.yaml                  # OpenAI-host UX wiring
│
├── app/                                # Next.js 16 visual builder (workbench)
├── lib/                                # generator, patterns, sources
├── agent-structures/                   # workbench: pattern definitions
├── agent-skills/                       # workbench: example generated skills
├── agent-outputs/                      # workbench: generated artifacts
├── sandbox/                            # workbench: sandbox harness
├── scripts/                            # workbench: scan, DOE, artifact runs
└── tests/                              # workbench: node test suite
```

### Cross-LLM activation

`plugin/SKILL.md` is a single file that triggers in any host:

- **Claude Code, Claude Desktop, Claude API** — match against the natural-language `description` field
- **Codex and compatible hosts** — match against the `metadata` frontmatter block (`pathPatterns`, `importPatterns`, `bashPatterns`, and `promptSignals` with `minScore: 6`). Hosts that don't read that block ignore it without harm.

No variant files; one canonical SKILL.md serves every host.

## Install

**Slim plugin via the RossLabs marketplace:**
```bash
/plugin marketplace add tyroneross/RossLabs-AI-Toolkit
/plugin install agent-builder@RossLabs-AI-Toolkit
```

This installs the lightweight skill from the toolkit. It does not install the
full local app, generated artifact suite, or DOE workbench from this repo.

**Full downloadable workbench from GitHub:**
```bash
git clone https://github.com/tyroneross/agent-builder.git
cd agent-builder
npm install
npm run serve
```

**As a standalone user skill** (any plugin host or bare Claude Code):
```bash
mkdir -p ~/.claude/skills/agent-builder
rsync -a plugin/SKILL.md plugin/references plugin/examples \
  ~/.claude/skills/agent-builder/
```

**Inside another plugin:** drop the contents of `plugin/` into that plugin's `skills/agent-builder/` directory.

## Design posture

The skill defaults to lean, solo-maintainable, single-agent architecture and requires empirical evidence (not vibes) before escalating to multi-agent. The catalog's verified stats — multi-agent costs 15× chat tokens, 70%+ of multi-agent failures are systemic, only 11% of orgs run production agents — are the anchor. When you push for complexity, the skill will ask for the constraint that justifies it.

## Attribution

- **External reference** — Agent Builder's design was informed by the [**`n-agentic-harnesses`**](https://github.com/NateBJones-Projects/OB1/tree/main/skills/n-agentic-harnesses) agent harness design skill authored by **Jonathan Edwards** (GitHub: [jonathanedwards](https://github.com/jonathanedwards)) and published in the OB1 repository owned by **Nate B Jones** ([NateBJones-Projects](https://github.com/NateBJones-Projects)). No source files from that project are bundled in this repository.
- **Catalog** (`plugin/references/catalog/`) — original research from the **RossLabs.ai agentic AI architectures corpus** (April 2026, 368 sources) authored by Tyrone Ross.
- **SKILL.md, synthesis files, templates, examples, app code, and README** — original compositions by Tyrone Ross / RossLabs.ai, with source links preserved for research traceability.

## Sources used for the catalog

Anthropic (Claude Code, multi-agent research system), OpenAI (Agents SDK, Deep Research), Perplexity, LangChain (DeepAgents, TerminalBench), Manus AI, Google (ADK, A2A protocol), Microsoft (AutoGen, Semantic Kernel, Copilot), Meta (Llama Stack), DeepSeek, Cohere, Cognition (Devin, Windsurf), Cursor, xAI, Deloitte 2025 Emerging Tech Trends, Gartner (June 2025), MAST arXiv, Stanford AI Index 2025, Chip Huyen's compound error analysis, Phil Schmid, Lance Martin, Karpathy, Andrew Ng, Harrison Chase, Lilian Weng, Voyager, Reflexion, Generative Agents, DSPy optimization, COALA framework, and others.

## License

Apache-2.0. See `NOTICE` for external reference attributions.

## Codex

The slim plugin ships parallel install surfaces for Claude Code and Codex from the same `plugin/SKILL.md`:

- `plugin/.claude-plugin/plugin.json` — Claude Code marketplace manifest
- `plugin/.codex-plugin/plugin.json` — Codex manifest

Package root for Codex installs: `plugin/` (point your Codex plugin install flow at this subdirectory). Both manifests reference the same `SKILL.md`, so Claude and Codex share a single skill definition with no drift.
