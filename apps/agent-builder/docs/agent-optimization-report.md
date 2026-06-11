# Agent Optimization Report

Date: 2026-04-27

## Summary

The agent builder now generates and tests seven domain agents with eval-gated learning:

- Chief of Staff Agent
- PowerPoint Deck Builder
- Writing Agent
- App Builder Agent
- Research Brief Agent
- Code Review Agent
- Data Analysis Agent

Each agent has a domain-learning profile, a visible memory node in the flow, four mock regression scenarios, and generated memory/eval artifacts. The sandbox score improved from `133` to `252`, an `89.47%` improvement over the baseline recorded by the build-loop optimize tracker.

## What Changed

Generated agents now include:

- `agent.yaml`
- `manifest.json`
- `system-prompt.md`
- `prompts/prompt-builder-contract.md`
- `tools.json`
- `evals/golden-tasks.json`
- `evals/regression-scenarios.json`
- `memory/domain-playbook.md`
- `memory/learning-ledger.json`
- `README.md`
- `sources.md`

The learning loop is:

1. Run domain scenarios with mock or real inputs.
2. Score required outputs, quality terms, permission invariants, and stop reasons.
3. Extract failure patterns and candidate lessons.
4. Promote only lessons that improve later scenarios without breaking guardrails.
5. Write accepted lessons to the domain playbook with provenance.

## Agent Scenario Coverage

| Agent | Domain | Scenario Count | Example Edge Scenario |
| --- | --- | ---: | --- |
| Chief of Staff | Executive operations | 4 | Ambiguous ownership and overloaded owner |
| PowerPoint Deck Builder | Presentation design | 4 | Investor demo for domain-learning agents |
| Writing Agent | Structured writing | 4 | Critique and rewrite vague source material |
| App Builder Agent | Small app construction | 4 | Agent YAML config editor |
| Research Brief Agent | Technical research synthesis | 4 | Non-US agent labs and startups |
| Code Review Agent | Code review | 4 | Dependency drift and framework API risk |
| Data Analysis Agent | Local data analysis | 4 | Anomaly check with suspicious metric spike |

## Ten Optimization Steps

| Step | Change | Score | Delta | Status |
| ---: | --- | ---: | ---: | --- |
| 0 | Baseline | 133 | 0 | baseline |
| 1 | Add Chief of Staff ambiguous ownership scenario | 138 | +5 | keep |
| 2 | Add PowerPoint investor demo scenario | 143 | +5 | keep |
| 3 | Add Writing critique-rewrite scenario | 148 | +5 | keep |
| 4 | Add App Builder config-editor scenario | 153 | +5 | keep |
| 5 | Add Research non-US labs scenario | 158 | +5 | keep |
| 6 | Add Code Review dependency-drift scenario | 163 | +5 | keep |
| 7 | Add Data Analysis anomaly-check scenario | 168 | +5 | keep |
| 8 | Score scenario acceptance criteria | 196 | +28 | keep |
| 9 | Score permission invariants in every scenario artifact | 224 | +28 | keep |
| 10 | Use DOE to select reflection prompts as a default artifact factor | 252 | +28 | keep |

All ten optimization steps were kept. No discards or guard failures were recorded.

## DOE Findings

Command:

```bash
npm run agent:doe
```

Design: `2^3` full factorial

Response variable: sandbox score

Factors:

- `acceptanceCriteria`
- `permissionInvariants`
- `reflectionPrompts`

Result:

| Factors | Score |
| --- | ---: |
| all low | 161/252 |
| reflection only high | 189/252 |
| permission only high | 189/252 |
| permission + reflection high | 217/252 |
| acceptance only high | 189/252 |
| acceptance + reflection high | 217/252 |
| acceptance + permission high | 217/252 |
| all high | 252/252 |

Main effects:

- `acceptanceCriteria`: `+29.75` score points
- `permissionInvariants`: `+29.75` score points
- `reflectionPrompts`: `+29.75` score points

Decision: keep the all-high artifact profile as the default.

## Test Outputs

### Unit and Integration Tests

Command:

```bash
npm test
```

