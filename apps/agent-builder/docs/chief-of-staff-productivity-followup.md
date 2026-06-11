# Chief of Staff Productivity Follow-up

Date: 2026-04-27

## Summary

The follow-up build turns the Chief of Staff agent from a generic operating-plan
writer into a schedule-aware productivity system. It now accepts a schedule-like
input, builds an optimized week, creates a learning ledger, defines a small
Chief of Staff team, and emits real files under the artifact suite.

## Key Outputs

| Output | Path |
| --- | --- |
| Schedule input JSON | `agent-outputs/hypothetical-local-agent-suite/final/chief-of-staff-agent/schedule-optimizer/input-schedule.json` |
| Optimized time-block plan | `agent-outputs/hypothetical-local-agent-suite/final/chief-of-staff-agent/schedule-optimizer/time-block-plan.json` |
| Word time plan with tables | `agent-outputs/hypothetical-local-agent-suite/final/chief-of-staff-agent/schedule-optimizer/weekly-time-plan.docx` |
| Calendar export | `agent-outputs/hypothetical-local-agent-suite/final/chief-of-staff-agent/schedule-optimizer/optimized-week.ics` |
| Learning ledger | `agent-outputs/hypothetical-local-agent-suite/final/chief-of-staff-agent/schedule-optimizer/learning-ledger.json` |
| Chief of Staff team map | `agent-outputs/hypothetical-local-agent-suite/final/chief-of-staff-agent/schedule-optimizer/chief-of-staff-team.md` |
| Local model comparison | `agent-outputs/hypothetical-local-agent-suite/final/model-comparison-agent/local-llm-review/model-comparison.md` |
| Nightly local LLM DOE recommendations | `agent-outputs/hypothetical-local-agent-suite/final/local-llm-doe-agent/experiment-loop/morning-recommendations.md` |
| Agent skill index | `agent-outputs/hypothetical-local-agent-suite/final/agent-skill-pack/skills-index.json` |

## Chief of Staff Design

Goal: help the user become 100x more productive by protecting strengths and
compensating for weaknesses.

Core team:

- Priority Strategist: chooses the few high-leverage outcomes.
- Calendar Architect: turns the week into protected blocks and meeting clusters.
- Follow-up Operator: maintains owner/action/date loops.
- Energy Analyst: learns which block shapes produce better output.
- Honesty Auditor: flags missing data and overconfident claims.

The first version deliberately stays simple: five tools, one orchestrator, and
schedule-specific skills instead of exposing a large tool surface to local
models.

## Nightly Experiment Operator

The local LLM DOE agent is the path toward a nightly Chief of Staff operator. It
can run bounded Codex or Claude automations across selected repos, keep writes
inside approved folders, and produce a morning recommendation packet.

Latest 50-run artifact suite score after adding the nightly DOE agent:

`11282/11727`

Best local DOE settings in the current structural metric:

- interpretation mode: cautious
- replicate count: 4

Recommended morning packet:

- repo and experiment name
- metric movement
- confidence label
- recommended action
- artifacts produced
- what not to trust yet

Expansion tracks:

- penetration-test simulation and sandbox checks
- UI improvement candidates
- customer-specific product update drafts
- product use-case tailoring
- agent handoff and artifact quality regressions

## Measured Result

| Metric | Before | After |
| --- | ---: | ---: |
| Artifact score | 731 | 1312 |
| Max score | 781 | 1362 |
| Test pass count | 7 | 7 |
| DOE runs | 8 | 8 |
| Compared local models | 3 | 6 |

Best DOE setting remains:

`deckDepth-high-docDepth-high-dashboardDepth-high`

## Local Model Comparison

| Model | Status | Seconds | Score |
| --- | --- | ---: | ---: |
| `qwen3:8b-q4_K_M` | ok | 3.08 | 6 |
| `gemma4:26b` | ok | 3.6 | 7 |
| `llama3.2:3b` | ok | 2.07 | 4 |
| `gpt-oss:20b` | ok | 4.82 | 0 |
| `tinyllama:latest` | ok | 0.97 | 1 |
| `qwen2.5-coder:32b-instruct-q5_K_M` | ok | 14.4 | 6 |

Current router recommendation:

- `gemma4:26b` for schedule-planning drafts.
- `qwen3:8b-q4_K_M` for balanced local planning.
- `tinyllama:latest` for fast smoke tests only.
- `qwen2.5-coder:32b-instruct-q5_K_M` for code and schema-heavy tasks with a timeout.

## 20 Optimization Iterations

These were implementation and validation iterations, not 20 separate commits.
The mechanical metric was measured at baseline and final, with DOE and test
commands used as guardrails.

| Step | Change or check | Evidence | Result |
| ---: | --- | --- | --- |
| 1 | Initialized build-loop optimize | `.build-loop/optimize/experiment.json` | baseline 731 |
| 2 | Replaced raw PPTX path with local `pptxgenjs` helper | `scripts/write-pptx.mjs` | kept |
| 3 | Removed empty OOXML directory entries from PPTX packages | `strip_zip_directory_entries` | kept |
| 4 | Removed slide-number placeholders from generated decks | PPT quality report | pass |
| 5 | Added schedule intake JSON | `input-schedule.json` | kept |
| 6 | Added optimized time-block plan | `time-block-plan.json` | kept |
| 7 | Added Chief of Staff learning ledger | `learning-ledger.json` | kept |
| 8 | Added Chief of Staff team map | `chief-of-staff-team.md` | kept |
| 9 | Added calendar export | `optimized-week.ics` | kept |
| 10 | Improved Word formatting with tables | `weekly-time-plan.docx` contains 2 tables | pass |
| 11 | Added local model comparison output | `model-comparison.md` | 6 models |
| 12 | Added reusable agent skill files | `agent-skills/` | kept |
| 13 | Added generated skill index | `agent-skill-pack/skills-index.json` | kept |
| 14 | Updated Chief of Staff structure for schedule/team learning | `agent-structures/index.js` | kept |
| 15 | Rechecked research-derived architecture constraints | `npm run agent:scan -- --score` | 7/7 pass |
| 16 | Added artifact test assertions for new outputs | `tests/artifact-agents.test.mjs` | kept |
| 17 | Ran artifact score | `npm run agents:artifacts:score` | 1312 |
| 18 | Ran unit/integration tests | `npm test` | 7/7 pass |
| 19 | Ran PPT package and quality checks | `unzip -t`, presentation quality script | pass |
| 20 | Ran Word package/table checks | `unzip -t`, table count | pass |

## Security Notes

- No internet downloads were performed.
- Local model calls used Ollama on `localhost`.
- Generated files stay under `agent-outputs/`.
- Office outputs are macro-free OOXML packages.
- HTML outputs are local and do not include external links.
- Calendar output is a static `.ics` file; the agent does not send invites.

## Latest Product Follow-up

- Real calendar `.ics` input is accepted through the Chief of Staff UI import
  flow and by pasting VCALENDAR text. The server normalizes `.ics` into the
  existing schedule JSON contract before the intake node runs.
- The UI now captures weekly feedback for actual focus, follow-through, and
  operator notes. The runner injects that feedback into triage and time-block
  planning through the feedback-loop skill.
- The run transcript and brief now include a Chief of Staff quality scorecard:
  completeness, owner coverage, decision clarity, schedule realism, and risk
  surface.
- Proposed time blocks now render in a calendar review panel where the user can
  approve, reject, edit, and download only approved blocks as `.ics`.
- Slow local-model validation can run by structure through
  `npm run agent:validate:local -- --chunk-size=<n> --state=<path>`.

## Remaining Improvements

- Run live multi-model local validation once the target Ollama models are
  installed locally.
- Expand feedback storage from per-run transcript metadata into a durable
  operator review history if repeated weekly use proves valuable.

## 50-Run DOE Follow-up

The next optimization pass added a 50-run mixed-level DOE and agent handoff
artifacts.

New command:

```bash
npm run agents:artifacts:score50
```

Latest score: `10388`.

Best run: `mixed-05-deck8-doc7-dash5-recovery-minimal`.

The new DOE varies deck depth, Word structure, dashboard breadth, schedule
strategy, research depth, QA depth, skill depth, and handoff format.

See `docs/fifty-doe-experiment-report.md` for the full result.
