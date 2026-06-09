# agent-builder-platform

Monorepo consolidating the agent design → run → package lifecycle.

| Path | Role |
|---|---|
| `apps/agent-builder` | Workbench: design, evaluate, package agent graphs |
| `apps/agent-studio` | Runtime canvas: run/test agent graphs live (SSE) |
| `apps/chief-of-staff` | Standalone shipped product |
| `packages/agent-spec` | Shared spec contract (schema, validate, roles) |
| `packages/local-llm` | Shared local-first LLM client (MLX-first, Ollama fallback, key-gated cloud) |

Local-first by default everywhere.
