import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { workspacePath, safeDocumentName } from "../policy/path-policy.mjs";
import { appendAudit } from "./audit-log.mjs";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function createDocument({ name, content, folder = "documents" }) {
  const base = safeDocumentName(name);
  const extension = extname(base) ? "" : ".md";
  const filename = `${basename(base)}${extension}`;
  const target = workspacePath(folder, filename);
  if (await exists(target)) {
    throw new Error(`refusing to overwrite existing document: ${filename}`);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, String(content ?? ""), "utf8");
  await appendAudit({ type: "document-created", path: target });
  return { path: target, filename };
}

export async function readDocument(relPath) {
  return readFile(workspacePath(relPath), "utf8");
}
