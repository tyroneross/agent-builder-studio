# @tyroneross/builder-tools

Reusable tooling extracted from `apps/agent-builder` in migration increment 1.

Authority: `docs/LEGACY_TRIAGE.md` Part 2 classifies these items as EXTRACT:

- `scripts/doe/doe.py`: self-contained DoE engine, numpy-only.
- `scripts/doe/objectives.py`: pure optimization primitives.
- `scripts/doe/tasks.mjs`: pure testable JSON-adherence scoring module.
- `sandbox/runner.js`, `sandbox/local-llm.js`, `sandbox/local-validation-scorecard.js`: core exec, local-LLM, and scoring stack.

## Layout

- `src/doe/`: Node task oracle plus Python DoE subprocess engine.
- `src/sandbox/`: sandbox execution, local fixture/Ollama adapter, and validation scorecard.
- `index.mjs`: Node barrel exports and Python file path constants.

The Python files are not imported by Node directly. Invoke `DOE_ENGINE_PATH` as a subprocess target with `python3`; `doe.py` imports `objectives.py` from the same directory.

## Increment Scope

This package intentionally includes only the cleanest self-contained EXTRACT items. Deferred EXTRACT items from `apps/agent-builder` include the higher-level CLIs, `lib/` builder logic, shared skill docs, and plugin extraction. COMPAT wrappers and ARCHIVE cleanup remain in `apps/agent-builder` for a follow-up.
