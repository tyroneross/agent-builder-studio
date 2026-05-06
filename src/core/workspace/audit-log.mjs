import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { workspacePath } from "../policy/path-policy.mjs";

export async function appendAudit(event) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...event });
  const target = workspacePath("logs/audit-log.jsonl");
  await mkdir(dirname(target), { recursive: true });
  let existing = "";
  try {
    existing = await readFile(target, "utf8");
  } catch {}
  await writeFile(target, `${existing}${line}\n`, "utf8");
}
