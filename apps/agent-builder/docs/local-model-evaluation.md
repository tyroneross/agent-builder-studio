# Local Model Evaluation: Chief of Staff Agent

> Generated 2026-04-27. Run artifacts under `runs/`. Source links at the bottom.

## Bottom line

Two local models were tested as the runtime for the Chief of Staff agent. **`gpt-oss:20b` produced a complete, parseable weekly operating brief in roughly two minutes and is the recommended default.** **`gemma4:26b` is not viable for this agent's structured-JSON workflow** today because of confirmed Ollama issues with grammar-constrained generation on the Gemma 4 family. Several other locally-available models are strong candidates but were not run in this round.

## What was tested

| Model | Variant | Size | Active params | Context | Tested | Status |
|---|---|---|---|---|---|---|
| `gpt-oss:20b` | MoE, instruct | 13.8 GB | 3.6B | 128K | ✅ Yes | ✅ Pass, all 6 nodes parsed clean |
| `gemma4:26b` | MoE, instruct (a4b-it Q4_K_M) | 18 GB | 3.8B | 256K | ✅ Yes | ❌ Fail, degenerate JSON loop |
| `qwen3:8b-q4_K_M` | Dense, instruct | 5.2 GB | 8.2B | 128K | ⚠️ Partial | 4 of 6 nodes parsed before timeout in earlier non-streaming run |

## What was NOT tested (and why)

| Model | Reason skipped |
|---|---|
| `qwen2.5-coder:32b-instruct-q5_K_M` | Have it locally, did not run yet. Strong candidate for the daily driver based on coder-instruct training. |
| `gpt-oss:120b` | 65 GB on disk, likely too heavy for interactive use on this hardware. |
| `llama3.2:3b` | Locally available. Likely undersized for multi-step planning. |
| `tinyllama:latest` | 0.6 GB toy model. Used only as fixture fallback in the harness. |
| `phi-4:14b`, `mistral-small:24b`, `deepseek-r1:14b`, `nous-hermes3:*`, `granite3.1-dense:8b` | Not yet pulled. Recommended as the next batch to evaluate. |

The published benchmarks below are reported from each vendor's model card or technical report. They reflect each model's published scores, not numbers measured in this evaluation. Where the published number is for a different variant (different quant, different reasoning level, different chat-template), this is called out.

## How it was tested

### Harness

The agent runs as a six-node sequential graph implemented in `scripts/run-chief-of-staff.mjs`. Each node calls Ollama's `/api/chat` endpoint with the same model, a per-node system prompt scoped to one skill, and the same user-provided weekly schedule input.

Nodes, in order:

1. **Context intake.** Apply the `schedule-intake` skill. Separate fixed from flexible events, label each by type, compute baseline metrics, list missing-data items.
2. **Priority triage.** Pick three weekly outcomes with the highest leverage. Reject low-yield commitments.
3. **Time architect.** Apply the `100x-productivity-planning` skill. Produce 5–9 protected blocks for the week.
4. **Decision prep.** 1–3 decision log entries with options, recommendation, and status.
5. **Follow-up planner.** Owner / action / due-date items. Surface missing owners.
6. **Operating risk check.** Severity-tagged risks and unverified claims.

### Inputs

Both runs used the same fixture:

- **Schedule input:** `agent-outputs/hypothetical-local-agent-suite/final/chief-of-staff-agent/schedule-optimizer/input-schedule.json` (2.2 KB, 25 weekly events, week of 2026-04-27)
- **Goal:** `"Become 100x more productive by spending more time on high-leverage strengths and less time manually coordinating low-leverage work."`
- **Skill files** loaded per-node from `agent-skills/chief-of-staff/`

### Ollama call settings

- Endpoint: `/api/chat` with `stream: true`
- `format: "json"` (grammar-constrained JSON)
- `temperature: 0.1`, `num_ctx: 8192`
- Per-call client timeout: 600s–1200s
- Warmup ping before the first node call
- Streaming response accumulator parses ndjson chunks

### What the harness measures

For each node call the harness records:

- `durationMs` (wall clock)
- `bytes` (length of accumulated message content)
- `parsed` (boolean: did the assembled string parse as JSON)
- `raw` (full response, kept for forensic review)

### How results were scored

This was a **functional pass/fail evaluation**, not a graded benchmark. Scoring criteria, in priority order:

1. **Did every node return valid JSON matching its schema?** (Hard pass/fail.)
2. **Did the resulting weekly brief read coherently** when assembled by the harness into `weekly-operating-brief.md`? (Manual judgment.)
3. **Total wall-clock time** for the six-node run.

No automated quality scoring was applied. No multi-seed runs. No comparison to a ground-truth plan. This is a "does it work at all" gate, not a head-to-head intelligence benchmark.

## Per-model results

### `gpt-oss:20b` ✅

**Observed**

| Node | Duration | Parsed | Bytes |
|---|---|---|---|
| Context intake | 21.8 s | ✅ | 2,167 |
| Priority triage | 17.2 s | ✅ | 831 |
| Time architect | 36.9 s | ✅ | 1,393 |
| Decision prep | 12.7 s | ✅ | 598 |
| Follow-up planner | 18.8 s | ✅ | 1,183 |
| Operating risk check | 12.4 s | ✅ | 873 |
| **Total** | **2 min** | **6/6 ✅** | 7,045 |

The assembled weekly brief identified three plausible top-leverage outcomes, produced nine time blocks across the week, and surfaced four operating risks ranked low to high. Every node returned a valid JSON object. Output at `runs/2026-04-27T23-16-34-861Z/gpt-oss-20b/weekly-operating-brief.md`.

**Published benchmarks** (from the OpenAI model card, reported at the "high" reasoning level)

- MMLU: 85.3
- GPQA Diamond: 71.5
- AIME 2025: 98.7
- HumanEval and MMLU: stated to match or exceed OpenAI o3-mini despite the size difference

**Architecture**

- Mixture of Experts. ~21B total / ~3.6B active per token. 128K context. Apache 2.0.

**Strengths observed in this test**

- Reliable JSON output under Ollama's `format: json` grammar
- Fast on this hardware (about 2 min for six chained calls)
- Holds context across the six nodes without contradictions
- Verbose by design, which helped the planning steps fill all required fields

**Weaknesses (published and observed)**

- The model is documented as "somewhat verbose" by Artificial Analysis; in this run it produced ~7 KB of useful text but could be steered toward larger outputs that would slow planning.
- Knowledge cutoff May 2024 per the published spec.
- Text-only modality. No vision, no audio.

### `gemma4:26b` ❌

**Observed**

| Run | Result |
|---|---|
| Run 1 (non-streaming chat, original LocalLLM) | 5 of 6 nodes returned `fetch failed`. One node returned 447 bytes, unparsed. |
| Run 2 (streaming chat, retry) | Context-intake node ran 19.7 minutes, returned 205 KB of output, never parsed. The output began as schema-shaped text and degenerated into the token sequence `post_post_post...` repeating until cutoff. |

**Why it failed**

This is not a hardware or harness issue. It matches three documented Ollama bugs against the Gemma 4 family:

