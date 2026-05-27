# Example Output — Evaluation Deliverable

> **Mode:** `evaluation`
> **Input prompt:** *"Here's my research orchestrator at `./my-research-agent/` — single orchestrator delegating to 9 specialist subagents, memory stored in JSONL thread logs plus a topic memory store, LangSmith tracing optional. Find the gaps. Tell me what to fix first."*
>
> This file is a **worked example** of the evaluation output shape for a Type III orchestrated team. Use it to calibrate your own evaluation deliverables. Produced by following `references/templates/evaluation-deliverable.md`.

---

## 1. Summary

The harness under review is a Type III orchestrated agent team (single orchestrator + 9 fixed specialist subagents) built on an Agent SDK with MCP tool distribution. Memory architecture is the strongest primitive — dual-layer (thread context + cross-run topic memory) with file-locked JSONL append-only writes and an LLM-compressed fallback for bloat. Tool descriptions are engineered prose, not ad-hoc, and read-only tools are cached to dedupe calls.

The weakest primitive is the evaluation loop: there's a single-run report critic that scores outputs against a threshold, plus a post-run after-action analyst, but **no golden-task eval suite, no replay tests, no per-specialist accuracy tracking.** For a system with 9 specialists running in a loop, this is the highest-leverage gap — Chip Huyen's compound error math (95% step accuracy → 0.6% over 100 steps, see `catalog/01-architecture-taxonomy.md § Key Statistics`) guarantees silent regressions will accumulate.

The design is salvageable as-is. Recommended fixes are additive, not architectural.

## 2. Findings (ordered by leverage)

### Finding 1 — No agentic evaluation harness [High]
**Evidence**: `./testing.py` (120 LOC) contains only unit/integration probes for individual components. No file matches `golden*`, `eval*`, or `replay*`. The report-critic (`./critic.py`) runs on a single output per session with a 4.0/5.0 threshold; it is not a regression harness.
**Why it matters**: With 9 specialists and typical sessions running 30–80 tool calls, small per-step accuracy drops compound into large end-to-end failures that never get caught by a single-run threshold. Model swaps and prompt tweaks will silently regress over time.
**Root cause**: Evaluation primitive (`catalog/02-harness-components.md § Observability` + `references/templates/evaluation-deliverable.md`) is missing.

### Finding 2 — Permission mode is global and coarse [High]
**Evidence**: `agent.py: permission_mode="acceptEdits"` appears 4 times across the orchestrator and specialists. No trust tiers. No per-tool gating. All 13 custom tools fire freely once in the allowlist. Destructive tools (`write_report`, `record_memory`, `delete_thread`) sit in the same tier as read-only tools (`fetch_pdf`, `web_search`).
**Why it matters**: When a specialist hallucinates a tool call with bad arguments, there's nothing to stop it. Fine for a solo research tool writing to your own filesystem; risky if this ever runs against shared infrastructure or writes to shared state.
**Root cause**: Permission primitive (`catalog/02-harness-components.md § Tool Definitions`) is missing the ladder.

### Finding 3 — No explicit context compaction threshold [Medium]
**Evidence**: `agent.py: build_scaffold()` injects memory at system prompt start (good — high-attention zone), but there is no 92%-capacity compaction heuristic, no message-pruning policy, and no summary checkpoint. Runs are bounded only by a `max_turns` budget.
**Why it matters**: Long research sessions will hit the context window and silently truncate mid-turn, losing recent findings. The max_turns budget prevents runaway cost but does not prevent quality collapse.
**Root cause**: Context assembly (`catalog/02-harness-components.md § 4 Context Window Management`, `catalog/01 § Architecture Taxonomy → "compaction at 92% capacity"`).

### Finding 4 — Observability is opt-in and unlabeled [Medium]
**Evidence**: `tracing.py` wires LangSmith behind `LANGSMITH_TRACING=true`, disabled by default. No token/cost tracking. No per-run JSON metadata file. Stdout streaming and a `progress.md` are the only default audit trail.
**Why it matters**: Most runs produce no auditable trace. When something goes wrong there is no retrospective diagnosis path beyond re-reading `progress.md`. For a 9-specialist orchestration that's dangerously thin.
**Root cause**: Observability primitive (`catalog/02-harness-components.md § Observability`).

