// POST /api/fs/read-spec
// Body (application/json): { specDir: string }
//
// Pass 17 — read an existing agent-spec/v1 directory off disk and return
// `{ ok: true, files: [{path, content}] }` so the canvas page can call
// `importSpecToProject(files)` to reconstruct the project.
//
// Same allowlist + traversal protections as the rest of the fs/* routes.
// We walk the directory recursively but cap file count + total bytes so a
// hostile or absent-minded directory can't OOM the route.

import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const PERMITTED_PREFIXES = ["/Users/", "/tmp/", "/var/folders/"];
const MAX_FILES = 64;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
// Filename allowlist mirrors agent-spec/v1's CORE_FILES set so a stray
// .DS_Store / `.git/` etc. inside the spec dir doesn't bleed through.
const CORE_FILE_ALLOWLIST = new Set([
  "agent.yaml",
  "manifest.json",
  "system-prompt.md",
  "tools.json",
  "evals/golden-tasks.json",
  "evals/regression-scenarios.json",
  "memory/domain-playbook.md",
  "memory/learning-ledger.json",
  "README.md",
  "sources.md",
]);

function isPermittedFolder(absolute) {
  return PERMITTED_PREFIXES.some(
    (prefix) => absolute.startsWith(prefix) || absolute + "/" === prefix,
  );
}

async function* walkFiles(rootAbs, rel = "") {
  const here = rel ? path.join(rootAbs, rel) : rootAbs;
  let entries;
  try {
    entries = await fs.readdir(here, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // skip dotfiles like .DS_Store
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      yield* walkFiles(rootAbs, childRel);
    } else if (e.isFile()) {
      yield childRel;
    }
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "expected application/json body" }, { status: 400 });
  }
  const { specDir: rawDir } = body || {};
  if (typeof rawDir !== "string" || !rawDir.startsWith("/")) {
    return Response.json({ ok: false, error: "absolute specDir required" }, { status: 400 });
  }
  const specDir = path.resolve(rawDir);
  if (!isPermittedFolder(specDir)) {
    return Response.json({ ok: false, error: "specDir outside permitted root" }, { status: 400 });
  }

  let stat;
  try {
    stat = await fs.stat(specDir);
  } catch (err) {
    return Response.json({ ok: false, error: `cannot stat specDir: ${err?.message}` }, { status: 404 });
  }
  if (!stat.isDirectory()) {
    return Response.json({ ok: false, error: "specDir is not a directory" }, { status: 400 });
  }

  const files = [];
  let totalBytes = 0;
  for await (const rel of walkFiles(specDir)) {
    if (files.length >= MAX_FILES) {
      return Response.json({ ok: false, error: `too many files (cap ${MAX_FILES})` }, { status: 400 });
    }
    if (!CORE_FILE_ALLOWLIST.has(rel)) {
      // Silently skip unknown files. evals/transcripts/ + future additions
      // can be added when needed.
      continue;
    }
    const abs = path.join(specDir, rel);
    let content;
    try {
      content = await fs.readFile(abs, "utf8");
    } catch (err) {
      return Response.json({ ok: false, error: `read ${rel}: ${err?.message}` }, { status: 500 });
    }
    totalBytes += Buffer.byteLength(content, "utf8");
    if (totalBytes > MAX_TOTAL_BYTES) {
      return Response.json({ ok: false, error: `total spec size exceeds cap (${MAX_TOTAL_BYTES})` }, { status: 400 });
    }
    files.push({ path: rel, content });
  }
  if (files.length === 0) {
    return Response.json({ ok: false, error: "no agent-spec/v1 files found in specDir" }, { status: 404 });
  }
  return Response.json({ ok: true, files, totalBytes });
}
