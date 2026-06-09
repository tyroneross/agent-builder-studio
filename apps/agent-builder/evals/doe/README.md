# Local-model JSON-adherence DOE

Engine: `scripts/doe/doe.py` + `scripts/doe/objectives.py` (numpy-only, copied
from multi-goal). Runner: `scripts/doe/run-local-json-doe.mjs`
(`npm run doe:local-json`; `--fixture` for the deterministic no-LLM path).

## Run 2026-06-09 (`local-json-passrate-2026-06-09T23-22-10.json`)

Live run. 2^3 full factorial x 6 tasks x 3 replicates = 144 calls.
Models: `llama3.2:3b` (Ollama) vs `mlx-community/Llama-3.2-3B-Instruct-4bit`
(MLX server) — same weight class, fair lane comparison.
Objectives: pass_rate (higher, .7) + mean_latency_ms (lower, .3), scalarized.

| backend | schema in prompt | strict suffix | pass rate | mean latency |
|---|---|---|---|---|
| ollama | no | no | 0.67 | 426ms |
| ollama | no | yes | **0.89** | **284ms** |
| ollama | yes | no | 0.28 | 553ms |
| ollama | yes | yes | 0.89 | 363ms |
| mlx | no | no | 0.67 | 330ms |
| mlx | no | yes | **1.00** | 289ms |
| mlx | yes | no | 0.33 | 505ms |
| mlx | yes | yes | 0.00 | 405ms |

### Findings (measured)

1. **Strict "Return ONLY the JSON object" suffix helps**: +0.10 pass-rate main
   effect and −59ms latency. Cheapest reliability lever for local 3B models.
2. **Inlining the JSON schema in the prompt HURTS 3B models**: −0.22 pass-rate
   main effect and +62ms latency. Terse field lists beat full schema dumps.
3. **Scalarized winner**: ollama / no-schema / strict (0.89 @ 284ms, score 0.92).
   The mlx / no-schema / strict cell reached 1.00 pass.
4. **Backend main effect on pass rate is small** (−0.07): lane choice matters
   far less than prompt shape at this size class.

### Anomaly (root-caused to failure signature)

mlx + schema + strict scored 0.00 with a uniform `missing-field:*` /
`not-a-json-object` signature: responses parsed as JSON objects but lacked
every required field — consistent with the model echoing the inlined schema
object instead of instantiating it (TAG:INFERRED; raw response text is not
persisted in the packet). Reinforces finding 2 for the MLX chat template.

### Interpretation guardrails

Per the nightly-DOE contract: 3 replicates meets the minimum; treat these as
medium confidence for this model class and task set. Do not generalize to
other weight classes without re-running (`npm run doe:local-json`).
