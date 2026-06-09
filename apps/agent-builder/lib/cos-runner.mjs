import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chat,
  ollamaTags,
  ollamaPs,
  NODE_ROUTING,
  TIER_LOCAL_MODELS,
  cascadePolicy,
  resolveCascade,
  nodeKeyForTier,
  probeMlx,
  probeOllama,
  runCascade,
} from "@tyroneross/local-llm";
import { NODE_ROLE, roleBriefFor, roleNameFor, effectiveTierOverride } from "./cos-roles.mjs";
import { recordTelemetry, flushTelemetry } from "./cos-telemetry.mjs";
import { summarizeFile } from "./cos-summary.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AGENT_DIR = join(ROOT, "generated/agents/chief-of-staff-agent");
const SKILL_DIR = join(ROOT, "agent-skills/chief-of-staff");
const TEAM_FILE = join(
  ROOT,
  "agent-outputs/hypothetical-local-agent-suite/final/chief-of-staff-agent/schedule-optimizer/chief-of-staff-team.md",
);
export const SAMPLE_INPUT = join(
  ROOT,
  "agent-outputs/hypothetical-local-agent-suite/final/chief-of-staff-agent/schedule-optimizer/input-schedule.json",
);

export const DEFAULT_GOAL =
  "Become 100x more productive by spending more time on high-leverage strengths and less time manually coordinating low-leverage work.";

// Re-export for back-compat with any code that imported from here previously.
export { ollamaTags };

// Probe local lanes ONCE per process and cache. Used to drop an unhealthy local
// lane from the cascade (MLX-first: if mlx_lm.server is down, mlx is skipped and
// Ollama becomes the local primary — the local mirror of cloud key-gating).
let _localHealth = null;
let _localHealthAt = 0;
const LOCAL_HEALTH_TTL_MS = 60000;
async function getLocalHealth() {
  // Cache for 60s (not forever): MLX/Ollama started AFTER the first run must be
  // able to rejoin the cascade without a process restart.
  if (_localHealth && Date.now() - _localHealthAt < LOCAL_HEALTH_TTL_MS) return _localHealth;
  const [mlx, ollama] = await Promise.all([probeMlx(), probeOllama()]);
  _localHealth = { mlx: mlx.healthy, ollama: ollama.healthy };
  _localHealthAt = Date.now();
  return _localHealth;
}

const HARD_RULES = [
  "You are a local Chief of Staff agent. No web access. No invented data.",
  "Return ONLY valid JSON matching the schema. No prose outside the JSON.",
  "If a value is unknown, use null and add an entry to a top-level `notes` array.",
  "Never invent owners, dates, or events that are not present in the input.",
].join("\n");

