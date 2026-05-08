#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { runChiefOfStaff } from "../lib/cos-runner.mjs";
import { summarizeFile, formatSummary } from "../lib/cos-summary.mjs";

const ROOT = resolve(new URL("..", import.meta.url).pathname);

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function flagWithEqual(prefix) {
  // Supports `--allow-cloud=on-failure` style.
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1) : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const HELP = `
Chief of Staff — local-first agent runner

USAGE
  node scripts/run-chief-of-staff.mjs [flags]

INPUT FLAGS
  --schedule <path>       Path to a JSON schedule file. Defaults to the
                          bundled sample at agent-outputs/...
  --goals <path>          Path to a goals text file. Defaults to a built-in
                          productivity goal.
  --out <dir>             Per-run output directory. Defaults to
                          ./runs/<iso-timestamp>/.

CASCADE FLAGS
  --allow-cloud <value>   never | on-failure (default) | always
  --max-cloud-tokens <n>  Cap cloud usage. Default 200000. Ignored when
                          --allow-cloud=never.
  --model <name>          Legacy single-model override (Ollama only).
                          Collapses the cascade to one step.
  --models <a,b,c>        Run the agent N times, once per model. Each run
                          gets its own subdirectory under --out.

OUTPUT FLAGS
  --summary               Print a per-node digest after each run (default ON).
  --no-summary            Suppress the digest.
  --json                  Emit a single machine-readable JSON object to
                          stdout at end. Implies --no-summary on stdout
                          and silences all [cos] chatter on stdout (chatter
                          stays on stderr so progress is still visible
                          when redirecting only stdout).
  --help                  Show this banner and exit.

ENVIRONMENT
  GROQ_API_KEY            Cloud lane (Groq, primary cloud provider).
  ANTHROPIC_API_KEY       Cloud secondary lane.
  OPENAI_API_KEY          Cloud tertiary lane.
  OLLAMA_BASE_URL         Override Ollama endpoint (default http://localhost:11434).
  COS_ALLOW_CLOUD         Same values as --allow-cloud.
  COS_MAX_CLOUD_TOKENS    Same as --max-cloud-tokens.
  COS_ANTHROPIC_PARSE_MODEL  Override Anthropic parse-tier model ID.
  COS_ANTHROPIC_SYNTHESIS_MODEL  Override Anthropic synthesis-tier model ID.
  COS_OPENAI_PARSE_MODEL  Override OpenAI parse-tier model ID.
  COS_OPENAI_SYNTHESIS_MODEL  Override OpenAI synthesis-tier model ID.
  AGENT_BUILDER_LLM_TIMEOUT_MS  Per-call timeout in ms. Default 900000.

EXAMPLES
  # Cascade with the bundled sample, default policy (on-failure):
  node scripts/run-chief-of-staff.mjs

  # Cloud always, JSON output for piping into jq or another tool:
  node scripts/run-chief-of-staff.mjs --allow-cloud=always --json | jq .

  # Single-model legacy run, no summary:
  node scripts/run-chief-of-staff.mjs --model qwen3:8b-q4_K_M --no-summary
`;

if (hasFlag("--help") || hasFlag("-h")) {
  process.stdout.write(HELP.trim() + "\n");
  process.exit(0);
}

const scheduleArg = arg("--schedule");
const goalsArg = arg("--goals");
const baseOut = arg("--out", join(ROOT, "runs", new Date().toISOString().replace(/[:.]/g, "-")));

// Output mode flags. `--json` forces silent stdout (no [cos] chatter on
// stdout) so the final JSON object is the ONLY thing on stdout. Status
// chatter routes to stderr so users redirecting stdout still see progress.
const JSON_MODE = hasFlag("--json");
const SUMMARY_MODE = !hasFlag("--no-summary"); // default ON
async function readMaybe(path) {
  if (!path || !existsSync(path)) return null;
  return readFile(path, "utf8");
}

const log = JSON_MODE
  ? (msg) => process.stderr.write(msg + "\n")
  : (msg) => process.stdout.write(msg + "\n");

// Legacy: --model / --models still supported. When set, the runner collapses
// the cascade to a single user-override step so the legacy behavior is exact.
const modelsArg = arg(
  "--models",
  process.env.OLLAMA_MODELS ?? arg("--model", process.env.OLLAMA_MODEL),
);
const LEGACY_SINGLE_DEFAULT = "qwen3:8b-q4_K_M";
const MODELS = modelsArg
  ? modelsArg.split(",").map((s) => s.trim()).filter(Boolean).map((m) => m === "default" ? LEGACY_SINGLE_DEFAULT : m)
  : [null]; // null = use cascade defaults

