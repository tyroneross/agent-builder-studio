// POST /api/fs/write-spec
// Body (application/json):
//   { workingFolder: string, files: [{ path: string, content: string }] }
//
// Pass 17 — write the 10-file agent-spec/v1 directory atomically to
// `<workingFolder>/spec/`. Atomicity rule:
//   1. Stage every file under `<workingFolder>/spec.tmp/<i>/` (relative
//      paths preserved).
//   2. After all files write successfully, swap: rename existing
//      `<workingFolder>/spec/` → `<workingFolder>/spec.previous/`,
//      rename `<workingFolder>/spec.tmp/` → `<workingFolder>/spec/`,
//      delete `<workingFolder>/spec.previous/`.
//   3. On any failure mid-stage, the partial spec.tmp is removed; the live
//      `spec/` directory is never touched.
//
// Same allowlist + path-traversal protections as /api/fs/write-markdown.
//
// Response:
//   - success:  { ok: true, savedDir, fileCount, totalBytes }
//   - rejected: { ok: false, error: string }

import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const PERMITTED_PREFIXES = ["/Users/", "/tmp/", "/var/folders/"];
// Per-file cap (4 MB) and total spec cap (16 MB). Specs are mostly text;
// these ceilings exist as a safety belt for the route, not a contract.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;

function isPermittedFolder(absolute) {
  return PERMITTED_PREFIXES.some(
    (prefix) => absolute.startsWith(prefix) || absolute + "/" === prefix,
  );
}

// Reject paths that would escape the spec/ directory. Each path segment
// must be a plain basename (no `..`, no leading `/`, no `\0`, no `\\`).
function sanitizeRelativePath(rel) {
  if (typeof rel !== "string" || rel.length === 0) return null;
  // No absolute paths.
  if (rel.startsWith("/")) return null;
  // No backslashes (we're targeting POSIX-style relative paths).
  if (rel.includes("\\")) return null;
  if (rel.includes("\0")) return null;
  const parts = rel.split("/");
  for (const seg of parts) {
    if (seg === "" || seg === "." || seg === "..") return null;
  }
  return parts.join("/");
}

async function rmDirRecursive(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* swallow */
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "expected application/json body" }, { status: 400 });
  }
  const { workingFolder: rawFolder, files } = body || {};

  if (typeof rawFolder !== "string" || !rawFolder.startsWith("/")) {
    return Response.json({ ok: false, error: "absolute workingFolder required" }, { status: 400 });
  }
  const workingFolder = path.resolve(rawFolder);
  if (!isPermittedFolder(workingFolder)) {
    return Response.json({ ok: false, error: "workingFolder outside permitted root" }, { status: 400 });
  }
  if (!Array.isArray(files) || files.length === 0) {
    return Response.json({ ok: false, error: "files (non-empty array) required" }, { status: 400 });
  }

  // Validate + tally bytes upfront so we don't half-write a too-large spec.
  let totalBytes = 0;
  const cleaned = [];
  for (const entry of files) {
    if (!entry || typeof entry !== "object") {
      return Response.json({ ok: false, error: "every file entry must be an object" }, { status: 400 });
    }
    const safeRel = sanitizeRelativePath(entry.path);
    if (!safeRel) {
      return Response.json({ ok: false, error: `bad relative path: ${entry.path}` }, { status: 400 });
    }
    if (typeof entry.content !== "string") {
      return Response.json({ ok: false, error: `${safeRel}: content must be a string` }, { status: 400 });
    }
    const buf = Buffer.from(entry.content, "utf8");
    if (buf.length > MAX_FILE_BYTES) {
      return Response.json({ ok: false, error: `${safeRel}: exceeds per-file cap (${MAX_FILE_BYTES} bytes)` }, { status: 400 });
    }
    totalBytes += buf.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return Response.json({ ok: false, error: `total spec size exceeds cap (${MAX_TOTAL_BYTES} bytes)` }, { status: 400 });
    }
    cleaned.push({ rel: safeRel, buf });
  }

  // mkdir -p the working folder + a fresh spec.tmp staging dir.
  try {
    await fs.mkdir(workingFolder, { recursive: true });
  } catch (err) {
    return Response.json({ ok: false, error: `mkdir workingFolder: ${err?.message}` }, { status: 500 });
  }

  const finalDir = path.join(workingFolder, "spec");
  const stagingDir = path.join(workingFolder, "spec.tmp");
  const previousDir = path.join(workingFolder, "spec.previous");

  await rmDirRecursive(stagingDir);
  await rmDirRecursive(previousDir);

  try {
    await fs.mkdir(stagingDir, { recursive: true });
    for (const { rel, buf } of cleaned) {
      const target = path.join(stagingDir, rel);
      // Defense-in-depth: confirm the resolved target stays under stagingDir.
      const resolved = path.resolve(target);
      if (!resolved.startsWith(stagingDir + path.sep) && resolved !== stagingDir) {
        throw new Error(`path escape attempt: ${rel}`);
      }
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, buf);
    }
  } catch (err) {
    await rmDirRecursive(stagingDir);
    return Response.json({ ok: false, error: err?.message || "stage failed" }, { status: 500 });
  }

  // Atomic-ish swap. fs.rename on macOS can fail with ENOTEMPTY on a
  // populated target; we swap via a previous/ holding directory.
  try {
    let liveExists = false;
    try {
      const stat = await fs.stat(finalDir);
      liveExists = stat.isDirectory();
    } catch {
      liveExists = false;
    }
    if (liveExists) {
      await fs.rename(finalDir, previousDir);
    }
    await fs.rename(stagingDir, finalDir);
    if (liveExists) {
      await rmDirRecursive(previousDir);
    }
  } catch (err) {
    // Best-effort rollback: if the previous dir still exists, restore it.
    await rmDirRecursive(stagingDir);
    try {
      const stat = await fs.stat(previousDir);
      if (stat.isDirectory()) {
        try { await fs.rm(finalDir, { recursive: true, force: true }); } catch {}
        await fs.rename(previousDir, finalDir);
      }
    } catch {
      /* swallow */
    }
    return Response.json({ ok: false, error: err?.message || "swap failed" }, { status: 500 });
  }

  return Response.json({
    ok: true,
    savedDir: finalDir,
    fileCount: cleaned.length,
    totalBytes,
  });
}
