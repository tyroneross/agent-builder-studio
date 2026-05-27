# Agent Builder Plugin Companion

This directory is the standalone plugin companion for the Agent Builder app.

Use the full app/workbench when you need the Next.js visual builder, reusable generated structures, investment dashboard, package export, install checks, sandbox runs, or DOE tooling. Use this plugin companion when you only need Agent Builder's design/evaluation method inside Claude, Codex, or another reusable-skill host.

## Package Boundary

`plugin/` is copyable as a unit. It must remain independent of app-root files.

Included:

- `SKILL.md` — canonical cross-LLM skill entrypoint.
- `.claude-plugin/plugin.json` — Claude Code plugin manifest.
- `.codex-plugin/plugin.json` — Codex plugin manifest.
- `metadata.json` — host-neutral companion metadata.
- `examples/` — worked design/evaluation examples.
- `references/` — catalog, methodology, and output templates.

Not included:

- Next.js app files under `app/`.
- Generator/runtime code under `lib/`.
- Sandbox, DOE, scans, and artifact scripts.
- Generated agents, generated outputs, local telemetry, or `.env` files.
- Node dependencies or build artifacts.

## Install

As a standalone user skill:

```bash
mkdir -p ~/.claude/skills/agent-builder
rsync -a SKILL.md references examples ~/.claude/skills/agent-builder/
```

As a host plugin, point the host at this `plugin/` directory. The Claude and Codex manifests both load the same `SKILL.md`, so the companion has one canonical instruction source.

Inside another plugin, copy this directory into that plugin's `skills/agent-builder/` folder.

## Maintenance Contract

- Keep this package small and text-first.
- Do not import app-root files from `SKILL.md` or references.
- Keep Claude and Codex manifests version-aligned.
- Update this README when the companion gains a new required file or host surface.
- Use the app repository for heavy workflows: visual builder, generated packages, tests, local model experiments, and dashboards.