const TIMEOUT_MS = Number(process.env.AGENT_BUILDER_LLM_TIMEOUT_MS ?? 900000);

// New cascade controls
const allowCloud =
  flagWithEqual("--allow-cloud") ?? arg("--allow-cloud") ?? process.env.COS_ALLOW_CLOUD;
const maxCloudTokensRaw =
  flagWithEqual("--max-cloud-tokens") ??
  arg("--max-cloud-tokens") ??
  process.env.COS_MAX_CLOUD_TOKENS;
const maxCloudTokens = maxCloudTokensRaw != null ? Number(maxCloudTokensRaw) : undefined;

const schedule = await readMaybe(scheduleArg);
const goals = await readMaybe(goalsArg);

async function runForModel(modelName) {
  const safe = (modelName ?? "cascade").replace(/[^a-z0-9]+/gi, "-");
  const outDir = MODELS.length > 1 ? join(baseOut, safe) : baseOut;
  await mkdir(outDir, { recursive: true });
  log(
    `\n[cos] === ${modelName ? `model=${modelName}` : "cascade"} allow-cloud=${allowCloud ?? "on-failure(default)"} -> ${outDir} ===`,
  );

  const onEvent = (ev) => {
    // Suppress event chatter on stdout when --json is set; we still emit
    // status to stderr above via log().
    if (JSON_MODE) return;
    if (ev.type === "warmup") log(`[cos] warmup ${ev.provider}/${ev.model}...`);
    if (ev.type === "warmup-ok") log(`[cos] warmup ok`);
    if (ev.type === "warmup-fail") log(`[cos] warmup failed: ${ev.error}`);
    if (ev.type === "node-step") {
      log(
        `[cos] ${ev.key}: try lane=${ev.lane} ${ev.provider}/${ev.model} (attempt ${ev.attempt})`,
      );
    }
    if (ev.type === "node-end") {
      log(
        `[cos] ${ev.name}: ${ev.durationMs}ms parsed=${ev.parsed} bytes=${ev.bytes} via ${ev.provider}/${ev.model} (${ev.lane})`,
      );
    }
    if (ev.type === "node-error") {
      log(`[cos] ${ev.name} failed: ${ev.error}`);
    }
  };

  const modelOverride = modelName ? { provider: "ollama", model: modelName } : null;

  const { transcript, brief } = await runChiefOfStaff({
    model: modelName ?? "(cascade)",
    schedule,
    goals,
    onEvent,
    timeoutMs: TIMEOUT_MS,
    allowCloud,
    maxCloudTokens,
    modelOverride,
    runDir: outDir,
  });

  for (const [key, node] of Object.entries(transcript.nodes)) {
    await writeFile(
      join(outDir, `${key}.json`),
      JSON.stringify(node.parsed ?? { _raw: node.raw, error: node.error }, null, 2),
    );
  }
  await writeFile(join(outDir, "transcript.json"), JSON.stringify(transcript, null, 2));
  await writeFile(join(outDir, "weekly-operating-brief.md"), `${brief}\n\nFull artifacts: \`${outDir}\`\n`);

  log(`[cos] done -> ${join(outDir, "weekly-operating-brief.md")}`);
  log(`[cos] telemetry -> ${join(outDir, "telemetry.jsonl")}`);

  // Build summary from the just-written telemetry. This is the canonical
  // input — same shape the API's run-summary event uses.
  const summary = await summarizeFile(join(outDir, "telemetry.jsonl"));

  if (SUMMARY_MODE && !JSON_MODE) {
    log(formatSummary(summary));
  }

  return { model: modelName ?? "cascade", outDir, brief, transcript, summary };
}

const results = [];
for (const m of MODELS) {
  results.push(await runForModel(m));
}

if (results.length > 1 && !JSON_MODE) {
  log(`\n[cos] all models done. Compare:`);
  for (const r of results) {
    log(`  - ${r.model}: ${join(r.outDir, "weekly-operating-brief.md")}`);
  }
}

if (JSON_MODE) {
  // One JSON object per run (or wrapped in `runs[]` if --models was multi).
  const payload = results.length === 1
    ? {
        model: results[0].model,
        outDir: results[0].outDir,
        brief: results[0].brief,
        summary: results[0].summary,
        transcript: results[0].transcript,
      }
    : {
        runs: results.map((r) => ({
          model: r.model,
          outDir: r.outDir,
          brief: r.brief,
          summary: r.summary,
          transcript: r.transcript,
        })),
      };
  process.stdout.write(JSON.stringify(payload) + "\n");
}