- **Repetition collapse under JSON grammar.** A constrained-JSON free-text field collapses into a single repeated token that fills the rest of the budget, leaving the JSON unterminated. Reported on Gemma 4 dense 31B as the exact failure mode in [ollama#15502]. This run shows the same behavior on the 26B MoE.
- **Empty response on long system prompts.** Gemma 4 26B MoE returns a completely empty body when the system prompt exceeds about 500 characters, per [ollama#15428]. The first run hit this regime; switching to streaming surfaced the loop bug instead of the empty-body bug.
- **`format=` constraint silently ignored when `think=false`.** Documented in [ollama#15260]. Default Ollama behavior depends on the chat template.

**Published benchmarks** (from the Ollama library page and Google's Gemma 4 announcement)

- MMLU Pro: 82.6
- AIME 2026: 88.3
- LiveCodeBench: 77.1
- Codeforces ELO: 1718
- Arena AI text leaderboard: #6 open model

**Architecture**

- Mixture of Experts. 25.2B total / 3.8B active per token. 8 of 128 experts plus 1 shared. 256K context. Apache 2.0. Multimodal: text and image.

**Recommended sampling per the model card**: temperature 1.0, top-p 0.95, top-k 64. This run used temperature 0.1, which may have aggravated the loop bug (low-temperature MoE generation under grammar constraint can pin the logits on a single repeated token). Worth retrying once the upstream Ollama bugs are resolved or with a non-constrained JSON-by-prompt approach.

**Strengths to use it for elsewhere**

These come from the published spec, not from this run.

- 256K context window for very long inputs
- Native multimodal: image and text in the same call
- 140+ language support, broader than Llama, Qwen, or gpt-oss
- Strong AIME / LiveCodeBench scores suggesting capable reasoning when not bottlenecked by grammar enforcement

**Weaknesses confirmed in this run**

- Not usable today as the JSON-output backbone of an agent on Ollama.
- Long structured prompts trigger an empty-body or token-loop pathology.
- Recommendations to lower temperature for stability conflict with the model card's recommended 1.0.

### `qwen3:8b-q4_K_M` ⚠️

**Observed**

In an earlier run with the non-streaming endpoint, intake / triage / time-architect / decision-prep returned valid JSON before the follow-up node hit the 5-min undici header timeout. This was a transport bug in the harness, not a model bug. The streaming refactor is expected to remove the failure, but a full re-run was not done.

**Architecture**

- Dense 8B. 128K context (Qwen3 family). Has a thinking-mode toggle.

**Why it stays on the candidate list**

- Smaller and faster than gpt-oss:20b
- Qwen instruct training is among the strongest at structured output in this size class
- Already pulled locally

## Untested but recommended

The following are likely-good fits for this agent based on each vendor's model card. **None were run in this evaluation**; treat the per-model claims below as inferred from public sources, not measured.

### `qwen2.5-coder:32b-instruct-q5_K_M`

Already pulled locally. Qwen 2.5 Coder Instruct is the strongest open code+structured-output model in its size class as of late 2024 / early 2025. Achieved 73.7 on Aider (comparable to GPT-4o) and 75.2 on MdEval (top open-source rank). Supports parallel function calling and JSON-schema responses.

Best fit: any agent step where strict JSON or tool-call discipline is the bottleneck.

### `phi-4:14b`

Microsoft 14B. Strong on math and reasoning, weaker on instruction-following: base model scores 63.0 on IFEval per the Phi-4 technical report. The newer Phi-4-reasoning and Phi-4-reasoning-plus variants close the IFEval gap (about +22 points to ~85).

Best fit: dense reasoning steps (priority triage, risk surfacing). Use a reasoning-tuned variant for instruction-following.

### `mistral-small:24b-instruct` (3.2 release)

Mistral Small 3.2 explicitly targets reduced infinite-generation, improved function calling, and improved structured-output. Reports >81% MMLU and 150 tokens/s latency. Vision-capable.

Best fit: a strong second runtime alongside gpt-oss:20b; the 3.2 release directly addresses the failure class that broke gemma4 here.

### `deepseek-r1:14b` or `:32b`

Reasoning-tuned distillations. Often produce stronger triage and risk analysis at the cost of verbose `<think>` blocks that need to be stripped before JSON parsing.

Best fit: priority triage and operating-risk nodes if quality of reasoning matters more than tokens-per-second. Requires a parser tweak to strip the think block.

### `nous-hermes3:*` and `granite3.1-dense:8b`

Hermes 3 and Granite 3 are agent-focused fine-tunes. Both publish strong tool-use and structured-output numbers. Worth a single round of testing if the daily driver above stops being enough.

## Recommended use-case mapping

| Use case | First choice | Why |
|---|---|---|
| Daily Chief of Staff (this agent) | `gpt-oss:20b` ✅ | Only model verified end-to-end on this graph |
| Strict-JSON / tool-call steps | `qwen2.5-coder:32b-instruct-q5_K_M` ⚠️ untested but recommended | Strongest published structured-output discipline of the locally available models |
| Long-document summarization (context > 100K) | `gemma4:26b` 256K context ⚠️ untested for this | Use without `format: json` grammar; prompt for JSON instead |
| Image input (calendar photo, whiteboard, slide) | `gemma4:26b` ⚠️ untested for this | Only multimodal local model in this set |
| Multilingual drafting | `gemma4:26b` ⚠️ untested | 140+ language coverage |
| Reasoning-heavy decision support | `deepseek-r1:14b` or `phi-4-reasoning:14b` ⚠️ untested locally | Reasoning training raises triage/risk quality |
| Fast iteration / dev loop | `qwen3:8b-q4_K_M` ⚠️ partial test only | Fast, instruct-strong, already pulled |

## Caveats and unknowns

- This evaluation tested **two models on one input fixture in one harness configuration**. None of the per-node failures or successes are statistically meaningful.
- Published benchmark numbers are vendor self-reports unless otherwise noted. They reflect best-case reasoning levels and chat templates that may differ from Ollama's defaults.
- The Ollama `format: json` grammar enforcement path is implemented via llama.cpp grammar sampling. Failures observed against gemma4:26b are upstream issues, not model-quality statements about Gemma 4 generally.
- Quantization differences (Q4_K_M, Q5_K_M, MXFP4) materially affect output quality; numbers cited from FP16 evaluations will not match Q4 runs exactly.
- No multilingual, vision, or long-context cases were exercised. Strengths attributed to those modalities are inferred from public sources.

## Next experiments worth running

1. Re-run `gemma4:26b` without `format: json`, asking for JSON via prompt only. Confirms whether the failure is grammar-only or training.
2. Run `qwen2.5-coder:32b-instruct-q5_K_M` against the same fixture as `gpt-oss:20b`. Direct head-to-head.
3. Pull and run `mistral-small:24b-instruct-3.2` against the same fixture. Targeted at the failure class hit here.
4. Use the new quality scorecard emitted by `npm run cos:run -- --json`; it grades completeness, owner coverage, decision clarity, schedule realism, and risk surface.
5. Use deterministic multi-seed runs on the daily driver to characterize variance:

```bash
npm run cos:run -- --model qwen3:8b-q4_K_M --seed-count=3 --json
```

For full structure validation, use the resumable runner:

```bash
npm run agent:validate:local -- --llm=ollama --model tinyllama:latest --chunk-size=2 --state runs/local-validation/tinyllama/state.json
```

## Appendix A: Sample output from `gpt-oss:20b`

This is the weekly operating brief produced verbatim by the passing run. Full artifacts at `runs/2026-04-27T23-16-34-861Z/gpt-oss-20b/`.

```
Model: gpt-oss:20b (ollama)
Generated: 2026-04-27T23:16:39.618Z

Top 3 leverage outcomes
1. Complete Research Synthesis — owner: Self · due 2026-04-30
   Leverages deep work and connecting research to implementation, reducing open-loop accumulation.
2. Finalize Design Direction — owner: Self · due 2026-04-30
   Utilizes creative system design and high-context review, providing strategic clarity
   and reducing coordination overhead.
3. Implement Local Model Experiments — owner: Self · due 2026-04-30
   Applies rapid product judgment and connects research to implementation, turning
   insights into deliverables and cutting manual follow-up.

Time blocks
- Monday    09:00-11:00 · strategy   — Agent builder review + Inbox & open loops
- Monday    13:00-14:00 · deep_work  — Research synthesis
- Tuesday   09:30-10:15 · coordination — Project triage
- Tuesday   11:00-12:00 · review     — Docs and artifact QA
- Wednesday 10:00-11:30 · strategy   — Design direction
- Wednesday 15:00-15:45 · admin      — Follow-ups
- Thursday  09:00-10:00 · deep_work  — Local model experiments
- Thursday  14:00-15:00 · review     — Implementation checkpoint
- Friday    10:00-11:00 · review     — Weekly review

Operating risks
- [high]   Missing owner assignment for scheduled events
           → Assign a clear owner to each event to ensure accountability and follow-up.
- [medium] Lack of protected blocks and recovery buffers
           → Introduce protected blocks around high-leverage work and add recovery buffers.
- [medium] Calendar fragmentation due to many non-fixed events
           → Consolidate non-fixed events into larger blocks or clusters.
- [low]    No explicit blocked decisions recorded
           → Document any decisions that are blocked or pending to improve transparency.
```

Reading notes:

- All three top outcomes share the same due date and owner. The model surfaced this implicitly but did not flag it as a risk; the harness's risk node would benefit from a duplicate-due-date check.
- Time blocks land cleanly inside the source schedule's working hours (08:45–17:30) without overwriting any event marked `fixed: true`.
- The first risk flagged ("missing owner assignment") is a real artifact of the input fixture, not a hallucination: the source schedule does not carry per-event owners.

## Appendix B: Failure trace from `gemma4:26b`

For reference, the first 200 characters and last 200 characters of the 205 KB unparseable output from the streaming retry. Full file at `runs/2026-04-27T23-16-34-861Z/gemma4-26b/intake.json`.

```
First 200 chars:
{"type":"object","weekOf":"2026-04-27","ownerGoal":"Become 100x more productive by
spending more time on high-leverage strengths and less time less than 100x more
productive by spending more time on high-

Last 200 chars:
st_post_post_post_post_post_post_post_post_post_post_post_post_post_post_post_post_
post_post_post_post_post_post_post_post_post_post_post_post_post_post_post_post_post_
post_post_post_post_post_post_post
```

The model began by echoing the JSON schema definition into the response (it emits `"type":"object"`, then the schema's property keys) before tokens collapsed onto `_post`. This is the documented behavior in [ollama#15502]: the JSON grammar permits any valid string token, so when the model's logit distribution degrades onto a single token, the grammar has no mechanism to reject it.

## Sources

- OpenAI. *Introducing gpt-oss.* <https://openai.com/index/introducing-gpt-oss/>
- OpenAI. *gpt-oss-120b & gpt-oss-20b Model Card.* <https://cdn.openai.com/pdf/419b6906-9da6-406c-a19d-1bb078ac7637/oai_gpt-oss_model_card.pdf>
- Artificial Analysis. *gpt-oss-20B (high) Intelligence, Performance & Price Analysis.* <https://artificialanalysis.ai/models/gpt-oss-20b>
- Google. *Gemma 4: Byte for byte, the most capable open models.* <https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/>
- Ollama Library. *gemma4:26b.* <https://ollama.com/library/gemma4:26b>
- ollama/ollama#15502. *gemma4:31b repetition loop during constrained JSON generation with free-text string fields.* <https://github.com/ollama/ollama/issues/15502>
- ollama/ollama#15428. *gemma4:26b (MoE) returns completely empty response on long system prompts.* <https://github.com/ollama/ollama/issues/15428>
- ollama/ollama#15260. *think=false breaks format (structured output) for gemma4.* <https://github.com/ollama/ollama/issues/15260>
- ollama/ollama#15595. *Gemma 4 json output is fenced with markdown backticks.* <https://github.com/ollama/ollama/issues/15595>
- Hui et al. *Qwen2.5-Coder Technical Report.* <https://arxiv.org/pdf/2409.12186>
- Qwen. *Qwen2.5-Coder-32B-Instruct model card.* <https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct>
- Qwen. *Function Calling docs.* <https://qwen.readthedocs.io/en/latest/framework/function_call.html>
- Microsoft. *Phi-4 Technical Report.* <https://www.microsoft.com/en-us/research/wp-content/uploads/2024/12/P4TechReport.pdf>
- Microsoft. *Phi-4-reasoning Technical Report.* <https://www.microsoft.com/en-us/research/wp-content/uploads/2025/04/phi_4_reasoning.pdf>
- Mistral AI. *Mistral Small 3 announcement.* <https://mistral.ai/news/mistral-small-3>
- Mistral AI. *Mistral-Small-24B-Instruct-2501 model card.* <https://huggingface.co/mistralai/Mistral-Small-24B-Instruct-2501>
- Ollama. *Structured Outputs capability docs.* <https://docs.ollama.com/capabilities/structured-outputs>
