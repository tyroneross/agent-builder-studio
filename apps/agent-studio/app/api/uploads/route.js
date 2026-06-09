// POST /api/uploads
// Body: multipart/form-data with fields:
//   - workingFolder: string (absolute path; must be under /Users, /tmp, or /var/folders)
//   - file:          File   (one file; client uploads files one at a time)
//
// Response (always JSON):
//   - success:  { ok: true,  name, size, savedPath, uploadedAt }
//   - rejected: { ok: false, error: string }
//
// Server-side rules:
//   1. workingFolder must be absolute and under the same allowlist as
//      /api/fs/validate (defense in depth — keeps writes off /etc, /System, etc).
//   2. Extension allowlist: .txt, .md, .markdown, .json, .yaml, .yml, .csv.
//   3. Max 10 MB per file.
//   4. Save into <workingFolder>/uploads/. mkdir -p the dir.
//   5. On filename collision, append "-1", "-2", … before the extension.
//
// No new packages: uses Web Request#formData() + node:fs/promises.

import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const PERMITTED_PREFIXES = ["/Users/", "/tmp/", "/var/folders/"];
const PERMITTED_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
]);
const MAX_BYTES = 10 * 1024 * 1024;

function isPermittedFolder(absolute) {
  return PERMITTED_PREFIXES.some(
    (prefix) => absolute.startsWith(prefix) || absolute + "/" === prefix,
  );
}

// Strip path separators from filename and reject names that would resolve
// outside the uploads/ subdir. We only keep the basename and refuse anything
// with a forward or backward slash, NUL, or ".." segments.
function sanitizeFilename(rawName) {
  if (typeof rawName !== "string" || rawName.length === 0) return null;
  const base = path.basename(rawName);
  if (
    !base ||
    base === "." ||
    base === ".." ||
    base.includes("/") ||
    base.includes("\\") ||
    base.includes("\0")
  ) {
    return null;
  }
  return base;
}

// Pick a non-colliding filename inside `dir`. If `name` exists, try
// `name-1.ext`, `name-2.ext`, etc. Caps at 1000 attempts to avoid pathological
// loops.
async function resolveUniqueFilename(dir, name) {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  let candidate = name;
  for (let i = 0; i < 1000; i++) {
    const full = path.join(dir, candidate);
    try {
      await fs.access(full);
      // exists — try the next suffix
      candidate = `${stem}-${i + 1}${ext}`;
    } catch {
      // does not exist — use this one
      return candidate;
    }
  }
  // Pathological — fall back to a timestamped name to guarantee uniqueness.
  return `${stem}-${Date.now()}${ext}`;
}

export async function POST(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return Response.json(
      { ok: false, error: "expected multipart/form-data" },
      { status: 400 },
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return Response.json(
      { ok: false, error: "could not parse form data" },
      { status: 400 },
    );
  }

  const workingFolderRaw = form.get("workingFolder");
  const file = form.get("file");

  if (typeof workingFolderRaw !== "string" || workingFolderRaw.length === 0) {
    return Response.json(
      { ok: false, error: "workingFolder required" },
      { status: 400 },
    );
  }
  if (!workingFolderRaw.startsWith("/")) {
    return Response.json(
      { ok: false, error: "workingFolder must be absolute" },
      { status: 400 },
    );
  }
  // Normalize before the prefix check so /Users/foo/../../etc cannot sneak past.
  const workingFolder = path.resolve(workingFolderRaw);
  if (!isPermittedFolder(workingFolder)) {
    return Response.json(
      { ok: false, error: "workingFolder outside permitted root" },
      { status: 400 },
    );
  }

  if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return Response.json(
      { ok: false, error: "file required" },
      { status: 400 },
    );
  }

  const safeName = sanitizeFilename(file.name);
  if (!safeName) {
    return Response.json(
      { ok: false, error: "invalid filename" },
      { status: 400 },
    );
  }
  const ext = path.extname(safeName).toLowerCase();
  if (!PERMITTED_EXTENSIONS.has(ext)) {
    return Response.json(
      { ok: false, error: "extension not permitted" },
      { status: 400 },
    );
  }

  if (typeof file.size === "number" && file.size > MAX_BYTES) {
    return Response.json(
      { ok: false, error: "file exceeds 10MB limit" },
      { status: 400 },
    );
  }

  // Read into memory. Files are <= 10MB so this is fine.
  let buf;
  try {
    const ab = await file.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) {
      return Response.json(
        { ok: false, error: "file exceeds 10MB limit" },
        { status: 400 },
      );
    }
    buf = Buffer.from(ab);
  } catch (err) {
    return Response.json(
      { ok: false, error: "could not read file payload" },
      { status: 400 },
    );
  }

  const uploadsDir = path.join(workingFolder, "uploads");
  try {
    await fs.mkdir(uploadsDir, { recursive: true });
  } catch (err) {
    return Response.json(
      { ok: false, error: `could not create uploads dir: ${err?.message || "mkdir failed"}` },
      { status: 500 },
    );
  }

  let finalName;
  try {
    finalName = await resolveUniqueFilename(uploadsDir, safeName);
  } catch (err) {
    return Response.json(
      { ok: false, error: `could not resolve filename: ${err?.message || "lookup failed"}` },
      { status: 500 },
    );
  }

  const savedPath = path.join(uploadsDir, finalName);
  try {
    await fs.writeFile(savedPath, buf);
  } catch (err) {
    return Response.json(
      { ok: false, error: `could not write file: ${err?.message || "write failed"}` },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    name: finalName,
    size: buf.length,
    savedPath,
    uploadedAt: new Date().toISOString(),
  });
}
