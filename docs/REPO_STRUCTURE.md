# Repo Structure

## Bottom Line

Launch this repo from the root with `npm run dev`. That starts Agent Builder
Studio at `http://localhost:3030`, backed by `apps/agent-studio`.

The repo is a monorepo, not a single Next.js app at the root. The confusion
comes from the consolidation history: `agent-builder` and `agent-studio` used
to be separate repos, then were merged here with side products and shared
packages.

## What Is Primary

`apps/agent-studio` is the primary app.

It owns the product loop:

```text
design graph -> run graph -> inspect run -> export package
```

It depends on shared packages:

- `@tyroneross/agent-spec` for the spec contract.
- `@tyroneross/agent-pack` for package generation.
- `@tyroneross/agent-artifacts` for staging and promotion.
- `@tyroneross/local-llm` for local-first model calls.

## What Is Legacy Or Adjacent

`apps/agent-builder` is no longer the primary UI. Its page is a signpost to
Studio, but the directory still contains useful legacy tooling:

- plugin companion content
- agent structures
- DoE scripts
- sandbox tests
- artifact-generation scripts
- historical docs

`apps/meetings`, `apps/investments`, and `apps/cos` are side apps extracted
from the old Builder workbench. They should stay launchable, but they should
not define the root product identity.

`apps/chief-of-staff` is the older standalone Node Chief of Staff app. It is
retained for compatibility while `apps/cos` represents the extracted Next.js
surface.

## Launch Map

| Task | Command | URL |
|---|---|---|
| Launch the product | `npm run dev` | `http://localhost:3030` |
| Launch Studio explicitly | `npm run dev:studio` | `http://localhost:3030` |
| View the retired Builder signpost | `npm run dev:builder-signpost` | `http://localhost:3028` |
| Launch Meetings | `npm run dev:meetings` | `http://localhost:3032` |
| Launch Investments | `npm run dev:investments` | `http://localhost:3033` |
| Launch extracted Chief of Staff | `npm run dev:cos` | `http://localhost:3034` |
| Launch legacy Chief of Staff | `npm run dev:chief-of-staff` | `http://localhost:3031` |

## Clean-Sheet Design

If this repo were built from scratch, it would be organized around one
canonical app and package engines:

```text
agent-builder-studio/
  apps/
    studio/             # ideal future name for the primary app
    meetings/
    investments/
    cos/
    builder-tools/      # ideal future home for non-UI Builder tooling
  packages/
    agent-spec/
    agent-pack/
    agent-artifacts/
    local-llm/
  docs/
  archive/
```

The current safe equivalent is:

```text
apps/agent-studio       -> future apps/studio
apps/agent-builder      -> future apps/builder-tools or packages/plugin-companion
```

Do not do that rename opportunistically. It should be a dedicated migration
with CI updates and route/package reference checks.

## Remaining Cleanup Plan

1. Move non-UI Builder tooling out of `apps/agent-builder` into either
   `packages/` or a clearly named `apps/builder-tools` workspace.
2. Decide whether `apps/chief-of-staff` is still needed after `apps/cos` is
   validated. If not, archive it with a README pointer.
3. Rename `apps/agent-studio` to `apps/studio` only after package names, CI,
   docs, and app references are updated in the same change.
4. Move historical Builder docs that are not active product docs under
   `archive/` or a dedicated legacy docs folder.
5. Keep root scripts as the stable entrypoint so Finder users do not need to
   infer launch targets from nested folders.
