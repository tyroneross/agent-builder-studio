import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export function workspaceRoot() {
  return resolve(process.env.COS_WORKSPACE_DIR || resolve(APP_ROOT, "cos-workspace"));
}

export function isInside(parent, candidate) {
  const root = resolve(parent);
  const target = resolve(candidate);
  const rel = relative(root, target);
  return rel === "" || (!!rel && !rel.startsWith("..") && !isAbsolute(rel));
}

export function workspacePath(...parts) {
  const root = workspaceRoot();
  const target = resolve(root, ...parts);
  if (!isInside(root, target)) {
    throw new Error(`path escapes CoS workspace: ${target}`);
  }
  return target;
}

export function assertLocalServiceUrl(rawUrl) {
  const url = new URL(rawUrl);
  const allowedHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!["http:", "https:"].includes(url.protocol) || !allowedHosts.has(url.hostname)) {
    throw new Error(`blocked non-local network access: ${rawUrl}`);
  }
  return url;
}

export function safeDocumentName(name) {
  const cleaned = String(name || "")
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return cleaned || `document-${Date.now()}`;
}