let _cachedContext = null;
async function loadContext() {
  if (_cachedContext) return _cachedContext;
  const [team, skillIntake, skillPlan] = await Promise.all([
    readFile(TEAM_FILE, "utf8"),
    readFile(join(SKILL_DIR, "schedule-intake.skill.md"), "utf8"),
    readFile(join(SKILL_DIR, "100x-productivity-planning.skill.md"), "utf8"),
  ]);
  // Strip the `## Team` section from the cached team brief: each role gets
  // its own scoped mission+guardrails via roleBriefFor() in the dynamic block,
  // so re-listing all 5 roles in the cached block is duplicated tokens. Keep
  // `## Operating Rules` and `## Learning Loop` since those are cross-role
  // context every node still needs.
  const teamBrief = team
    .split(/^## /m)
    .filter((section) => {
      const head = section.split("\n", 1)[0].trim().toLowerCase();
      return head !== "team" && section.trim().length > 0;
    })
    .map((section) => section.startsWith("#") ? section : `## ${section}`)
    .join("")
    .replace(/^#.*$/gm, "")
    .split("\n")
    .filter((l) => l.trim())
    .join("\n");
  _cachedContext = { teamBrief, skillIntake, skillPlan };
  return _cachedContext;
}

// Dependency graph (declared per node). Used by the runner to compute
// execution waves: nodes whose deps are all satisfied run concurrently.
//   intake → triage → time_block_plan → { decision_log, follow_up_plan, operating_risks }
export const NODE_DEPS = Object.freeze({
  intake: [],
  triage: ["intake"],
  time_block_plan: ["intake", "triage"],
  decision_log: ["triage", "time_block_plan"],
  follow_up_plan: ["triage", "time_block_plan"],
  operating_risks: ["triage", "time_block_plan"],
});

export function planExecutionWaves(nodeKeys, deps = NODE_DEPS) {
  const remaining = new Set(nodeKeys);
  const done = new Set();
  const waves = [];
  while (remaining.size > 0) {
    const wave = [];
    for (const k of remaining) {
      const ds = deps[k] ?? [];
      if (ds.every((d) => done.has(d) || !nodeKeys.includes(d))) wave.push(k);
    }
    if (wave.length === 0) {
      throw new Error(`planExecutionWaves: dependency cycle or missing dep among [${[...remaining].join(",")}]`);
    }
    for (const k of wave) {
      remaining.delete(k);
      done.add(k);
    }
    waves.push(wave);
  }
  return waves;
}

export function buildNodes(skills) {
  return [
    {
      key: "intake",
      name: "Context intake",
      skill: skills.skillIntake,
      schema: {
        type: "object",
        properties: {
          weekOf: { type: "string" },
          ownerGoal: { type: "string" },
          fixedEvents: { type: "array" },
          flexibleEvents: { type: "array" },
          baseline: {
            type: "object",
            properties: {
              deepWorkHours: { type: "number" },
              adminHours: { type: "number" },
              contextSwitches: { type: "number" },
              openLoopRisk: { type: "string" },
            },
          },
          notes: { type: "array", items: { type: "string" } },
        },
        required: ["weekOf", "fixedEvents", "flexibleEvents", "baseline"],
      },
      instructions:
        "Apply the schedule-intake skill. Separate fixed from flexible events, label each by type, compute baseline metrics, and list any missing-data items.",
    },
    {
      key: "triage",
      name: "Priority triage",
      schema: {
        type: "object",
        properties: {
          topThree: {
            type: "array",
            items: {
              type: "object",
              properties: {
                outcome: { type: "string" },
                owner: { type: "string" },
                leverageRationale: { type: "string" },
                dueBy: { type: "string" },
              },
            },
          },
          rejected: { type: "array", items: { type: "string" } },
          notes: { type: "array", items: { type: "string" } },
        },
        required: ["topThree"],
      },
      instructions:
        "Act as the Priority Strategist. From the schedule and goal, pick the three weekly outcomes with the highest leverage. Reject low-yield commitments by name.",
    },
    {
      key: "time_block_plan",
      name: "Time architect",
      skill: skills.skillPlan,
      schema: {
        type: "object",
        properties: {
          blocks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                day: { type: "string" },
                start: { type: "string" },
                end: { type: "string" },
                mode: { type: "string" },
                why: { type: "string" },
              },
              required: ["day", "start", "end", "mode"],
            },
          },
          protectedHours: { type: "number" },
          contextSwitches: { type: "number" },
          tradeoffs: { type: "array", items: { type: "string" } },
        },
        required: ["blocks"],
      },
      instructions:
        "Act as the Calendar Architect. Use the 100x-productivity-planning skill. Protect peak-energy blocks, batch admin, and produce 5-9 named blocks for the week. Note any tradeoff that overrides a fixed event (require approval).",
    },
    {
      key: "decision_log",
      name: "Decision prep",
      schema: {
        type: "object",
        properties: {
          decisions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                options: { type: "array", items: { type: "string" } },
                recommendation: { type: "string" },
                status: { type: "string" },
                owner: { type: "string" },
              },
            },
          },
        },
        required: ["decisions"],
      },
      instructions:
        "Prepare 1-3 decision log entries for the week's blocked or pending decisions. Each must include options, a recommendation, and a status.",
    },
    {
      key: "follow_up_plan",
      name: "Follow-up planner",
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                owner: { type: "string" },
                action: { type: "string" },
                dueBy: { type: "string" },
                channel: { type: "string" },
              },
              required: ["owner", "action"],
            },
          },
          missingOwners: { type: "array", items: { type: "string" } },
        },
        required: ["items"],
      },
      instructions:
        "Act as the Follow-up Operator. Draft owner-specific follow-ups for the week. Use 'MISSING' when no owner exists and surface it in missingOwners.",
    },
    {
      key: "operating_risks",
      name: "Operating risk check",
      schema: {
        type: "object",
        properties: {
          risks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                risk: { type: "string" },
                severity: { type: "string", enum: ["low", "medium", "high"] },
                mitigation: { type: "string" },
              },
              required: ["risk", "severity"],
            },
          },
          unverifiedClaims: { type: "array", items: { type: "string" } },
        },
        required: ["risks"],
      },
      instructions:
        "Act as the Honesty Auditor. Flag missing owners, blocked decisions, overloaded calendars, and any productivity claims not tied to an observable metric.",
    },
  ];
}

