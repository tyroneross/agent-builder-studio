# Action Items — Modular Tools + Launcher

Last updated: 2026-07-07 · Source: session that shipped modular-tools v1 → launcher-hardening → git ingestion → dashboard redesign (26 commits, `f298fd2..67cc227`). Mirrors the Rally backlog.

## Open — security residuals (from Fable audits)

| ID | Item | Priority | Notes |
|----|------|----------|-------|
| `sec-git-consent-ui` | Git-tool launch confirmation should state explicitly that it runs **untrusted cloned code** (informed consent). Optional: DNS-rebind resolve-check at register time. | Med | Re-audit flagged: confirmation shows the devCommand string, not that the code is untrusted. Code boundary is closed; this is UX honesty. |

*Closed this session: `sec-fix-rce` (P0 RCE), `sec-pid-identity`, `sec-origin-absent`, `sec-devcommand-binary` (subsumed by the enforced binary allowlist).*

## Open — v2 roadmap (deferred by design)

| ID | Item | Notes |
|----|------|-------|
| `v2-embed` | In-Studio embed of running tools (iframe/proxy) | v1 is launch-as-separate-app + status board. |
| `v2-ingestion-more` | Package (npm) + exported-bundle ingestion | Git-URL shipped; npm-package ingestion deferred (postinstall RCE surface — needs the same audit rigor). |
| `v2-agent-builder-extract-2` | Extract the remaining EXTRACT items from `apps/agent-builder` per `LEGACY_TRIAGE.md`: `lib/`, `agent-skills/shared/`, `plugin/`, and the higher-level CLIs (`run-agent-doe`, `run-local-validation`, `export-agent-package`, `run-plan`). | Increment 1 (DoE engine + sandbox stack → `packages/builder-tools`) shipped. |
| `v2-artifacts-adoption-meetings` | Route meetings outputs through `agent-artifacts` | Deferred: meetings has no durable output surface today (returns markdown over HTTP). Revisit if that changes. |
| `v2-agent-builder-archive` | Move ARCHIVE-classified `apps/agent-builder` items (generated output, `run-artifact-agents.py` monolith, `__pycache__`) out of the tree | Per `LEGACY_TRIAGE.md` Part 2. |

## Open — product / project

| ID | Item | Notes |
|----|------|-------|
| `cos-agent-roadmap` | `apps/chief-of-staff` is an **active agent to build over time** — NOT legacy. Its 5 unique surfaces (governance, vault, approvals, ICS import, daily-plan, interactive console) have no `cos` replacement. Roadmap TBD. | Reframed from "archival" per user directive. Do not strip it down. |
| `gap-readme-quickstart` | Tool-authoring quickstart (how to write an `agent-tool.json` + register a tool). | README was refreshed this session; confirm whether a dedicated authoring section is still wanted. |

## Coordination

- **Cross-agent model that worked:** Claude (lead) plans + verifies + commits; Codex codes on MECE lanes; Fable plans judgment layers + audits adversarially; Rally claims prevent collisions. Keep using it.

## Non-issues (logged so they aren't re-investigated)

- Dashboard "Copy 22px" IBR touch-target warning — a wrapper-`div` measurement artifact; buttons render correctly (`min-height` set). Verified via screenshot.
- DNS-rebind on git ingestion — documented accepted residual (local-only tool; literal-IP SSRF is blocked).
