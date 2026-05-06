import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { workspacePath } from "../policy/path-policy.mjs";

export async function readJson(relPath, fallback) {
  try {
    return JSON.parse(await readFile(workspacePath(relPath), "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeJson(relPath, value) {
  const target = workspacePath(relPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
