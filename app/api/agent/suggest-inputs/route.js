// POST /api/agent/suggest-inputs
// Body: { project, nodeId, mode, model? }
//   - mode: "plain" | "structured" | "json"
//   - "plain"      → returns { ok, suggestion: string }   — a one-paragraph
//                    test query the user can paste into the prose textarea.
//   - "structured" → returns { ok, suggestion: object }   — keys mirror the
//                    node's declared `inputs[]` tags; values are realistic
//                    example strings.
//   - "json"       → returns { ok, suggestion: object }   — fixture-shaped
//                    JSON the runtime would accept; uses declared inputs
//                    when present, otherwise infers a plausible shape from
//                    role/description/instructions.
//
// Purpose: the Solo Run modal needs a low-friction way to demo a node when
// the user doesn't have a sample input handy. We send the node's role +
// description + instructions + declared inputs to Ollama with format:json,
// temperature 0, ask for one example, return it. No streaming. No project
// state mutation. No transcript writes.
//
// Failure mode: any Ollama error returns { ok: false, error } so the modal
// can render a small "couldn't reach model" hint without breaking the
// existing manual-entry path.

export const runtime = "nodejs";

const DEFAULT_BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gpt-oss:20b";

const VALID_MODES = new Set(["plain", "structured", "json"]);

function buildPrompt(node, project, mode) {
  const declared = Array.isArray(node?.inputs) ? node.inputs.filter(Boolean) : [];
  const role = typeof node?.role === "string" ? node.role : "agent";
  const title = typeof node?.title === "string" ? node.title : node?.id || "node";
  const description =
    typeof node?.description === "string" && node.description.trim()
      ? node.description.trim()
      : "";
  const instructions =
    typeof node?.instructions === "string" && node.instructions.trim()
      ? node.instructions.trim()
      : "";
  const projectGoal =
    typeof project?.goal === "string" && project.goal.trim() ? project.goal.trim() : "";

  const sys = [
    "You generate one realistic example of test input for a single node in an agent graph.",
    "The user wants to see the node run end-to-end. Make the example specific, plausible, and short.",
    "Do not explain. Do not wrap in prose. Output ONLY the JSON object specified below.",
  ].join(" ");

  const lines = [];
  lines.push(`Node title: ${title}`);
  lines.push(`Node role: ${role}`);
  if (description) lines.push(`Node description: ${description}`);
  if (instructions) lines.push(`Node instructions:\n${instructions}`);
  if (projectGoal) lines.push(`Project goal (for context): ${projectGoal}`);
  if (declared.length) {
    lines.push(`Declared input tags: ${declared.join(", ")}`);
  } else {
    lines.push("Declared input tags: none (free-form input)");
  }

  if (mode === "plain") {
    lines.push("");
    lines.push(
      'Return JSON of the form: {"suggestion": "<one short paragraph the user could paste as a free-form prompt to this node>"}',
    );
    lines.push("Keep the suggestion under 80 words. Plain prose, no markdown, no JSON inside it.");
  } else if (mode === "structured") {
    lines.push("");
    if (declared.length) {
      lines.push(
        `Return JSON of the form: {"suggestion": { ${declared
          .map((t) => `"${t}": "<realistic example value for ${t}>"`)
          .join(", ")} }}`,
      );
      lines.push(
        "Each value must be a non-empty string under 200 chars. Use only the keys listed.",
      );
    } else {
      lines.push(
        'This node has no declared input tags, so return: {"suggestion": {"input": "<one short prose example>"}}',
      );
    }
  } else {
    // json
    lines.push("");
    if (declared.length) {
      lines.push(
        `Return JSON of the form: {"suggestion": { ${declared
          .map((t) => `"${t}": <plausible example for ${t}; string or small object>`)
          .join(", ")} }}`,
      );
      lines.push(
        "Prefer strings. Use a nested object only if the node clearly expects structured data.",
      );
    } else {
      lines.push(
        'This node has no declared input tags. Return: {"suggestion": { "<inferred_field>": <example> }} with one or two fields you infer from the description and instructions.',
      );
    }
  }

  return [
    { role: "system", content: sys },
    { role: "user", content: lines.join("\n") },
  ];
}

function sanitize(parsed, mode, node) {
  if (!parsed || typeof parsed !== "object") return null;
  const raw = parsed.suggestion;
  if (raw == null) return null;

  if (mode === "plain") {
    if (typeof raw !== "string") return null;
    return raw.trim().slice(0, 4000);
  }

  // structured / json — must be a plain object.
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const declared = Array.isArray(node?.inputs) ? node.inputs.filter(Boolean) : [];

  // For structured mode, restrict keys to declared tags (when any).
  if (mode === "structured" && declared.length > 0) {
    const out = {};
    for (const tag of declared) {
      const v = raw[tag];
      if (v == null) {
        out[tag] = "";
        continue;
      }
      out[tag] = typeof v === "string" ? v.slice(0, 1000) : v;
    }
    return out;
  }

  // For json mode (or structured with no declared tags), keep the model's
  // shape but cap each top-level string to 1000 chars and drop functions.
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "function") continue;
    out[k] = typeof v === "string" ? v.slice(0, 1000) : v;
  }
  return out;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const project = body?.project;
  const nodeId = body?.nodeId;
  const mode = typeof body?.mode === "string" ? body.mode : "structured";
  const model =
    typeof body?.model === "string" && body.model ? body.model : DEFAULT_MODEL;

  if (!project || !project.canvas || !Array.isArray(project.canvas.nodes)) {
    return Response.json(
      { ok: false, error: "project with canvas required" },
      { status: 400 },
    );
  }
  if (!VALID_MODES.has(mode)) {
    return Response.json(
      { ok: false, error: `mode must be one of plain | structured | json` },
      { status: 400 },
    );
  }
  const node = project.canvas.nodes.find((n) => n?.id === nodeId);
  if (!node) {
    return Response.json({ ok: false, error: `node "${nodeId}" not found` }, { status: 404 });
  }

  const messages = buildPrompt(node, project, mode);

  let parsed = null;
  try {
    const res = await fetch(`${DEFAULT_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: "json",
        options: { temperature: 0, num_ctx: 4096 },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return Response.json({
        ok: false,
        error: `ollama returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      });
    }
    const json = await res.json();
    const content = json?.message?.content ?? "";
    try {
      parsed = JSON.parse(content);
    } catch {
      return Response.json({
        ok: false,
        error: "model did not return parseable JSON",
        raw: content.slice(0, 500),
      });
    }
  } catch (err) {
    return Response.json({
      ok: false,
      error: err?.message || "ollama unreachable",
    });
  }

  const suggestion = sanitize(parsed, mode, node);
  if (suggestion == null || (typeof suggestion === "string" && suggestion === "")) {
    return Response.json({
      ok: false,
      error: "model returned an empty or malformed suggestion",
    });
  }

  return Response.json({ ok: true, mode, suggestion });
}
