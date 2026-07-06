# Standalone Tool Strategy — Independent Verification & Comparison

Date: 2026-07-06 · Repo: `agent-builder-studio` · Author: `claude_code:1ad7c71b` (Opus)
North-star: [`docs/STANDALONE_TOOL_STRATEGY.md`](./STANDALONE_TOOL_STRATEGY.md)
Verifies: [`.build-loop/research/modular-tools-assessment.md`](../.build-loop/research/modular-tools-assessment.md) (Phase-1) · [`.build-loop/plans/modular-tools-plan.md`](../.build-loop/plans/modular-tools-plan.md) (Phase-2)

## Purpose

A second agent independently assessed the same strategy doc and repo. This memo records the comparison. It is **not** a competing assessment — the referenced Phase-1 artifact is deeper (LOC counts, port verification, bug discovery) and stands as the assessment of record. This memo confirms convergence, records an independent verdict on the 5 open decisions, and adds three net-new findings.

## Convergence (two independent reads agree → high confidence)

1. The manifest / registry / adapter layer is **100% greenfield** — zero `agent-tool|tool-registry|toolManifest` hits outside the strategy doc.
2. `npm run dev → agent-studio:3030` — acceptance criterion #1 already met.
3. Migration is **additive** — zero cross-app implementation imports (criterion #5 already met).
4. Correct posture is **adapter-contract-before-repo-split**: prove the manifest+adapter in-monorepo, consume first-party tools through the same contract as third-party, split repos later. Packaging/ingestion modes are loader details behind the boundary.
5. All 5 open decisions resolve identically in both reads (below).

## The 5 decisions — independent verdict: concur on all 5

| # | Decision | Resolved call | Verdict |
|---|----------|---------------|---------|
| 1 | Embed vs separate app | Separate app; Studio = status board, no spawn in v1 | **Concur** — zero iframe/proxy cost; matches how the Next apps already run. |
| 2 | Sandbox vs trusted | Trusted local; permissions as pre-launch **disclosure** | **Concur** (see F2) — schema carries `permissions.mode`, so v2 enforcement is a value change, not a schema break. This resolves the "settle sandbox before ingestion" concern cleanly. |
| 3 | Install vs register-only | Register-only local paths | **Concur** — no install machinery exists; matches doc step 6. |
| 4 | `apps/` vs `tools/` | Keep `apps/` | **Concur** — `entry.workspace` decouples identity from location; a move is pure churn. |
| 5 | Manifest home | New `packages/tool-spec` | **Concur** — the subpath-export alternative was argued and rejected (coupling two independently-versioned contracts). Sound. |

**Two independent assessments reaching the same 5 calls is the strongest available signal these are right. No decision conflict.**

## Net-new findings (add to the plan)

**F1 — the dirty tree is not this build's work (commit-hygiene, affects C0).**
The 22 uncommitted paths are not one undifferentiated triage set. `.ibr/builds/earnings-call-research/`, `packages/agent-pack/test/earnings-research-pattern.test.mjs`, and the `agent-pack` `generator.js` / `patterns.js` / `canvas-seeds.mjs` edits are residue from an unrelated **earnings-research** build. C0 should **attribute-and-isolate** — land that residue as its own commit (or hand it back to its author), not bundle it under "modular tools." ✅ verified via `git status --short` + `.ibr/builds/` provenance.

**F2 — disclosure permissions must be labeled unverified in the UI (affects C6).**
`permissions.mode: "disclosure"` + deferred enforcement is correct, but the dashboard card showing permissions "before launch" must read *"declared by the tool — not enforced by Studio."* Otherwise disclosure reads as a guarantee it isn't (no-mock-security rule). One-line copy constraint, not a design change.

**F3 — gate C0 on `rally owners --dirty` (coordination).**
At assessment time `rally owners --dirty` = 0 claimed / 22 unclaimed, so C0 is currently collision-free — but the dirty set is unclaimed *and* uncommitted (no Rally lock). C0's acceptance should re-run `rally owners --dirty` immediately before any commit so a late peer edit isn't clobbered.

## Sequencing recommendation (checkpoint, not a correctness objection)

Land a provable vertical slice first — **C0 → C1 (tool-spec) → C2 → C3 (meetings manifest)** — and confirm the contract validates a real tool before committing to C5/C6 (the dashboard is the largest surface and adds nothing until the contract is proven). The existing dependency graph already permits this ordering.

## Status

Assess/plan only — no code, no commits from this session. Execution of the modular-tools plan remains the other terminal's lane. Findings F1–F3 posted to the Rally room (artifact + risk) for merge on its next read.
