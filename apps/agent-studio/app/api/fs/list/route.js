// POST /api/fs/list
// Body: { path: string }
// Response (always JSON):
//   - On permitted, existing directory:
//       { ok: true, path, parent, entries: [{ name, isDirectory, isHidden }] }
//     `parent` is null at allowlist root, otherwise the parent path string.
//     `entries` are sorted directories-first, then alpha; capped at 1000;
//     hidden entries (leading-dot) are filtered out.
//   - On rejected path or stat failure:
//       { ok: false, error: string }
//
// Same allowlist as /api/fs/validate: paths must live under
//   /Users/, /tmp/, /var/folders/.
// Pass 10: backs the FolderPickerModal in the new-project form.

import { promises as fs } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const PERMITTED_PREFIXES = ["/Users/", "/tmp/", "/var/folders/"];
const MAX_ENTRIES = 1000;

function isPermitted(absolute) {
  return PERMITTED_PREFIXES.some(
    (prefix) => absolute.startsWith(prefix) || absolute + "/" === prefix,
  );
}

// Returns the parent of an absolute path, or null when the path *is* one of the
// allowlist roots (so the modal can disable "..." at root). We compare against
// the prefix without trailing slash because path.dirname strips it.
function parentOfPermitted(absolute) {
  const roots = PERMITTED_PREFIXES.map((p) => p.replace(/\/$/, ""));
  if (roots.includes(absolute)) return null;
  const parent = path.dirname(absolute);
  // Don't let dirname escape the allowlist (e.g. /Users -> /).
  if (!isPermitted(parent) && !roots.includes(parent)) return null;
  return parent;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const raw = body?.path;
  if (typeof raw !== "string" || raw.length === 0) {
    return Response.json({ ok: false, error: "path required" }, { status: 400 });
  }
  if (!raw.startsWith("/")) {
    return Response.json({ ok: false, error: "path must be absolute" }, { status: 400 });
  }

  const absolute = path.resolve(raw);
  if (!isPermitted(absolute)) {
    return Response.json({ ok: false, error: "path outside permitted root" }, { status: 400 });
  }

  let stat;
  try {
    stat = await fs.stat(absolute);
  } catch (err) {
    return Response.json(
      { ok: false, error: err?.code === "ENOENT" ? "path does not exist" : err?.message || "stat failed" },
      { status: 200 },
    );
  }
  if (!stat.isDirectory()) {
    return Response.json({ ok: false, error: "path is not a directory" }, { status: 200 });
  }

  let dirents;
  try {
    dirents = await fs.readdir(absolute, { withFileTypes: true });
  } catch (err) {
    return Response.json(
      { ok: false, error: err?.message || "read failed" },
      { status: 200 },
    );
  }

  // Filter hidden (leading-dot) entries from the response. Sort directories
  // first, then alpha. Cap to MAX_ENTRIES so a Downloads with 200k items
  // doesn't blow up the JSON payload.
  const entries = [];
  for (const d of dirents) {
    if (d.name.startsWith(".")) continue;
    entries.push({
      name: d.name,
      isDirectory: d.isDirectory(),
      isHidden: false,
    });
  }
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const capped = entries.slice(0, MAX_ENTRIES);

  return Response.json({
    ok: true,
    path: absolute,
    parent: parentOfPermitted(absolute),
    entries: capped,
  });
}
