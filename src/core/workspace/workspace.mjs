import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { workspacePath, workspaceRoot } from "../policy/path-policy.mjs";
import { appendAudit } from "./audit-log.mjs";

export const DEFAULT_FILES = [
  ["profile.yaml", "name: null\nrole: null\ntimezone: America/Los_Angeles\nworking_style: []\n"],
  ["goals/weekly.md", "# Weekly Goals\n\n- Add your top outcomes here.\n"],
  ["tasks/tasks.md", "# Tasks\n\n"],
  ["people/people-index.json", "[]\n"],
  ["meetings/meeting-cache.json", "[]\n"],
  ["decisions/decision-log.md", "# Decision Log\n\n"],
  ["commitments/commitments.json", "[]\n"],
  ["memory/learning-ledger.json", "[]\n"],
  ["approvals/queue.json", "[]\n"],
  ["logs/audit-log.jsonl", ""],
];

export const WORKSPACE_DIRS = [
  "approvals",
  "calendar/imports",
  "calendar/exports",
  "commitments",
  "decisions",
  "documents",
  "goals",
  "logs",
  "meetings",
  "memory",
  "people",
  "plans",
  "system",
  "tasks",
];

export async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureWorkspace() {
  const root = workspaceRoot();
  await mkdir(root, { recursive: true });
  for (const dir of WORKSPACE_DIRS) await mkdir(workspacePath(dir), { recursive: true });
  for (const [file, contents] of DEFAULT_FILES) {
    const target = workspacePath(file);
    if (!(await exists(target))) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents, "utf8");
    }
  }
  await appendAudit({ type: "workspace-ready", workspace: root });
  return { workspace: root };
}

export async function workspaceStatus() {
  const root = workspaceRoot();
  const ready = await exists(root);
  const files = {};
  for (const [file] of DEFAULT_FILES) {
    files[file] = await exists(workspacePath(file));
  }
  return { workspace: root, ready, files };
}

export async function saveSystemArtifact(relPath, content) {
  const target = workspacePath(relPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, String(content ?? ""), "utf8");
  await appendAudit({ type: "system-artifact-written", path: target });
  return { path: target };
}
