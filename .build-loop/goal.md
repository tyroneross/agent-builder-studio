# Modular Chief of Staff Architecture Goal

Date: 2026-04-30

## Goal

Refactor the standalone Chief of Staff app into a modular long-term
architecture that can grow from an MVP daily planner into a reliable local CoS
operating system.

The architecture should assume:

- The codebase will become much larger.
- Future local and hosted models will have larger context windows and stronger
  tool-use ability.
- The app must remain safe on a work laptop.
- Cloud, internet, system permissions, deletes, and overwrite behavior must
  remain explicit and gated.

## Design Principles

- Keep `src/` as the top-level app source directory.
- Split by responsibility, not by file type.
- Keep domain logic independent from HTTP routes and UI.
- Treat model providers, calendars, OS integrations, and future cloud services
  as adapters.
- Treat rituals as durable workflows with inputs, schema, prompt, fallback,
  rendering, and future checkpointing.
- Treat tools as deterministic capabilities with permission metadata.
- Keep local-first storage and audit behavior in core modules.

## Scoring Criteria

| Criterion | Grading Method | Pass Condition | Evidence |
| --- | --- | --- | --- |
| Modularity | Static tests + architecture scan | Server entrypoint is thin; route handlers, rituals, core, tools, and integrations are separated | Boundary tests and NavGator summary |
| Functionality preservation | Test suite | Existing daily plan, approvals, workspace, Ollama model discovery, and ICS behavior still work | `npm test` |
| Safety preservation | Tests + static scan | Localhost-only network policy, workspace path policy, no production deletes, no overwrites outside CoS document rules | Tests and source scan |
| Future scalability | Docs + module contracts | Architecture doc defines layers, dependencies, extension points, model evolution assumptions | `docs/architecture.md` |
| Build health | Syntax/build checks | Server and browser scripts pass syntax checks | `npm run build` |

## Non-Goals

- Implement direct Apple Calendar, Gmail, Outlook, or Slack integration.
- Add database dependencies.
- Add framework dependencies.
- Implement live destructive actions.
