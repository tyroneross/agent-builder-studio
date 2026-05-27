# Local & Open-Source Model Agents — Constraints, Patterns, Evidence

> Empirical catalog · RossLabs.ai research corpus · April 2026
> Parent skill: `agent-builder` · Sibling: `03-frameworks.md`, `04-memory-substrates.md`, `05-lab-patterns.md`

**Read this when** the user is building an agent on a locally-hosted, open-source, self-hosted, or on-device model — Ollama, llama.cpp, vLLM, LM Studio, Llama 3/4, Mistral, Qwen, DeepSeek, Phi, Gemma, or any other non-frontier hosted model. Also read when constraints include air-gapped operation, data residency, cost minimization through self-hosting, or strict latency bounds that rule out hosted APIs.

---

## Why This File Exists

The methodology side of this skill is model-agnostic — the primitives (permissions, state, context, eval) apply whether you're on Claude Opus, GPT-5, or Qwen 2.5 on a laptop. But the **feasible design space** shifts dramatically when you leave frontier hosted models for local/open-source. Context windows are smaller. Tool calling is less reliable. Step accuracy is lower, which makes compound error hit harder. Model swaps are more frequent. Hardware is the constraint, not API quota.

This file captures the deltas so the default posture can adapt without rewriting the methodology.

---

## The Core Constraint Shift

| Dimension | Frontier hosted (Claude / GPT / Gemini) | Local / open-source (typical) |
|---|---|---|
| Context window | 200K–2M tokens | **4K–32K baseline**, 128K ceiling for current strong OSS models |
| Tool calling reliability | 95%+ schema compliance | **40%–95%** depending on model size and training |
| Step accuracy | ~97% per step | **~85%–93% per step** on complex multi-step tasks |
| Compound error (100 steps) | 0.97¹⁰⁰ ≈ 5% final accuracy | 0.90¹⁰⁰ ≈ **0.003%** final accuracy |
| Structured output | Native (tool calls, JSON mode) | Requires grammar constraints (llama.cpp GBNF, Outlines, Instructor) or prompt discipline |
| Per-token cost | $1–$75 per 1M tokens | Hardware amortization only |
| Model swap cadence | 3–12 months | **1–3 months** (rapid OSS release cycle) |
| Latency (typical) | 200ms–5s | Determined by hardware; often faster if small model on good GPU |
| Airgap / data residency | No (hosted) | **Yes** — this is often the reason to go local |

**Biggest implication**: Chip Huyen's compound error math (95% per step → 0.6% over 100 steps) is already the dominant failure mode on frontier models. On local models it becomes catastrophic. **Shortening the loop matters exponentially more.** Fewer turns, tighter tool sets, more aggressive termination — all mandatory, not optional.

---

## Adjusted Default Posture

The skill's default posture (bias lean, start single-agent, require evals) applies *more strictly*, not less, when the model is local:

1. **Start single-agent, always.** Multi-agent on local models is a failure multiplier — 4×/15× token cost is irrelevant when tokens are "free" on your hardware, but the 70%+ MAST systemic failure rate compounds with weaker per-step accuracy. Don't.
2. **Cull tools aggressively.** The Vercel "removed 80% of tools → fewer steps, better results" pattern (see `01-architecture-taxonomy.md § 4 Active Debates`) is foundational here, not optional. A local 7B model with 20 tools will hallucinate tool calls. The same model with 5 tools will succeed.
3. **Compaction is non-negotiable.** 4K–32K windows fill within 3–10 tool calls. Token-aware trimming, filesystem-as-memory, and summary checkpoints are baseline requirements.
4. **Eval loops become load-bearing infrastructure.** With lower step accuracy, silent regressions are the norm. Golden tasks, replay tests, and per-profile benchmarks are not "nice to have" — they're the only way to detect quality drift when you swap the underlying model.
5. **Plan for model swap every 1–3 months.** Treat the model as a hot-swappable component. Keep prompts, tool descriptions, and eval suites in version control. Never couple harness logic to model-specific quirks.

---

## Tool Calling Reliability Spectrum (April 2026)

Empirical reliability of open-source models on structured tool calling, based on community benchmarks (BFCL, ToolBench) and production reports:

| Tier | Models | Reliability | Notes |
|---|---|---|---|
| **Strong** | Llama 3.3 70B, Qwen 2.5 72B, DeepSeek V3.2, Mistral Large 2 | 90%+ | Can be treated like a weaker frontier model. Native tool calling works. |
| **Usable** | Llama 3.1 8B/70B, Qwen 2.5 7B/14B, Mistral Small 3 | 75%–90% | Native tool calling works for small tool sets (≤10). Degrades quickly past that. |
| **Constrained output required** | Llama 3.2 1B/3B, Gemma 2 9B, Phi-3/4 | 50%–75% | Use Outlines, llama.cpp GBNF grammars, or Instructor to force schema. Never rely on free-form tool calling. |
| **Experimental** | Sub-3B models, older OSS, fine-tunes without tool-call training | <50% | Use only for routing/classification, not for agentic tool loops. |

**Key principle**: match the tool count to the tier. A Tier 2 model can handle 5 tools reliably; give it 20 and it will invent tools or choose poorly. See `05-lab-patterns.md § Anthropic` and the Vercel 80% reduction case.

---

## Framework Fit For Local Models

Mapping `03-frameworks.md` to local-model deployment:

| Framework | Local fit | Notes |
|---|---|---|
| **LangChain-Ollama / DeepAgents** | ★★★★★ | Designed for local. Thread context rebuild, drift detection (see local-smartz pattern), profile-aware tool culling. Best starting point for Type I / Type II local agents. |
| **LangGraph** | ★★★★ | Works with any LLM via LangChain integrations. Checkpoint store and cycle support matter more on local models because you'll restart more often. |
| **Pydantic AI** | ★★★★ | Type-safe tool calls pair well with Outlines/Instructor for weaker models. FSM-based execution keeps turn count predictable. |
| **smolagents** | ★★★★ | **Underrated for local.** Code-as-action means the model generates Python, not JSON tool calls — lower token cost per step (huge on small context windows), better control flow expressivity. Pairs well with 7B–14B models. Security: sandbox with E2B or Docker. |
| **DSPy** | ★★★ | Auto-optimization works but optimization runs themselves cost local compute. MIPROv2/GEPA can rewrite prompts to the specific model's quirks, which is useful when swapping models frequently. |
| **Raw llama.cpp / Ollama API + custom loop** | ★★★ | Maximum control, minimum abstraction. Appropriate when your agent needs tight latency or the framework abstractions become load-bearing bugs at 4K context. |
| **CrewAI / AutoGen** | ★★ | Built assuming frontier-model reliability. Role-based multi-agent patterns fail ungracefully on sub-frontier models. Possible but not recommended. |
| **Bedrock AgentCore** | ✗ | AWS-hosted, not local. Excluded. |

---

## Memory Substrates For Local Models

From `04-memory-substrates.md`, adjusted for local constraints:

- **Filesystem-as-memory** (Claude Code / Manus / Cursor pattern): this is the dominant substrate for local agents. File paths are durable pointers that survive context truncation — critical when your window is 4K. See `04-memory-substrates.md § Filesystem-as-Memory`.
- **Vector DB** (ChromaDB, LanceDB, Qdrant): runs locally, fits well. Embed descriptions, not source. Retrieval quality is bounded by the embedding model; `BGE-base-en-v1.5` and `Nomic Embed` are strong local choices.
- **In-context append-only** (Reflexion pattern): only viable for Ω=1–3 reflections on a 4K window. Don't expect more.
- **Thread context rebuild** (local-smartz pattern): keep recent N entries full + older entries as one-liners in a regenerated summary file. Simple, effective, matches the window budget.
- **Avoid**: giant unbounded conversation history, naive RAG over raw chunks, episodic memory without summarization.

---

## Open-Source-Specific Lab Patterns

From `05-lab-patterns.md`, the lab patterns that translate cleanly to local deployment:

- **Meta Llama Stack** — standardized open-source API stack (Inference → Safety → Tool Exec → Memory → Agentic API). Enables building Types I–IV on an open foundation. Cite this when the user wants a vendor-neutral base.
- **DeepSeek V3.2** — reasoning integrated into tool use at the model level (not the orchestration layer). Strong Tier-1 choice when step accuracy matters. Particularly good for code agents.
- **smolagents (Hugging Face)** — code-as-action dodges the JSON-tool-calling brittleness that hurts smaller models. Best for Tier 2–3 models.
- **Manus logit masking** — restricts available tools at the logit level per state. Works with any model that exposes logit bias. Removes the "20 tools → hallucinated tool" problem without retraining. This is an underused technique for local agents.
- **Cursor shadow workspace** — hidden parallel environment where the agent tests its own code before presenting. Applies to any code agent regardless of model; especially valuable locally because you can't afford a second frontier-model pass for critique.

