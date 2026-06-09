# @tyroneross/local-llm

Local-first LLM client for the agent-platform monorepo. One uniform `chat()`
envelope across **mlx → ollama → groq → anthropic → openai**, plus a cascade
engine with parse-retry and per-tier routing.

Replaces three duplicated clients (agent-builder providers, agent-studio inline
Ollama, chief-of-staff Ollama client).

## Local-first posture

- **MLX-first local lane.** `mlx_lm.server` (OpenAI-compatible, default
  `http://127.0.0.1:8080`) is the local PRIMARY. Ollama is the local FALLBACK.
- **Lane-drop = the local mirror of cloud key-gating.** A local lane is dropped
  when its server is unhealthy (`probeMlx` / `probeOllama` → `localHealth` flag),
  exactly as a cloud lane is dropped when its API key is absent.
- **Cascade order** (`allowCloud: "on-failure"`, default):
  `local-mlx → local-ollama → cloud (key-gated)`.
- **Local guard.** mlx/ollama URLs are asserted localhost-only.

## Per-tier model table

| Tier | MLX (HuggingFace mlx-community) | Ollama tag |
|---|---|---|
| parse | `mlx-community/Llama-3.2-3B-Instruct-4bit` | `llama3.2:3b` (fb `qwen3:8b-q4_K_M`) |
| mid | `mlx-community/Qwen2.5-3B-Instruct-4bit` | `qwen3:8b-q4_K_M` |
| synthesis | configurable (`LOCAL_MLX_SYNTHESIS_MODEL`; 128GB headroom) | `gemma4:26b` |

MLX ids verified against HuggingFace; Ollama tags verified against the live
daemon. The synthesis-tier MLX id defaults to the verified Qwen2.5-3B and is
overridable per the 128GB unified-memory headroom. Env overrides:
`LOCAL_MLX_{PARSE,MID,SYNTHESIS}_MODEL`, `LOCAL_MLX_URL`, `OLLAMA_BASE_URL`,
`COS_ALLOW_CLOUD`.

## Quick use

```js
import { chat, resolveCascade, cascadePolicy, runCascade, probeMlx } from "@tyroneross/local-llm";

const { healthy } = await probeMlx();
const policy = cascadePolicy({ allowCloud: "on-failure" });
const cascade = resolveCascade("intake", policy, null, process.env, { mlx: healthy, ollama: true });
const { envelope, step } = await runCascade({ node: { key: "intake" }, cascade, system, userMsg, jsonSchema });
```

`runCascade` accepts injectable `recordTelemetry` and `onEvent` callbacks so a
host (e.g. chief-of-staff) keeps its own JSONL telemetry + UI events while the
package stays domain-free.

## Verified (this machine, M4 Max / 128GB)

- Live `chat()` against `mlx_lm.server` succeeded end-to-end.
- Lane-drop verified: MLX down → cascade dropped the mlx lane → Ollama won.
- Cloud key-gating verified: only `GROQ_API_KEY` present → anthropic/openai
  lanes dropped, groq retained.