export function buildBrief({ model, transcript }) {
  const blocks = transcript.nodes.time_block_plan?.parsed?.blocks ?? [];
  const top = transcript.nodes.triage?.parsed?.topThree ?? [];
  const risks = transcript.nodes.operating_risks?.parsed?.risks ?? [];
  // Show the cascade winner per node so the brief is honest about provenance.
  const winners = Object.entries(transcript.nodes)
    .map(([k, n]) => `- ${k}: ${n.provider ?? "?"}/${n.model ?? "?"} (${n.lane ?? "?"})`)
    .join("\n");
  return [
    `# Weekly Operating Brief`,
    ``,
    `Headline model: ${model}`,
    `Generated: ${transcript.startedAt}`,
    ``,
    `Per-node provider/model:`,
    winners,
    ``,
    `## Top 3 leverage outcomes`,
    ...top.map(
      (t, i) =>
        `${i + 1}. **${t.outcome ?? "?"}** — owner: ${t.owner ?? "?"} · due ${t.dueBy ?? "?"}\n   _${t.leverageRationale ?? ""}_`,
    ),
    ``,
    `## Time blocks`,
    ...blocks.map(
      (b) => `- **${b.day} ${b.start}-${b.end}** · ${b.mode} — ${b.why ?? ""}`,
    ),
    ``,
    `## Operating risks`,
    ...risks.map(
      (r) => `- [${r.severity}] ${r.risk}${r.mitigation ? ` → ${r.mitigation}` : ""}`,
    ),
  ].join("\n");
}

/**
 * Find promoted lessons from the most recent prior run's `learning-ledger.json`.
 *
 * Convention:
 *   - We look in the PARENT directory of `runDir` for sibling run-dirs.
 *   - Inside each sibling, we look for `learning-ledger.json`.
 *   - We pick the sibling with the most recent ledger mtime (excluding runDir
 *     itself).
 *   - Promoted entries are those with `status === "promoted"` (top-level array)
 *     OR entries inside `{ promoted: [...] }`. Both shapes are tolerated.
 *
 * Returns up to `limit` lesson strings (default 2). Returns [] silently on any
 * error or absent file — the runner must work even on the first ever run.
 */
export async function loadPromotedLessons(runDir, limit = 2) {
  try {
    const parent = dirname(runDir);
    let entries;
    try { entries = await readdir(parent, { withFileTypes: true }); } catch { return []; }

    const candidates = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = join(parent, e.name);
      if (resolve(dir) === resolve(runDir)) continue; // exclude self
      const ledger = join(dir, "learning-ledger.json");
      try {
        const s = await stat(ledger);
        candidates.push({ ledger, mtime: s.mtimeMs });
      } catch {}
    }
    if (candidates.length === 0) return [];
    candidates.sort((a, b) => b.mtime - a.mtime);

    const text = await readFile(candidates[0].ledger, "utf8");
    let parsed;
    try { parsed = JSON.parse(text); } catch { return []; }

    let promoted = [];
    if (Array.isArray(parsed)) {
      promoted = parsed.filter((x) => x && x.status === "promoted");
    } else if (parsed && Array.isArray(parsed.promoted)) {
      promoted = parsed.promoted;
    } else if (parsed && Array.isArray(parsed.entries)) {
      promoted = parsed.entries.filter((x) => x && x.status === "promoted");
    }
    return promoted
      .slice(0, limit)
      .map((p) => (typeof p === "string" ? p : (p?.lesson ?? p?.text ?? p?.summary ?? "")))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * OpenAI strict json_schema mode requires:
 *   - every property listed in `required`
 *   - additionalProperties: false on every object
 * Our node.schema definitions are looser. This walker tightens them in a copy
 * so we don't mutate the source. Non-object subtrees are returned as-is.
 */
function openaiCompatibleSchema(schema) {
  if (schema == null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(openaiCompatibleSchema);
  const out = { ...schema };
  if (out.type === "object" && out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([k, v]) => [k, openaiCompatibleSchema(v)]),
    );
    out.required = Object.keys(out.properties);
    out.additionalProperties = false;
  }
  if (out.type === "array" && out.items) {
    out.items = openaiCompatibleSchema(out.items);
  }
  return out;
}