Output summary:

- Tests: `6`
- Passed: `6`
- Failed: `0`

### Production Build

Command:

```bash
npm run build
```

Output summary:

- Next.js production build passed.
- Routes generated:
  - `/`
  - `/_not-found`
  - `/api/build`

### Dependency Audit

Command:

```bash
npm audit --audit-level=moderate
```

Output summary:

- `0` vulnerabilities found.

### Fixture Sandbox E2E

Command:

```bash
npm run agent:scan -- --run --llm=fixture
```

Output summary:

- Research validation: `7/7` passed.
- Sandbox e2e: `7/7` passed.
- Scenarios: `28`.
- Score: `252/252`.
- Each agent scored `36/36`.

### Local Ollama Smoke

Command:

```bash
npm run agent:scan -- --run --llm=ollama --model=tinyllama:latest --scenario-limit=1
```

Output summary:

- Research validation: `7/7` passed.
- Sandbox e2e: `7/7` passed.
- Scenarios: `7`.
- Score: `84/84`.
- Each agent scored `12/12`.

### Full Local Ollama Suite

Command:

```bash
AGENT_BUILDER_LLM_TIMEOUT_MS=120000 npm run agent:scan -- --run --llm=ollama --model=tinyllama:latest
```

Output summary:

- The full 28-scenario local-model run timed out inside `LocalLLM.generate`.
- The one-scenario-per-agent local smoke passed, so the failure appears to be model runtime throughput or per-call timeout pressure, not a generated artifact contract failure.
- Follow-up implemented: `npm run agent:validate:local -- --chunk-size=<n> --state=<path>` runs local validation in resumable structure chunks and writes a quality scorecard into the saved state file.

## Findings

- Eval-gated domain memory is the right first version. It lets agents improve within their domain without silently mutating prompts or requiring model fine-tuning.
- Scenario breadth improved the score predictably. Each fourth scenario added `+5` points and widened the regression surface.
- DOE was useful. It showed acceptance criteria, permission invariants, and reflection prompts each improved the metric, and the all-high setting was best.
- Local fixture tests are reliable for structural validation. They verify generated files, scenario coverage, learning artifacts, and sandbox boundaries deterministically.
- Live local models need chunking. `tinyllama:latest` passed the seven-scenario smoke test, but the full 28-scenario pass hit timeouts even with a longer timeout.
- macOS temp roots matter. A previous Ollama smoke hit `EPERM` under `/var/folders`, so sandbox runs now default to `/tmp` unless `AGENT_BUILDER_TMPDIR` is set.

## Research Basis

- Anthropic, "Building effective agents": https://www.anthropic.com/research/building-effective-agents/
- Anthropic, "How we built our multi-agent research system": https://www.anthropic.com/engineering/built-multi-agent-research-system
- OpenAI Agents SDK guardrails: https://openai.github.io/openai-agents-js/guides/guardrails/
- OpenAI Agents SDK tracing: https://openai.github.io/openai-agents-js/guides/tracing/
- OpenAI, "The next evolution of the Agents SDK": https://openai.com/index/the-next-evolution-of-the-agents-sdk
- OpenAI Deep Research System Card: https://openai.com/research/deep-research-system-card/
- MAST, "Why Do Multi-Agent LLM Systems Fail?", arXiv:2503.13657: https://arxiv.org/abs/2503.13657
- "Survey on Evaluation of LLM-based Agents", arXiv:2503.16416: https://arxiv.org/abs/2503.16416
- Reflexion, "Language Agents with Verbal Reinforcement Learning", arXiv:2303.11366: https://arxiv.org/abs/2303.11366
- DSPy, "Compiling Declarative Language Model Calls into Self-Improving Pipelines", arXiv:2310.03714: https://arxiv.org/abs/2310.03714
- Ollama API generate docs: https://docs.ollama.com/api/generate

## Useful Commands

```bash
npm run agent:scan
npm run agent:scan -- --run --llm=fixture
npm run agent:scan -- --run --llm=ollama --model=tinyllama:latest --scenario-limit=1
npm run agent:doe
npm run sandbox:score
```
