# Nightly Local LLM DOE Contract

## Summary

This is a design/spec update only. The executable nightly runner is intentionally
held back for now.

The contract defines how a future Codex or Claude automation should inspect
multiple repos overnight and produce a morning recommendation packet using a
local model where possible.

Source contract:

`plugin/references/templates/nightly-doe-contract.json`

## Current Status

- Executable runner: not included yet.
- Feature flag: `nightlyLocalDoe` is toggled off by default.
- Target repos: read-only by default.
- Writes: limited to a future `agent-outputs/nightly-doe/<run-id>/` packet.
- Guard execution: requires explicit approval before running commands in target
  repos.
- Patch creation: requires explicit approval before modifying target repos.

Enable rule: do not turn this on until the user explicitly approves the runner
implementation and the repo-write/guard-execution boundaries are reviewed.

## Implementation Plan Only

This section is intentionally a plan, not an implementation.

1. Keep the feature flag default off and require an explicit manual command for
   every run.
2. Reuse the existing local validation state format so partial overnight work
   can resume without rerunning completed repo/track packets.
3. Treat every target repo as read-only unless a per-run approval file names the
   repo, allowed paths, guard commands, and maximum write scope.
4. Write the morning packet under `agent-outputs/nightly-doe/<run-id>/` with:
   repo summaries, local-model caveats, confidence labels, artifacts produced,
   failures, and why-not-trust-yet notes.
5. Add a dry-run validator before any executable runner ships. The validator
   should prove the repo list, output path containment, feature-flag state, and
   no-write default.
6. Add the executable runner only after reviewing the repo-write and
   guard-execution boundaries.

## Cross-Repo Contract

Repo descriptor:

```json
{
  "name": "interface-built-right",
  "path": "/Users/tyroneross/dev/git-folder/interface-built-right",
  "track": "ui-improvement"
}
```

Allowed by default:

- read package metadata
- read git status summary
- read existing test/build script names
- write morning recommendations inside the agent-builder output folder

Not allowed by default:

- modifying target repo files
- running penetration tools
- publishing customer-specific updates
- reading secrets
- downloading dependencies

## Local Model Interpretation

Smaller local models need narrower experiments and more conservative
interpretation.

Rules:

- Do not infer a trend from one run.
- Change at most four factors per nightly DOE.
- Keep prompts short and artifact-specific.
- Separate measurement from interpretation.
- Promote only medium-or-higher confidence findings.
- Treat low-confidence findings as repeat prompts.
- Escalate security findings to a stronger reviewer before action.

Preferred defaults:

- interpretation mode: cautious
- minimum replicates for recommendation: 3
- preferred replicates: 4
- confidence labels: low, medium, high

## Morning Packet Contract

Required files:

- `nightly-doe-results.json`
- `morning-recommendations.md`
- `automation-handoff.md`
- `learning-ledger.json`
- `repo-summaries/<repo>.json`

Each recommendation must include:

- repo
- track
- experiment
- metric result
- confidence
- recommended action
- artifacts produced
- why not to trust the result yet

## Expansion Tracks

- code quality and test coverage
- security and penetration-test simulation
- UI improvement
- customer-specific product update drafting
- agent artifact quality
