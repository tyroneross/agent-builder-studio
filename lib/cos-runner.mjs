import { readFile, readdir, stat } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chat, ollamaTags, ollamaPs } from "./providers/index.mjs";
import {
  NODE_ROUTING,
  cascadePolicy,
  resolveCascade,
  FAILURE_REASONS,
} from "./cos-config.mjs";
import { recordTelemetry, flushTelemetry } from "./cos-telemetry.mjs";

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
export { NODE_ROUTING, cascadePolicy, resolveCascade } from "./cos-config.mjs";

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
  const teamBrief = team
    .replace(/^#.*$/gm, "")
    .split("\n")
    .filter((l) => l.trim())
    .slice(0, 14)
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
 * Try one provider step for a node. Internally fires up to one parse-retry
 * if the first call returns ok=true but parsed=null. Returns the final
 * envelope plus a `parse_retry` flag and `ms`.
 */
async function tryStep({ step, system, userMsg, jsonSchema, jsonSchemaName, role, timeoutMs, onChunk, runDir, nodeKey, attempt }) {
  const t0 = Date.now();
  const first = await chat({
    provider: step.provider,
    model: step.model,
    system,
    messages: [{ role: "user", content: userMsg }],
    jsonSchema,
    jsonSchemaName,
    timeoutMs,
    onChunk,
  });
  const firstMs = Date.now() - t0;

  if (!first.ok) {
    recordTelemetry(runDir, {
      node: nodeKey,
      role: role ?? null,
      attempt,
      lane: step.lane,
      provider: step.provider,
      model: step.model,
      tokens_in: null,
      tokens_out: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
      ms: firstMs,
      parsed_ok: false,
      fallback_reason: first.reason ?? FAILURE_REASONS.UNKNOWN,
      parse_retry: false,
      error: first.error,
    });
    return { envelope: first, parseRetried: false };
  }

  if (first.parsed != null) {
    recordTelemetry(runDir, {
      node: nodeKey,
      role: role ?? null,
      attempt,
      lane: step.lane,
      provider: step.provider,
      model: step.model,
      tokens_in: first.tokens_in ?? null,
      tokens_out: first.tokens_out ?? null,
      cache_read_tokens: first.cache_read_tokens ?? null,
      cache_write_tokens: first.cache_write_tokens ?? null,
      ms: firstMs,
      parsed_ok: true,
      fallback_reason: null,
      parse_retry: false,
    });
    return { envelope: first, parseRetried: false };
  }

  // Parse-retry: prompt the same provider with the malformed output and a
  // hard "JSON only" suffix. Single retry, no further loop.
  recordTelemetry(runDir, {
    node: nodeKey,
    role: role ?? null,
    attempt,
    lane: step.lane,
    provider: step.provider,
    model: step.model,
    tokens_in: first.tokens_in ?? null,
    tokens_out: first.tokens_out ?? null,
    cache_read_tokens: first.cache_read_tokens ?? null,
    cache_write_tokens: first.cache_write_tokens ?? null,
    ms: firstMs,
    parsed_ok: false,
    fallback_reason: FAILURE_REASONS.PARSE,
    parse_retry: false,
  });

  const retryMsg = [
    "Your last response was not valid JSON. Return ONLY the JSON object below and nothing else.",
    "",
    "Previous (malformed) output:",
    first.text.slice(0, 4000),
    "",
    "Now return strict JSON for this request:",
    "",
    userMsg,
  ].join("\n");

  const t1 = Date.now();
  const second = await chat({
    provider: step.provider,
    model: step.model,
    system,
    messages: [{ role: "user", content: retryMsg }],
    jsonSchema,
    jsonSchemaName,
    timeoutMs,
    onChunk,
  });
  const secondMs = Date.now() - t1;

  if (!second.ok) {
    recordTelemetry(runDir, {
      node: nodeKey,
      role: role ?? null,
      attempt,
      lane: step.lane,
      provider: step.provider,
      model: step.model,
      tokens_in: null,
      tokens_out: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
      ms: secondMs,
      parsed_ok: false,
      fallback_reason: second.reason ?? FAILURE_REASONS.UNKNOWN,
      parse_retry: true,
      error: second.error,
    });
    return { envelope: second, parseRetried: true };
  }

  recordTelemetry(runDir, {
    node: nodeKey,
    role: role ?? null,
    attempt,
    lane: step.lane,
    provider: step.provider,
    model: step.model,
    tokens_in: second.tokens_in ?? null,
    tokens_out: second.tokens_out ?? null,
    cache_read_tokens: second.cache_read_tokens ?? null,
    cache_write_tokens: second.cache_write_tokens ?? null,
    ms: secondMs,
    parsed_ok: second.parsed != null,
    fallback_reason: second.parsed == null ? FAILURE_REASONS.PARSE : null,
    parse_retry: true,
  });
  return { envelope: second, parseRetried: true };
}

/**
 * Run the cascade for a single node. Returns the winning envelope (or the
 * last failure envelope if every step failed) plus the `lane` taken.
 */
async function runNodeCascade({ node, cascade, system, userMsg, jsonSchema, jsonSchemaName, role, timeoutMs, onEvent, runDir }) {
  let attempt = 0;
  let lastErr = null;
  for (const step of cascade) {
    attempt += 1;
    onEvent({
      type: "node-step",
      key: node.key,
      attempt,
      lane: step.lane,
      provider: step.provider,
      model: step.model,
    });
    const { envelope } = await tryStep({
      step,
      system,
      userMsg,
      jsonSchema,
      jsonSchemaName,
      role,
      timeoutMs,
      onChunk: (_chunk, totalBytes) =>
        onEvent({ type: "node-chunk", key: node.key, bytes: totalBytes }),
      runDir,
      nodeKey: node.key,
      attempt,
    });
    if (envelope.ok && envelope.parsed != null) {
      return { envelope, step };
    }
    lastErr = envelope;
  }
  return { envelope: lastErr ?? { ok: false, error: "no cascade steps" }, step: null };
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
  onEvent({ type: "node-start", key: node.key, name: node.name });

  const cascade = resolveCascade(node.key, policy, modelOverride);

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

  const userMsg = [
    node.instructions,
    "",
    "User goal:",
    goalsRaw,
    "",
    "Schedule input (JSON):",
    scheduleRaw,
    "",
    "Output schema (JSON):",
    JSON.stringify(node.schema),
    "",
    "Return ONLY the JSON object.",
  ].join("\n");

  const t0 = Date.now();
  const { envelope, step } = await runNodeCascade({
    node,
    cascade,
    system,
    userMsg,
    jsonSchema: openaiCompatibleSchema(node.schema),
    jsonSchemaName: `${node.key}_output`,
    role: node.role ?? null,
    timeoutMs,
    onEvent,
    runDir,
  });
  const ms = Date.now() - t0;

  if (envelope.ok && envelope.parsed != null) {
    transcript.nodes[node.key] = {
      name: node.name,
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
    const candidates = [];
    for (const n of nodes) {
      const r = NODE_ROUTING[n.key];
      if (r?.localPrimary) candidates.push(r.localPrimary);
      if (r?.localFallback) candidates.push(r.localFallback);
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
          attempt: 0,
          lane: "warmup",
          provider: target.provider,
          model: target.model,
          tokens_in: null,
          tokens_out: null,
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
    attempt: 1,
    lane: "warmup",
    provider: target.provider,
    model: target.model,
    tokens_in: w.tokens_in ?? null,
    tokens_out: w.tokens_out ?? null,
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
    for (const n of nodes) {
      if (n.key === "triage" || n.key === "time_block_plan") {
        n.promotedLessons = lessons;
      }
    }
    onEvent({ type: "lessons-loaded", count: lessons.length });
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
  onEvent({ type: "complete", brief, transcript });
  return { transcript, brief };
}
