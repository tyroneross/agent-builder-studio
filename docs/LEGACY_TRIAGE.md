# Legacy Triage — chief-of-staff vs cos · agent-builder tooling

Date: 2026-07-06 · Repo: `agent-builder-studio`
Delivers: **C7** of [`.build-loop/plans/modular-tools-plan.md`](../.build-loop/plans/modular-tools-plan.md) (legacy-triage lane) — resolves the ❓ "does `apps/cos` cover `apps/chief-of-staff`?" and inventories `apps/agent-builder` tooling for the eventual extraction (migration-plan steps 4 + 5). **Analysis only — no moves, no deletions.** Satisfies acceptance criterion #6 ("legacy Builder extracted / documented / archived") via documentation.
Author: `claude_code:1ad7c71b` under lead `claude_code:72cd0751`. ✅ Verified by two read-only explorers over both app trees; file paths cited throughout.

---

## Part 1 — `apps/chief-of-staff` (:3031, plain Node) vs `apps/cos` (:3034, Next.js)

**Verdict: cos does NOT fully cover chief-of-staff → keep chief-of-staff as a compatibility adapter, do not archive outright.** cos is a more advanced *weekly* multi-node role cascade with better model tiering; but it drops chief-of-staff's governance layer, ICS import, most of its REST surface, the daily-plan ritual, and the interactive console. Those five are the sole implementations and have no cos replacement.

### Coverage table

| chief-of-staff capability | Evidence (chief-of-staff) | cos equivalent | Status |
|---|---|---|---|
| `GET /api/health` | `src/server/routes/health.mjs` | — | **NOT** |
| `GET /api/models` (multi-provider + `recommendModel`) | `src/server/routes/models.mjs`, `src/integrations/model-providers/registry.mjs` | `GET /api/cos/models` (Ollama tags) + `/api/cos/env-status` | partial |
| `POST /api/vault/init`, `GET /api/vault/status` | `src/server/routes/vault.mjs`, `src/core/workspace/workspace.mjs` | — | **NOT** |
| approvals `GET/POST /api/approvals`, `/resolve` | `src/server/routes/approvals.mjs`, `src/core/approvals/approval-queue.mjs` | — | **NOT** |
| `POST /api/documents` | `src/server/routes/documents.mjs`, `src/core/workspace/documents.mjs` | — | **NOT** |
| `POST /api/calendar/import` (parse ICS) | `src/integrations/calendar/ics.mjs` (`parseIcsEvents`) | export only, no importer | **NOT** |
| `POST /api/calendar/export` (build ICS) | `src/integrations/calendar/ics.mjs` (`buildIcs`) | `buildApprovedCalendarIcs` (`lib/cos-calendar-export.mjs`) | covered |
| `POST /api/plan/daily` (daily-plan ritual) | `src/rituals/daily-plan/*`, `routes/plan.mjs` | `POST /api/cos/run` = **weekly** 6-node cascade (`lib/cos-runner.mjs`) | partial |
| `GET /api/rituals`, `GET /api/tools` (registries) | `src/server/routes/metadata.mjs`, `tools/registry.mjs`, `rituals/registry.mjs` | — | **NOT** |
| Rituals: weekly-review / meeting-prep / end-of-day (planned stubs) | `src/rituals/*/README.md` | cos is weekly-centric; meeting-prep/EOD absent | partial / NOT |
| Tools: workspace.status, documents.create, approvals.enqueue (impl) | `src/core/workspace/*`, `src/core/approvals/*` | — | **NOT** |
| Governance: permission-policy, path-policy, audit-log (ask-first gating) | `src/core/policy/*.mjs`, `src/core/workspace/audit-log.mjs` | — | **NOT** |
| Model providers (ollama + key-gated cloud) | `src/integrations/model-providers/` | `@tyroneross/local-llm` cascade (MLX/Ollama + cloud, budget) | covered (superset) |
| Web UI | node-served `src/public/*` | Next.js React (`app/page.js`, `app/components/*`) | covered (richer) |
| CLI `cos talk` REPL / `cos status` | `bin/cos.mjs`, `bin/cos-cli.mjs` | `scripts/run-chief-of-staff.mjs` batch runner (no REPL/status) | partial |
| v0-sdk agent-UI drafting | `scripts/draft-agent-ui-v0.mjs` + `v0-sdk` dep | — | **NOT** |
| agent-skills (markdown skills) | — | schedule-intake, feedback-loop, 100x-planning (`apps/cos/agent-skills/…`) | cos-only addition |

### chief-of-staff-only capabilities cos lacks

- **needs-adapter** (sole working impls, no cos replacement): (1) workspace/vault layer, (2) approvals queue + permission/path policy + audit log, (3) the REST surface `/api/{health,vault,approvals,documents,calendar/import,rituals,tools}`, (4) daily-plan ritual, (5) interactive `cos talk` console + `cos status`.
- **archive-safe**: ICS import (if unused), the planned-only rituals/tools stubs (meeting-prep, end-of-day, tasks.crud, commitments.extract, people.lookup, apple-calendar, slack), and the `v0-sdk` drafting script (dev-only).

### Recommendation

Keep `apps/chief-of-staff` as **compatibility-adapter**, not archive. Before any archival, decide whether the five needs-adapter features are wanted going forward; if not, port the small remaining pieces (or accept their loss) and *then* archive. The v0 drafting script and all "planned" stubs can be dropped immediately.

---

## Part 2 — `apps/agent-builder` tooling inventory (UI already retired to a signpost; value is the tooling)

