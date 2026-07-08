# Agent Builder Studio

Agent Builder Studio is the local-first workspace for the agent design, run,
and package lifecycle. The canonical app is the Studio canvas at
`apps/agent-studio`; the old Builder UI is now a signpost and tooling host.

The agent spec is the single source of truth. Canvas state, run transcripts,
and generated packages are derived projections that can be rebuilt from the
spec.

## Launch

From the repo root:

```bash
npm install
npm run dev
```

Open `http://localhost:3030`.

Useful root commands:

| Command | Opens or runs | Port |
|---|---|---|
| `npm run dev` | Agent Builder Studio canvas | 3030 |
| `npm run dev:studio` | Same as `npm run dev` | 3030 |
| `npm run dev:builder-signpost` | Retired Builder UI signpost plus legacy tooling host | 3028 |
| `npm run dev:meetings` | Meetings analyzer side app | 3032 |
| `npm run dev:investments` | Investments review side app | 3033 |
| `npm run dev:cos` | Next.js Chief of Staff side app | 3034 |
| `npm run dev:chief-of-staff` | Legacy Node Chief of Staff server | 3031 |
| `npm test` | Deterministic package and app tests | n/a |

## Current Scaffold

| Path | Role |
|---|---|
| `apps/agent-studio` | Primary product. Next.js Studio canvas for designing, running, inspecting, and packaging agent graphs. |
| `apps/agent-builder` | Legacy Builder shell. The interactive UI is retired; this app remains for the signpost page, plugin companion, agent structures, DoE, sandbox, and artifact tooling. |
| `apps/meetings` | Extracted meetings analyzer side app. |
| `apps/investments` | Extracted investment review side app. |
| `apps/cos` | Extracted Next.js Chief of Staff side app. |
| `apps/chief-of-staff` | Older standalone Node Chief of Staff server retained for compatibility. |
| `packages/agent-spec` | Shared schema, validation, YAML, defaults, and role vocabulary. |
| `packages/agent-pack` | Deterministic spec-to-package engine used by Studio exports. |
| `packages/agent-artifacts` | Local artifact staging and promotion helpers. |
| `packages/local-llm` | Local-first LLM client: MLX primary, Ollama fallback, cloud key-gated on failure. |
| `docs/REPO_STRUCTURE.md` | Scaffold map, launch map, and cleanup plan. |
| `archive/` and app-local `archive/` folders | Reversibility bundles from the repo consolidation. |

## Clean-Sheet Target

If this were designed from scratch, the root would have one obvious product
entrypoint and supporting packages:

```text
agent-builder-studio/
  apps/
    agent-studio/       # canonical product app today
    meetings/           # side app
    investments/        # side app
    cos/                # side app
    agent-builder/      # legacy tooling/signpost until fully extracted
  packages/
    agent-spec/
    agent-pack/
    agent-artifacts/
    local-llm/
  docs/
    REPO_STRUCTURE.md
  archive/
```

The future cleanup can rename `apps/agent-studio` to `apps/studio`, but that
should be a dedicated migration because it touches workspace package names,
CI, docs, app URLs, and historical references. Until then, `apps/agent-studio`
is the authoritative launch target.

## Test And Build

```bash
npm test
npm run test:live        # includes live Studio self-test; requires local model server
npm run build:studio
npm run build:builder-signpost
npm run build:chief-of-staff
```

Per-app builds still work:

```bash
npm run build --workspace agent-studio
npm run build --workspace agent-builder
npm run build --workspace chief-of-staff
```

## Local-First Posture

- `@tyroneross/local-llm` uses MLX on `127.0.0.1:8080` as the local primary
  lane, Ollama on `localhost:11434` as the local fallback, and cloud lanes only
  when keys are present and local lanes fail.
- Studio stores project state in the browser and writes run artifacts to the
  selected local working folder.
- Chief of Staff retains deterministic no-LLM fallback behavior.

## Provenance

This repo was consolidated on 2026-06-09 from standalone `agent-builder`,
`agent-studio`, and `chief-of-staff` repos using subtree-style history
preservation. Reversibility bundles live under `archive/` and the app-local
`archive/` directories.
