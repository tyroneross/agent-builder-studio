#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { runChiefOfStaff } from "../lib/cos-runner.mjs";

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

async function readMaybe(path) {
  if (!path || !existsSync(path)) return null;
  return readFile(path, "utf8");
}

const scheduleArg = arg("--schedule");
const goalsArg = arg("--goals");
const baseOut = arg("--out", join(ROOT, "runs", new Date().toISOString().replace(/[:.]/g, "-")));

// Legacy: --model / --models still supported. When set, the runner collapses
// the cascade to a single user-override step so the legacy behavior is exact.
//
// The legacy default was `gpt-oss:20b` which scored 0 in the local benchmark.
// We now leave MODELS=[null] (use cascade defaults) when the user passes nothing
// at all. If the user explicitly wants a single-model run via `--model` without
// a name, we point them at qwen3:8b-q4_K_M (top speed-quality balance).
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
  console.log(
    `\n[cos] === ${modelName ? `model=${modelName}` : "cascade"} allow-cloud=${allowCloud ?? "on-failure(default)"} -> ${outDir} ===`,
  );

  const onEvent = (ev) => {
    if (ev.type === "warmup") console.log(`[cos] warmup ${ev.provider}/${ev.model}...`);
    if (ev.type === "warmup-ok") console.log(`[cos] warmup ok`);
    if (ev.type === "warmup-fail") console.log(`[cos] warmup failed: ${ev.error}`);
    if (ev.type === "node-step") {
      console.log(
        `[cos] ${ev.key}: try lane=${ev.lane} ${ev.provider}/${ev.model} (attempt ${ev.attempt})`,
      );
    }
    if (ev.type === "node-end") {
      console.log(
        `[cos] ${ev.name}: ${ev.durationMs}ms parsed=${ev.parsed} bytes=${ev.bytes} via ${ev.provider}/${ev.model} (${ev.lane})`,
      );
    }
    if (ev.type === "node-error") {
      console.log(`[cos] ${ev.name} failed: ${ev.error}`);
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

  console.log(`[cos] done -> ${join(outDir, "weekly-operating-brief.md")}`);
  console.log(`[cos] telemetry -> ${join(outDir, "telemetry.jsonl")}`);
  return { model: modelName ?? "cascade", outDir };
}

const results = [];
for (const m of MODELS) {
  results.push(await runForModel(m));
}

if (results.length > 1) {
  console.log(`\n[cos] all models done. Compare:`);
  for (const r of results) {
    console.log(`  - ${r.model}: ${join(r.outDir, "weekly-operating-brief.md")}`);
  }
}