### Scripts (`apps/agent-builder/scripts/`)

| Script | Lang | Purpose | Class | Reason |
|---|---|---|---|---|
| `run-agent-doe.mjs` | Node | DoE over artifact factors vs sandbox suite | **EXTRACT** | Structure-agnostic DoE harness |
| `run-local-validation.mjs` | Node | Local-LLM validation runs + scorecard + timestamped run dir | **EXTRACT** | Generic validation-run flow |
| `export-agent-package.mjs` | Node | Export generated agent as a package (`lib/agent-package-exporter`) | **EXTRACT** | Reusable packaging/export |
| `run-plan.mjs` | Node | Outline/fill planning pipeline (`lib/plan-runner`) | **EXTRACT** | Reusable content-gen logic |
| `doe/doe.py` | Python | DoE matrix (full/fractional/Plackett-Burman), numpy-only | **EXTRACT** | Self-contained DoE engine, "copied from multi-goal" |
| `doe/objectives.py` | Python | Scalarization, Derringer-Suich desirability, Pareto | **EXTRACT** | Pure optimization primitives, shared w/ autoresearch/loop |
| `doe/run-local-json-doe.mjs` | Node→Py | Local-model JSON-adherence DoE (Ollama vs MLX) | **EXTRACT** | Reusable benchmark (mixes Node+Python) |
| `doe/tasks.mjs` | Node | JSON-adherence tasks + pure scoring oracle | **EXTRACT** | Pure testable eval module |
| `agent-scan.mjs` | Node | CLI: enumerate structures, build via `agent-pack`, run suites | **COMPAT** | Thin CLI over extracted pkgs; entry-point wiring |
| `run-sandbox-e2e.mjs` | Node | Run sandbox suite over all structures | **COMPAT** | Wrapper over `sandbox/runner.js` |
| `write-pptx.mjs` | Node | JSON spec → `.pptx` via pptxgenjs | **COMPAT** | Subprocess of run-artifact-agents.py (⚠️ hardcoded path) |
| `generate-chief-of-staff.mjs` | Node | One-off single-structure generator | **ARCHIVE** | Superseded by generic scan/export |
| `run-artifact-agents.py` | Python | 138KB monolith: OOXML/docx/dashboard demo generator | **ARCHIVE** | Output-gen demo; only safety-scan nugget reusable; Node+Python monolith |
| `doe/__pycache__/*.pyc` | bytecode | Compiled cache | **ARCHIVE** | Generated; should not be tracked |

### Tooling dirs

| Dir | Contents | Class | Reason |
|---|---|---|---|
| `sandbox/` | `runner.js`, `local-llm.js`, `local-validation-scorecard.js` | **EXTRACT** | Core exec + local-LLM + scoring engine |
| `lib/` | plan-runner, agent-package-exporter, research-validation, build-files… | **EXTRACT** | Reusable builder logic (`flow-layout.mjs` is the one UI-adjacent piece → COMPAT) |
| `agent-skills/shared/` | 8 `*.skill.md` shared skill docs | **EXTRACT** | Reusable skill/prompt content |
| `plugin/` | self-contained `.claude-plugin`/`.codex-plugin` + own package.json | **EXTRACT** | Already standalone; lift out wholesale |
| `agent-structures/index.js` | 73KB catalog of structure specs | **COMPAT** | Data catalog consumed by most scripts (could become a data package) |
| `agent-outputs/` | generated decks/docs/dashboards, DoE outputs | **ARCHIVE** | Generated; hardcoded absolute paths in manifests |
| `generated/agents/…` | generated agent package | **ARCHIVE** | Generated; hardcoded `/Users/…` paths |
| `evals/doe/` | recorded eval result JSONs + fixtures | **ARCHIVE** | Historical run data |
| `agents/openai.yaml` | 328-byte config stub | **ARCHIVE** | Unreferenced leftover |

### Flags (feed C2-style env/path cleanup if these are extracted)

- **Node+Python coupling (harder extraction):** `run-artifact-agents.py` → shells to `write-pptx.mjs` (py:941, incidental monolith); `doe/run-local-json-doe.mjs` → spawns `doe.py` (mjs:52, clean intentional split).
- **Hardcoded absolute paths:** `scripts/write-pptx.mjs:14` → `/Users/tyroneross/.cache/codex-runtimes/.../pptxgenjs`; generated data under `agent-outputs/…` and `generated/agents/solo-tool-agent/{manifest.json,sources.md}` carry `/Users/tyroneross/dev/git-folder/agent-builder/…` (note: path predates the `-studio` rename).
- **Secrets:** none. All model/network access is `process.env` (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `AGENT_BUILDER_LLM`).

### Summary

Genuinely extract-worthy core → a future `packages/builder-tools` (or the existing `@tyroneross/*`): the **DoE + optimization engine** (`doe/*`), the **sandbox exec + local-LLM + scorecard** stack (`sandbox/`), the **`lib/` builder logic**, the **shared skill docs**, and the already-standalone **`plugin/`**. Thin CLIs + the `agent-structures` catalog stay as **compatibility** wiring. Everything under `agent-outputs/`, `generated/`, `evals/doe/`, the `run-artifact-agents.py` monolith, `generate-chief-of-staff.mjs`, `agents/openai.yaml`, and `__pycache__` is **archive** — generated output or one-off scaffolding, much of it carrying stale `/Users/…` paths.

**Scope note:** actual moves (extraction, archival, chief-of-staff adapter/archive) are migration-plan v2 / step-4 work, NOT this build — C7 delivers only this decision + inventory doc.