async function runOneNode({
  node,
  ctx,
  policy,
  modelOverride,
  goalsRaw,
  scheduleRaw,
  timeoutMs,
  onEvent,
  runDir,
  transcript,
}) {
  onEvent({ type: "node-start", key: node.key, name: node.name, role: node.role });

  // If the role attached to this node demands a different tier than the node
  // ships with, re-resolve the cascade against a sibling node of that tier.
  // Honesty Auditor pins synthesis even when its node is already synthesis;
  // the lookup is idempotent in that case.
  let cascadeKey = node.key;
  if (node.tierOverride) {
    const sibling = nodeKeyForTier(node.tierOverride);
    if (sibling) cascadeKey = sibling;
  }
  // MLX-first: drop an unhealthy local lane (mlx then ollama) just as a missing
  // cloud key drops a cloud lane. Probe is cached per process.
  const localHealth = await getLocalHealth();
  const cascade = resolveCascade(cascadeKey, policy, modelOverride, process.env, localHealth);

  // Build the system prompt as Anthropic-style blocks. The static parts
  // (HARD_RULES + team brief) carry cache_control:ephemeral so Anthropic's
  // 5-minute prompt cache applies; the per-node parts (role line, skill,
  // any role-scoped extras) are NOT cached.
  //
  // Non-Anthropic providers concatenate the blocks into a single string
  // (handled inside each provider). The structure is uniform across providers.
  const cachedStatic = [
    HARD_RULES,
    `Team context:\n${ctx.teamBrief}`,
  ].join("\n\n");
  const dynamicPerNode = [
    `Role: ${node.roleName ?? node.name}.`,
    node.roleBrief ? node.roleBrief : "",
    node.skill ? `Skill guidance:\n${node.skill.trim()}` : "",
  ].filter(Boolean).join("\n\n");

  const system = [
    { type: "text", text: cachedStatic, cache_control: { type: "ephemeral" } },
    { type: "text", text: dynamicPerNode },
  ];

  // Inject promoted lessons only into triage and time_block_plan if any are
  // attached on the node (the runner sets these from a learning ledger if
  // present).
  if (node.promotedLessons && node.promotedLessons.length > 0) {
    system.push({
      type: "text",
      text: `Promoted lessons from prior runs (apply where relevant):\n${node.promotedLessons.map((l, i) => `${i + 1}. ${l}`).join("\n")}`,
    });
  }

  // Schedule input may arrive as JSON (legacy / power-user path) or as a
  // free-text description (natural-language path from the /cos UI). We label
  // it neutrally and instruct the model to handle either; the intake node
  // normalizes both shapes into structured JSON before downstream nodes run.
  const looksLikeJson = /^\s*[\[{]/.test(scheduleRaw);
  const scheduleLabel = looksLikeJson
    ? "Schedule input (JSON):"
    : "Schedule input (free text — describe events, times, owners; one event per line is fine):";

  const userMsg = [
    node.instructions,
    "",
    "User goal:",
    goalsRaw,
    "",
    scheduleLabel,
    scheduleRaw,
    "",
    "Output schema (JSON):",
    JSON.stringify(node.schema),
    "",
    "Return ONLY the JSON object.",
  ].join("\n");

  const t0 = Date.now();
  const { envelope, step } = await runCascade({
    node,
    cascade,
    system,
    userMsg,
    jsonSchema: openaiCompatibleSchema(node.schema),
    jsonSchemaName: `${node.key}_output`,
    role: node.role ?? null,
    timeoutMs,
    onEvent,
    // Telemetry seam: the package emits domain-free records; bind them to this
    // run's JSONL destination. The package's chat() is the SAME module instance
    // the test's setChatImpl() mutates, so no chat injection is needed.
    recordTelemetry: (rec) => recordTelemetry(runDir, rec),
  });
  const ms = Date.now() - t0;

  if (envelope.ok && envelope.parsed != null) {
    transcript.nodes[node.key] = {
      name: node.name,
      role: node.role ?? null,
      roleName: node.roleName ?? null,
      durationMs: ms,
      startedAt: new Date(t0).toISOString(),
      endedAt: new Date(t0 + ms).toISOString(),
      parsed: envelope.parsed,
      raw: envelope.text,
      provider: step.provider,
      model: step.model,
      lane: step.lane,
    };
    onEvent({
      type: "node-end",
      key: node.key,
      name: node.name,
      durationMs: ms,
      bytes: envelope.text?.length ?? 0,
      parsed: true,
      provider: step.provider,
      model: step.model,
      lane: step.lane,
      result: envelope.parsed,
    });
  } else {
    transcript.nodes[node.key] = {
      name: node.name,
      durationMs: ms,
      startedAt: new Date(t0).toISOString(),
      endedAt: new Date(t0 + ms).toISOString(),
      error: envelope.error ?? "cascade failed",
      provider: envelope.provider ?? null,
      model: envelope.model ?? null,
      lane: step?.lane ?? null,
    };
    onEvent({
      type: "node-error",
      key: node.key,
      name: node.name,
      durationMs: ms,
      error: envelope.error ?? "cascade failed",
      provider: envelope.provider ?? null,
      model: envelope.model ?? null,
    });
  }
}

async function runWarmup({ nodes, policy, modelOverride, timeoutMs, runDir, onEvent }) {
  // Skip entirely when forced cloud-first.
  if (policy.allowCloud === "always" && !modelOverride) return;

  // Determine the target: user-override wins, else the smallest model that
  // appears anywhere in the parse-tier cascade across nodes. We pick the
  // smallest by name length as a crude proxy for parameter count
  // (qwen3:8b-q4_K_M < gemma4:26b). Fallback: the first node's local primary.
  let target;
  if (modelOverride) {
    target = { provider: modelOverride.provider ?? "ollama", model: modelOverride.model };
  } else {
    // Warmup is an Ollama-specific concept (mlx_lm.server loads its own model at
    // startup). Collect the OLLAMA model ids across each node's tier from the
    // shared tier table and pre-load the smallest.
    const candidates = [];
    for (const n of nodes) {
      const tier = NODE_ROUTING[n.key]?.tier;
      const m = tier ? TIER_LOCAL_MODELS[tier] : null;
      if (m?.ollama) candidates.push({ provider: "ollama", model: m.ollama });
      if (m?.ollamaFallback) candidates.push({ provider: "ollama", model: m.ollamaFallback });
    }
    // Prefer the smallest local model. "llama3.2:3b" < "qwen3:8b-q4_K_M" < "gemma4:26b".
    const score = (m) => {
      const s = m?.model ?? "";
      const num = Number((s.match(/(\d+)b/i) ?? [])[1]);
      return Number.isFinite(num) ? num : 999;
    };
    candidates.sort((a, b) => score(a) - score(b));
    target = candidates[0]
      ? { provider: candidates[0].provider, model: candidates[0].model }
      : null;
  }
  if (!target?.model) return;

  // If Ollama already has the target loaded, skip warmup.
  if (target.provider === "ollama") {
    try {
      const ps = await ollamaPs();
      const loaded = (ps?.models ?? []).map((m) => m.name ?? m.model ?? "");
      if (loaded.includes(target.model)) {
        onEvent({ type: "warmup-skip", provider: target.provider, model: target.model, reason: "already-loaded" });
        recordTelemetry(runDir, {
          node: "_warmup",
          role: null,
          attempt: 0,
          lane: "warmup",
          provider: target.provider,
          model: target.model,
          tokens_in: null,
          tokens_out: null,
          cache_read_tokens: null,
          cache_write_tokens: null,
          ms: 0,
          parsed_ok: true,
          fallback_reason: null,
          parse_retry: false,
          skipped: true,
          skip_reason: "already-loaded",
        });
        return;
      }
    } catch {
      // fall through to actual warmup
    }
  }

  onEvent({ type: "warmup", provider: target.provider, model: target.model });
  const t0 = Date.now();
  const w = await chat({
    provider: target.provider,
    model: target.model,
    system: "Reply with strict JSON only.",
    messages: [{ role: "user", content: 'Return {"ok":true}' }],
    timeoutMs: Math.min(timeoutMs, 120000),
  });
  recordTelemetry(runDir, {
    node: "_warmup",
    role: null,
    attempt: 1,
    lane: "warmup",
    provider: target.provider,
    model: target.model,
    tokens_in: w.tokens_in ?? null,
    tokens_out: w.tokens_out ?? null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    ms: Date.now() - t0,
    parsed_ok: !!(w.ok && w.parsed != null),
    fallback_reason: w.ok ? null : (w.reason ?? "unknown"),
    parse_retry: false,
    error: w.ok ? undefined : w.error,
  });
  onEvent(
    w.ok
      ? { type: "warmup-ok", provider: target.provider, model: target.model }
      : { type: "warmup-fail", provider: target.provider, model: target.model, error: w.error },
  );
}

export async function runChiefOfStaff({
  model,
  schedule,
  goals,
  onEvent = () => {},
  timeoutMs = 900000,
  // New: cascade controls
  allowCloud,
  maxCloudTokens,
  // New: optional override (e.g. legacy `--model qwen3:8b-q4_K_M` collapses cascade to a single step)
  modelOverride = null,
  // New: per-run telemetry destination
  runDir = ROOT,
}) {
  const ctx = await loadContext();
  const nodes = buildNodes({
    skillIntake: ctx.skillIntake,
    skillPlan: ctx.skillPlan,
  });
  // Attach role metadata + scoped brief to each node. `intake` and any node
  // not mapped in NODE_ROLE keep role=null and use their own instructions.
  for (const n of nodes) {
    n.role = NODE_ROLE[n.key] ?? null;
    n.roleName = roleNameFor(n.key);
    n.roleBrief = roleBriefFor(n.key);
    n.tierOverride = effectiveTierOverride(n.key);
  }
  const goalsRaw = (goals ?? "").trim() || DEFAULT_GOAL;
  const scheduleRaw =
    (schedule ?? "").trim() || (await readFile(SAMPLE_INPUT, "utf8"));

  const policy = cascadePolicy({ allowCloud, maxCloudTokens });

  const transcript = {
    startedAt: new Date().toISOString(),
    headlineModel: model ?? null,
    policy,
    modelOverride,
    nodes: {},
  };

  // Load promoted lessons from prior runs and attach them to triage +
  // time_block_plan ONLY (those are where strategic lessons matter most).
  const lessons = await loadPromotedLessons(runDir, 2);
  if (lessons.length > 0) {
    const targetNodes = ["triage", "time_block_plan"];
    for (const n of nodes) {
      if (targetNodes.includes(n.key)) {
        n.promotedLessons = lessons;
      }
    }
    // `lessons-loaded` (legacy, count-only) for back-compat with existing
    // CLI listeners. `lesson-loaded` (new, plural payload) carries the full
    // lesson texts + which nodes received them so the UI can show what was
    // injected this run.
    onEvent({ type: "lessons-loaded", count: lessons.length });
    onEvent({
      type: "lesson-loaded",
      lessons,
      nodes: targetNodes,
    });
  }
  transcript.lessonsLoaded = lessons.length;
  recordTelemetry(runDir, {
    node: "_run",
    role: null,
    attempt: 0,
    lane: "meta",
    provider: null,
    model: null,
    tokens_in: null,
    tokens_out: null,
    cache_read_tokens: null,
    cache_write_tokens: null,
    ms: 0,
    parsed_ok: true,
    fallback_reason: null,
    parse_retry: false,
    lessons_loaded: lessons.length,
  });

  // Smart warmup: skip when override is set, when allow-cloud=always, when the
  // target parse-tier model is already loaded in Ollama, or when we cannot
  // determine a local target. Otherwise, warm up the SMALLEST model in the
  // first node's cascade so the first real call doesn't pay model-load cost
  // on a large synthesis-tier weight.
  await runWarmup({ nodes, policy, modelOverride, timeoutMs, runDir, onEvent });

  // Run nodes in dependency-ordered waves, parallelizing within each wave.
  const waves = planExecutionWaves(nodes.map((n) => n.key));
  const nodeByKey = Object.fromEntries(nodes.map((n) => [n.key, n]));
  for (const wave of waves) {
    await Promise.all(
      wave.map(async (key) => {
        const node = nodeByKey[key];
        await runOneNode({
          node,
          ctx,
          policy,
          modelOverride,
          goalsRaw,
          scheduleRaw,
          timeoutMs,
          onEvent,
          runDir,
          transcript,
        });
      }),
    );
  }

  await flushTelemetry();
  const brief = buildBrief({ model: model ?? "(cascade)", transcript });

  // `run-summary` mirrors the CLI digest. UI consumers use this to render
  // the TelemetryPanel without having to read the JSONL themselves.
  // `summarizeFile` tolerates a missing/empty file silently — this never
  // throws, so it cannot abort an otherwise-successful run.
  try {
    const summary = await summarizeFile(join(runDir, "telemetry.jsonl"));
    onEvent({ type: "run-summary", summary });
  } catch {
    // Defense in depth — summarizeFile already handles its own errors.
  }

  onEvent({ type: "complete", brief, transcript });
  return { transcript, brief };
}