---

## Evaluation For Local Agents

Evals aren't optional here — they're the primary feedback loop for model swaps.

Minimum viable eval suite for a local agent:
1. **10–20 golden tasks** covering the happy-path cases the agent must always handle
2. **5–10 failure-mode probes**: tool monopoly, empty result ignored, hallucinated tool, infinite loop, context overflow
3. **Per-profile runs** (if using lite/full profile pattern): eval each profile independently, don't assume lite is a subset of full
4. **Model-swap regression**: the same eval suite against the old and new model on the same day; diff the pass rates
5. **Per-tool accuracy tracking**: some models call some tools reliably and others not — surface this per-tool, not as an aggregate

Use `references/templates/evaluation-deliverable.md` plus the generated `evals/` files for the evaluation loop. This file just emphasizes: **skip it at your peril.**

---

## Common Failure Modes (and their fixes)

| Failure | Root cause | Fix |
|---|---|---|
| Agent hallucinates a tool | Too many tools, weak model | Cull to ≤5 per state (see Manus logit masking) |
| Silent context truncation | 4K window, no compaction | Token-aware trimming at ~80% threshold + filesystem-as-memory for overflow |
| Loop after tool failure | No self-monitoring | Drift detector → control plane (promote signals from logging to replan trigger; see the local-smartz evaluation pattern) |
| Tool args malformed | Native tool calling unreliable | Outlines / Instructor / llama.cpp grammar-constrained generation |
| Model swap broke everything | No eval regression | Golden task suite + per-model snapshot comparison |
| Runs take forever | Wrong model for task | Route small/cheap tasks to 7B, escalate only when needed |
| OOM or slow on hardware | Context too big, model too big | Quantize (Q4/Q5_K_M), reduce context budget, or downshift model |

---

## Decision Tree — Picking A Local Stack

```
Start here: Are you building a local agent?
│
├─ What's the task horizon?
│  ├─ Single turn / chat Q&A → Ollama + LangChain-Ollama + 1 tool registry
│  ├─ Multi-step research (minutes) → DeepAgents on Ollama, Tier 2+ model, ≤8 tools
│  └─ Long horizon (hours+) → Don't. Or use frontier model.
│
├─ What's the hardware?
│  ├─ Laptop (M-series / modest GPU) → 7B–14B model, Q4 quant, 4K–8K context
│  ├─ Workstation (24–48GB VRAM) → 14B–70B model, Q5 quant, 8K–32K context
│  └─ Server (80GB+ VRAM) → 70B+ model, FP16, 32K+ context — treat like a slow frontier model
│
├─ What's the structured output reliability need?
│  ├─ Strict schemas (tool calls must parse) → Outlines / Instructor / llama.cpp grammars
│  ├─ Loose (free-form with validation) → Native tool calling + validator + retry
│  └─ Code actions → smolagents (generates Python, skip the JSON-tool-call problem)
│
└─ Operator/data constraints?
   ├─ Air-gapped → vLLM or llama.cpp, no external deps, bundled model weights
   ├─ Data residency only (can call out for non-sensitive) → Ollama + cloud for light tasks
   └─ Cost minimization → Lean framework (raw Ollama API + your own loop)
```

---

## Three Non-Obvious Insights For Local Agents

1. **Filesystem-as-memory is not just a substrate, it's the recovery mechanism.** When a local model truncates context mid-turn, the filesystem is where your agent "remembers what it was doing." Design every long-running local agent around a `todo.md` + `context.md` pattern. See Manus + local-smartz thread rebuild.

2. **Eval suites are the only reliable signal during a model swap.** When you upgrade from Llama 3.1 to 3.3, *everything shifts quietly*. Tool call format changes, hallucination patterns change, instruction following changes. Without a regression suite you won't notice the shift until production breaks. This is the single highest-leverage investment for anyone running production local agents.

3. **The drift-detector-as-control-plane pattern is underused.** Most local-agent frameworks (including DeepAgents) ship with partial observability — logging tool monopoly, empty results ignored, retry loops — but stop at *emitting the events*. Promote those signals from stderr logging to *control flow triggers* (force a replan, cull a tool, short-circuit to summary) and you unlock 20–50% token savings on pathological runs at essentially zero implementation cost. See the local-smartz evaluation example.

---

*Catalog file 06/06 · local and open-source model guidance · April 2026*
