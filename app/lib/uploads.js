// Client-side upload helper. Wraps POST /api/uploads with a small ergonomic
// surface for the UploadZone component. Pure module — no React.

export const PERMITTED_UPLOAD_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
];

// Suitable for <input type="file" accept="...">. Comma-separated list with the
// leading dots; browsers treat this as a hint, not a hard guarantee.
export const PERMITTED_UPLOAD_ACCEPT = PERMITTED_UPLOAD_EXTENSIONS.join(",");

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Lower-case extension extractor (e.g. "Notes.MD" -> ".md"). Returns "" if
// there is no recognizable extension.
export function fileExtension(name) {
  if (typeof name !== "string") return "";
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot).toLowerCase();
}

export function isPermittedExtension(name) {
  return PERMITTED_UPLOAD_EXTENSIONS.includes(fileExtension(name));
}

// Human-readable file size. Mirrors the granularity we want in the upload list:
// bytes / KB / MB to one decimal.
export function formatSize(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// POST a single File to /api/uploads. Resolves to the server's JSON payload
// (success or rejection); throws only on transport failure (network down,
// CORS, etc).
export async function uploadFile({ file, workingFolder, signal } = {}) {
  if (!file) throw new Error("file required");
  if (!workingFolder) throw new Error("workingFolder required");
  const form = new FormData();
  form.append("workingFolder", workingFolder);
  form.append("file", file);
  const res = await fetch("/api/uploads", {
    method: "POST",
    body: form,
    signal,
  });
  // We always return JSON, both on success and on the documented failure cases.
  // If the server gave us something non-JSON (e.g. 500 HTML), we surface a
  // generic error so the UI doesn't get stuck on "uploading".
  let data = null;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: `unexpected response (HTTP ${res.status})` };
  }
  return data;
}
