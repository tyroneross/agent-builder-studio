// Doc-ingest emitted capability (follow-up item 01; supersedes item 06).
//
// When a generated agent's spec needs document input (PDF/xlsx/pptx -> LLM-
// ready text), the generator emits ONE canonical ingest surface backed by
// @tyroneross/omniparse: a `doc-ingest` tool slot in tools.json, a runnable
// runtime adapter, a skill-bank entry, and the npm dependency in the
// portable package.json. blog-content-scraper's ./llm subpath was the
// adjacent candidate; omniparse supersedes it for file parsing so generated
// agents never carry two overlapping ingest paths.

// Two-part detection: a document-format signal alone is NOT enough — specs
// like "pasted_earnings_pdf_text" mention pdf but receive pasted TEXT, not
// files. Doc-ingest fires only when a format signal co-occurs with a
// file-handling signal (or an explicitly strong signal appears).
const DOC_FORMAT_SIGNALS = [
  "pdf",
  "xlsx",
  "pptx",
  "spreadsheet",
  "slide deck",
  "powerpoint",
  "excel",
];

// Word-boundary regexes ("profile" must not hit "file"; "uploads" should hit).
const FILE_CONTEXT_RES = [
  /\buploads?(?:ed|ing)?\b/,
  /\bfiles?\b/,
  /\battach(?:ments?|ed)\b/,
  /\bdirectory\b/,
  /\bfolder\b/,
];

const STRONG_RES = [
  /\bfile uploads?\b/,
  /\buploaded files?\b/,
  /\bdoc input\b/,
  /\bdocument ingest(?:ion)?\b/,
  /\bingests?\b/,
  /\bparse files?\b/,
  /\battachments?\b/,
];

// Drop explicitly negated capability clauses ("without reading files",
// "never parses attachments") before signal matching.
function stripNegatedClauses(text) {
  return text.replace(/\b(?:without|never|no|not|cannot|can't)\s+(?:\w+\s+){0,3}?(?:read|reads|reading|parse|parses|parsing|access|accesses|accessing|ingest|ingests|ingesting)[^.\n]*/g, " ");
}

export function specText(spec) {
  return [
    spec.description,
    ...(spec.inputs ?? []),
    ...(spec.outputs ?? []),
    ...(spec.nodes ?? []).flatMap((n) => [n.title, n.description, ...(n.inputs ?? []), ...(n.outputs ?? [])]),
    ...(spec.tools ?? []).flatMap((t) => [t.name, t.responsibility]),
  ]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
}

export function detectDocIngest(spec) {
  const text = stripNegatedClauses(specText(spec));
  const strong = STRONG_RES.filter((re) => re.test(text)).map((re) => re.source);
  if (strong.length > 0) return { needed: true, signals: strong };
  const formats = DOC_FORMAT_SIGNALS.filter((s) => text.includes(s));
  const fileContext = FILE_CONTEXT_RES.filter((re) => re.test(text)).map((re) => re.source);
  const needed = formats.length > 0 && fileContext.length > 0;
  return { needed, signals: needed ? [...formats, ...fileContext] : [] };
}

export const DOC_INGEST_TOOL = Object.freeze({
  name: "doc-ingest",
  responsibility:
    "Convert document inputs (PDF, xlsx/xls/csv/ods, pptx, Python source, or a directory of them) into LLM-ready markdown/text via @tyroneross/omniparse. Canonical ingest surface — do not add parallel file-parsing paths.",
  sideEffect: "read",
  permission: "allow",
});

export function docIngestSkillEntry(manifest) {
  return {
    id: `${manifest.slug}-doc-ingest-skill`,
    type: "emitted-capability",
    title: "Document ingest skill",
    purpose: DOC_INGEST_TOOL.responsibility,
    whenToUse: "Load when a graph node receives a file path or directory instead of inline text.",
    inputs: ["file_path_or_directory"],
    outputs: ["markdown", "text", "estimated_tokens"],
    tools: ["doc-ingest"],
    permission: "allow",
    requiredFiles: ["runtime/doc-ingest.mjs", "tools.json"],
  };
}

// Emitted runtime adapter — real, runnable code against the published
// omniparse API (parse / parseMultiple / detectInputType verified against
// @tyroneross/omniparse@1.0.0 type definitions).
export function buildDocIngestRuntime() {
  return `// doc-ingest runtime adapter — canonical document-ingestion surface.
// Backed by @tyroneross/omniparse (declared in package.json). Routes
// .pdf / .xlsx / .xls / .csv / .ods / .pptx / .py / directories to the right
// parser and returns LLM-ready text. Unsupported inputs return a typed
// refusal instead of throwing, so graph nodes can degrade gracefully.

import { parse, parseMultiple, detectInputType } from "@tyroneross/omniparse";

export { detectInputType };

/**
 * Ingest one file or directory. Returns
 *   { ok, inputType, items: [{ fileName, markdown, text, estimatedTokens }], error? }
 */
export async function ingest(input, options = {}) {
  const inputType = detectInputType(input);
  if (inputType === "unsupported") {
    return { ok: false, inputType, items: [], error: \`unsupported input: \${input}\` };
  }
  const result = await parse(input, { quiet: true, ...options });
  const items = (Array.isArray(result) ? result : [result]).map((r) => ({
    fileName: r.fileName,
    inputType: r.inputType,
    markdown: r.markdown,
    text: r.text,
    estimatedTokens: r.estimatedTokens,
    errors: r.errors ?? [],
  }));
  return { ok: true, inputType, items };
}

/** Ingest many files in parallel (order preserved). */
export async function ingestMany(inputs, options = {}) {
  const results = await parseMultiple(inputs, { quiet: true, ...options });
  return {
    ok: true,
    items: results.map((r) => ({
      fileName: r.fileName,
      inputType: r.inputType,
      markdown: r.markdown,
      text: r.text,
      estimatedTokens: r.estimatedTokens,
      errors: r.errors ?? [],
    })),
  };
}
`;
}
