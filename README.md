# agent-builder-studio

One app for the agent **design → run → package** lifecycle: a visual canvas
(Studio) that authors a governed spec and runs it live, backed by a deterministic
packaging engine (Builder). Local-first by default everywhere.

**Architecture principle (from build-loop-memory's AI-first data architecture):**
the **agent spec is the single source of truth**; the canvas layout, run
transcripts, and the generated package are all **derived, rebuildable
projections**. Never make a derived layer the source of truth.

> **In-progress merge:** `agent-builder` and `agent-studio` are being collapsed
> into a single `apps/studio` app, with Builder's generation engine extracted to
> `packages/agent-pack`. Phased, with compile+test gates between phases. The
> table below reflects the current (mid-merge) state.

| Path | Role |
|---|---|
| `apps/agent-builder` | Workbench: design, evaluate, package agent graphs (Next.js, :3028) — being folded into Studio |
| `apps/agent-studio` | Runtime canvas: run/test agent graphs live with SSE (Next.js, :3030) — the host UI |
| `apps/chief-of-staff` | Standalone shipped product (Node HTTP server, :3031) — stays separate |
| `packages/agent-spec` | Shared spec contract (single source of truth): schema, validate, unified role enum, YAML, defaults |
| `packages/local-llm` | Shared local-first LLM client: MLX-first, Ollama fallback, key-gated cloud |

## One install builds + tests everything

```bash
npm install        # links all workspaces (packages + apps)
npm test           # deterministic suite: packages + agent-builder + chief-of-staff + studio roundtrip
npm run test:live  # adds studio test:self (needs a live Ollama server)
```

Per-app build/deploy stays independent:

```bash
npm run build --workspace agent-builder   # Next.js
npm run build --workspace agent-studio    # Next.js
npm run build --workspace chief-of-staff  # syntax check
```

## Local-first posture

- **MLX-first local lane** (`@tyroneross/local-llm`): `mlx_lm.server` (OpenAI-compatible,
  127.0.0.1:8080) is the local primary; Ollama is the fallback; cloud lanes
  (groq/anthropic/openai) are key-gated and consulted on-failure only.
- A local lane is dropped when its server is unhealthy — the local mirror of
  cloud key-gating.
- chief-of-staff retains its deterministic no-LLM fallback.

## Provenance

Consolidated 2026-06-09 from three standalone repos (agent-builder, agent-studio,
chief-of-staff) via `git subtree`, preserving each app's full history. The source
repos remain in place (with a pointer here) and hold pre-migration reversibility
bundles under their `archive/`. agent-builder's `plugin/` companion keeps its
strict no-import boundary (CI-enforced).
