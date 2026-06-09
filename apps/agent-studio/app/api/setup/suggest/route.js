// POST /api/setup/suggest
//
// Pass 12 — Inline LLM-conversational setup.
//
// Body: { goal: string, preferredPattern?: "solo-tool-agent" | "approval-workflow"
//                                          | "research-orchestrator" | "evaluator-optimizer" }
//
// Response (200, JSON):
//   - { ok: true, name, pattern, summary, questions: [{ id, prompt, type, optional }] }
//   - { ok: false, reason: string }   // empty goal, Ollama unreachable, parse failure, etc.
//
// One non-streaming Ollama /api/chat round-trip with format:"json". The caller
// turns the returned shape into a chat-style question flow on the client. We
// stay grounded: the system prompt forbids filler questions and constrains the
// pattern field to one of four valid IDs.
//
// Defensive — never throws past the route boundary; surfaces all failure
// paths as { ok:false, reason } with a 200 status so the client can swap to
// the manual form without a fetch error.

export const runtime = "nodejs";

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_MODEL =
  (typeof process !== "undefined" && process.env && process.env.OLLAMA_MODEL) ||
  "gpt-oss:20b";

const VALID_PATTERNS = new Set([
  "solo-tool-agent",
  "approval-workflow",
  "research-orchestrator",
  "evaluator-optimizer",
]);

const QUESTION_TYPES = new Set(["text", "longtext"]);

function clampString(s, n) {
  if (typeof s !== "string") return "";
  return s.length > n ? s.slice(0, n) : s;
}

function buildSystemPrompt(preferredPattern) {
  const patternHint = preferredPattern && VALID_PATTERNS.has(preferredPattern)
    ? `The user clicked the "${preferredPattern}" pattern card before typing. Treat this as a soft preference: confirm it if the goal fits, override only if a different pattern clearly fits better.`
    : `The user has not pre-selected a pattern. Choose the smallest pattern that fits.`;

  return [
    `You are setting up a local agent project. The user has typed a one-line goal.`,
    `Return ONE JSON object — no prose, no code fences — with EXACTLY these keys:`,
    `  name:     string, kebab-case-ish display name describing the agent (≤40 chars).`,
    `  pattern:  one of "solo-tool-agent" | "approval-workflow" | "research-orchestrator" | "evaluator-optimizer".`,
    `  summary:  one sentence that restates the user's goal back to them.`,
    `  questions: 1 to 3 clarifying questions, ordered by importance.`,
    ``,
    `Rules:`,
    `- Each question must materially change the project. NO filler ("what's your name?", "what's your favorite color?"). NO restating the goal.`,
    `- Each question is an object: { id: snake_case string, prompt: string, type: "text" | "longtext", optional: boolean }.`,
    `- Use type "longtext" for questions that expect a paragraph; "text" for one-line answers.`,
    `- Mark a question optional:true ONLY if the project can succeed without it.`,
    `- Question id conventions (use these exact ids when applicable so the client can route answers to the right field):`,
    `    "context"     — background, prior decisions, constraints (longtext)`,
    `    "outcome"     — what success or done looks like (longtext)`,
    `    "background"  — alias for context if you need a second context-flavored question`,
    `- Pattern guidance:`,
    `    solo-tool-agent       — one agent + a few tools, narrow scope, single user.`,
    `    approval-workflow     — deterministic steps with a human gate before side effects.`,
    `    research-orchestrator — branch out into sub-questions, gather evidence, synthesize.`,
    `    evaluator-optimizer   — generate-then-critique-then-revise loop.`,
    `- ${patternHint}`,
    `- Keep "name" specific. Avoid "agent assistant" or "helper". Prefer naming the actor and the job.`,
    ``,
    `Output ONLY the JSON object. No markdown.`,
  ].join("\n");
}

function normalizeQuestion(q) {
  if (!q || typeof q !== "object") return null;
  const id = typeof q.id === "string" && q.id.trim() ? q.id.trim().slice(0, 64) : null;
  const prompt = typeof q.prompt === "string" && q.prompt.trim() ? q.prompt.trim() : null;
  let type = typeof q.type === "string" ? q.type.toLowerCase() : "text";
  if (!QUESTION_TYPES.has(type)) type = "text";
  const optional = q.optional === true;
  if (!id || !prompt) return null;
  return { id, prompt: clampString(prompt, 280), type, optional };
}

function normalizeShape(parsed, fallbackGoal) {
  if (!parsed || typeof parsed !== "object") return null;
  const name = typeof parsed.name === "string" && parsed.name.trim()
    ? clampString(parsed.name.trim(), 40)
    : null;
  const pattern =
    typeof parsed.pattern === "string" && VALID_PATTERNS.has(parsed.pattern)
      ? parsed.pattern
      : null;
  const summary =
    typeof parsed.summary === "string" && parsed.summary.trim()
      ? clampString(parsed.summary.trim(), 240)
      : clampString(fallbackGoal, 240);
  const questionsIn = Array.isArray(parsed.questions) ? parsed.questions : [];
  const questions = questionsIn
    .map(normalizeQuestion)
    .filter(Boolean)
    .slice(0, 3);
  if (!name || !pattern || questions.length === 0) return null;
  return { name, pattern, summary, questions };
}

export async function POST(req) {
  let body = null;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, reason: "invalid JSON body" }, { status: 200 });
  }

  const goal = typeof body?.goal === "string" ? body.goal.trim() : "";
  if (!goal) {
    return Response.json({ ok: false, reason: "goal is required" }, { status: 200 });
  }
  if (goal.length > 2000) {
    return Response.json(
      { ok: false, reason: "goal too long (max 2000 chars)" },
      { status: 200 },
    );
  }

  const preferredPattern =
    typeof body?.preferredPattern === "string" && VALID_PATTERNS.has(body.preferredPattern)
      ? body.preferredPattern
      : null;

  const baseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.OLLAMA_MODEL || DEFAULT_MODEL;

  const messages = [
    { role: "system", content: buildSystemPrompt(preferredPattern) },
    { role: "user", content: `Goal: ${goal}` },
  ];

  let res;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: "json",
        options: { temperature: 0.2, num_ctx: 4096 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return Response.json(
      { ok: false, reason: `ollama unreachable: ${err?.message || "timeout"}` },
      { status: 200 },
    );
  }

  if (!res.ok) {
    return Response.json(
      { ok: false, reason: `ollama returned ${res.status}` },
      { status: 200 },
    );
  }

  let envelope;
  try {
    envelope = await res.json();
  } catch (err) {
    return Response.json(
      { ok: false, reason: `ollama response not JSON: ${err?.message || "parse error"}` },
      { status: 200 },
    );
  }

  const content =
    typeof envelope?.message?.content === "string" ? envelope.message.content : "";
  if (!content) {
    return Response.json(
      { ok: false, reason: "ollama returned empty content" },
      { status: 200 },
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return Response.json(
      { ok: false, reason: `model output was not JSON: ${err?.message || "parse error"}` },
      { status: 200 },
    );
  }

  const shape = normalizeShape(parsed, goal);
  if (!shape) {
    return Response.json(
      { ok: false, reason: "model output did not match required shape" },
      { status: 200 },
    );
  }

  return Response.json(
    {
      ok: true,
      name: shape.name,
      pattern: shape.pattern,
      summary: shape.summary,
      questions: shape.questions,
      // Surface whether we honored the preferred pattern so the client can
      // show a small note when the model overrode the user's pre-selection.
      preferredPattern,
      patternOverridden: !!(preferredPattern && preferredPattern !== shape.pattern),
    },
    { status: 200 },
  );
}