### Finding 5 — Error policy is "fail fast, don't retry blindly" — stated, not mechanized [Low]
**Evidence**: `CLAUDE.md` states the principle but there is no circuit breaker, no bounded-retry wrapper, and no graceful-degradation path when a specialist fails repeatedly. Tools return error blocks and the orchestrator decides — which puts decision quality on the model, not on the harness.
**Why it matters**: Pathological loops (same specialist called 5× returning errors 5×) will burn budget silently. The state of the art for this is a drift-detector-as-control-plane pattern (see `catalog/06-local-and-open-source-models.md § Non-obvious insights`).
**Root cause**: Error-handling primitive (`catalog/02-harness-components.md § Error Handling`).

## 3. Missing or Weak Primitives

| Primitive | State | Notes |
|---|---|---|
| Capability registry | adequate | 13 custom tools, engineered descriptions, caching on reads |
| Permission layer | **missing** | `acceptEdits` globally, no tiers |
| Approval gates | **missing** | No human-in-loop |
| Workflow state | adequate | Per-thread directory, file locking, idempotent writes |
| Resumability | adequate | Thread ID restores context on restart |
| Context assembly | **weak** | No compaction threshold |
| Memory provenance | adequate | Categories on observations (source, finding, process, agent) |
| Evaluation loop | **missing** | Single-run critic only, no golden tasks |
| Observability | **weak** | LangSmith opt-in, no cost tracking |

## 4. UX & Operational Gaps

- No stop-reason surfacing — sessions end with "done" or a crash; the user cannot tell *why*
- No cost/latency warning when a session crosses thresholds
- `progress.md` is an append-only narrative, not a structured trace — hard to diff across runs
- No per-specialist latency / token breakdown

## 5. Prioritized Upgrade Path

1. **Add golden-task eval suite** [S effort, high impact] — 10 canonical queries with expected citation counts, key facts, and a minimum specialist-invocation set. Run on every commit. Closes Finding 1. **Test:** `make eval` on the golden set in CI; failure = commit rejected.

2. **Promote LangSmith + add cost tracking to default-on** [S effort, medium impact] — flip `LANGSMITH_TRACING` default, add `runs/<id>/metadata.json` with tokens, cost, duration, stop reason. Closes Finding 4. **Test:** after one run, confirm `runs/<id>/metadata.json` exists and contains the 4 fields.

3. **Add compaction at 90% window capacity** [M effort, medium impact] — hook into message-list length, summarize oldest 30% into a checkpoint, replace with summary in context. Closes Finding 3. **Test:** run a long session with an artificially small context window; assert that summarization fires at least once and that post-compaction responses still reference the compacted content correctly.

4. **Introduce 2 trust tiers for tools** [M effort, medium impact] — `read` (free) vs `write` (requires confirmation or explicit grant). No UI change needed; just a config map from tool name to tier. Closes Finding 2. **Test:** attempt to invoke a `write` tool without the grant; assert rejection.

5. **Wire up a drift detector into control flow** [L effort, high impact on pathological runs] — track tool-monopoly, repeated errors, empty-results-ignored signals; when any crosses threshold, force a replan or short-circuit. Closes Finding 5. **Test:** inject a deliberately broken tool; assert the orchestrator aborts after ≤3 retries and records the reason.

Items 1 and 2 are the highest-leverage, lowest-effort pair. Do them first.

## 6. Confirmation Tests (grouped)

- **Eval golden-set run**: 10/10 pass before shipping; any regression < 20% drop on any query type
- **Cost metadata presence**: every run produces `metadata.json` with `tokens_in`, `tokens_out`, `cost_usd`, `stop_reason`
- **Compaction fires correctly**: synthetic long-run test confirms at least one compaction per session over N turns
- **Permission boundary**: unauthorized write-tier tool call fails closed
- **Drift short-circuit**: broken tool injection triggers abort within 3 retries

No fix ships without its confirmation test passing in CI.

## 7. Out Of Scope

- Multi-run cross-session memory (the topic memory store exists but retrieval quality was not evaluated)
- Web UI stop-reason display (present but superficial)
- The 30-line `context.md` rolling buffer heuristic — possibly tunable, not a finding
- Specialist prompt quality (out of scope for a harness evaluation; evals will surface it indirectly)

---

*Worked example · follows `templates/evaluation-deliverable.md` · produced by the `evaluation` mode of the `agent-builder` skill*
