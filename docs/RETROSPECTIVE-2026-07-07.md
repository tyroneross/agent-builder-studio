# Retrospective — Modular Tools, Launcher Hardening, Git Ingestion, Dashboard

Date: 2026-07-07 · Repo: `agent-builder-studio` · Scope: 26 commits `f298fd2..67cc227` · Lead: Claude (Opus) · Coders: Codex · Judgment/audit: Fable

## Headline

A modular-tool system shipped end-to-end — manifest contract → registry → dashboard → enforced launcher → remote git ingestion → UI redesign — driven by a **plan (Fable) → code (Codex) → audit (Fable) → verify+commit (lead)** loop. The audit layer earned its cost twice: it caught a **shipped unauthenticated RCE** and a **second RCE in git ingestion** before they hardened into problems. The main process failure was letting the first RCE reach `main` before an audit ran.

## What shipped

- **Modular tools v1** (C0–C8): `packages/tool-spec` (zero-dep manifest validator) · Studio tool registry + `/api/tools/*` · `/dashboard` · 3 first-party manifests (meetings/investments/cos) · legacy triage doc.
- **Launcher** (v2-launch-spawn, H1–H4): spawn/stop tools as child processes; `enforced` permission mode + devCommand binary allowlist; one-time launch confirmation; pid-identity kill guard; deduplicated origin guard.
- **Git ingestion**: clone + register remote tools, with forced-enforced mode, internal-IP SSRF blocking, and bounded clone.
- **Extraction**: DoE engine + sandbox stack → `packages/builder-tools`.
- **Dashboard redesign**: progressive disclosure, three-line hierarchy, readable env definition-list.
- **Finished the user's in-flight work**: research-evidence agent-pack feature + canvas-governance UX.

## What worked (keep doing)

1. **Adversarial audit as a gate, not a formality.** Fable audits found a P0 RCE on `main` and an RCE in git ingestion — both invisible to green tests. The audit→fix→**re-audit** loop (independent second pass confirming closure) is the reason the launcher is trustworthy.
2. **MECE fan-out to Codex.** Parallel Codex coders on disjoint file sets (tool-spec / routes / UI / agent-builder) with a **frozen interface** declared pre-fanout let H2∥H3 compose cleanly with no seam bug.
3. **Rally claims did their job.** The before-write gate blocked Codex on files the lead still claimed — forcing real deconfliction instead of silent clobbering. Selective staging (never `git add -A`) kept unrelated in-flight work out of every commit.
4. **Evidence over instruction.** The `v2-cos-archival` item said "archive chief-of-staff," but the triage evidence said cos doesn't cover it — surfaced and reframed instead of executing a destructive, wrong action. User confirmed.

## What went wrong (system levers)

| Failure | Root cause | Lever (applied / proposed) |
|---------|-----------|----------------------------|
| **RCE shipped to `main`** before any audit (register had no allowlist + `shell:true` spawn) | Audit ran *after* the feature landed, not before | **Applied:** now audit security-surface features *before* commit. **Proposed:** any commit touching spawn/exec/network-fetch/path-from-user triggers a mandatory pre-commit security audit. |
| **Security tests were orphaned** — passed by hand, never run by `npm test` | New test files weren't wired into the workspace test script | **Applied:** wired into `test:studio`; **lesson:** a new test file isn't "covered" until the repo's own entrypoint runs it. Grep the test script, don't assume the glob. |
| **Capabilities rendered as run-together text** for the whole life of the dashboard | `<style jsx>` scopes only elements in the component's *own* JSX — child components (Pills/IoList) never got the class | **Lesson:** styled-jsx + child sub-components = silent style loss. Use `<style jsx global>` (namespaced classes) or keep styled markup in the same component. |
| **Extraction push blocked** by an unrelated failing test | In-flight earnings work had a stale golden-set test in a shared workspace; pre-push tests the working tree | **Lesson:** uncommitted work with a failing test gates *everyone's* pushes to that workspace. Finish or revert in-flight work before it entangles. |
| **`rm -rf archive/` deleted a pre-existing tracked file** during a revert | Over-broad delete on a dir that already existed in the repo | **Lesson:** when reverting agent-created moves, restore via `git checkout`/`git clean` targeted at the *new* paths — never `rm -rf` a dir without checking it's not pre-existing. |

## Durable lessons (generalize beyond this repo)

- **Audit before the security-surface commit, not after.** Green tests don't see missing authz, `shell:true`, or a missing allowlist — an adversarial reader does.
- **A new test file gates nothing until the repo's test entrypoint runs it.** Verify the wiring.
- **styled-jsx doesn't cross component boundaries** — child-component classes need global scope or co-located markup.
- **In-flight uncommitted work is a shared-workspace liability** — a stale failing test blocks unrelated pushes.
- **Reframe a backlog item when the evidence contradicts it** — don't execute a destructive instruction that the repo's own analysis refutes.

## Metrics

26 commits · 0 P0/P1 open · 4 Fable audits (2 found RCEs, both fixed + re-audit-confirmed) · 6 Codex coding tasks · security tests now gate CI · dashboard verified by headless-Chrome screenshots.
