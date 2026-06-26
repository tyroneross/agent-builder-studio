// @tyroneross/agent-artifacts — local artifact staging + promotion.
//
// The lifecycle the user asked for:
//   1. STAGE   — generated output (a package, skill, plugin, or agent) is written
//                to a git-ignored `.artifacts/<type>/<slug>/` folder and recorded
//                in `.artifacts/registry.json`. The app tracks it locally; it is
//                NOT committed (it's working output, not source).
//   2. PROMOTE — when the user marks it live, the artifact is copied to a
//                standalone folder OUTSIDE the app (default: repo-root
//                `promoted/<slug>/`, or any absolute path), and the registry entry
//                flips to status "promoted" with the destination recorded.
//
// Pure-ish: every entrypoint takes a `root` (the staging base) so it is testable
// in a tmp dir and never assumes a fixed location. Node fs only.

import { promises as fs } from "node:fs";
import path from "node:path";

export const ARTIFACTS_DIRNAME = ".artifacts";
export const ARTIFACT_TYPES = Object.freeze(["package", "skill", "plugin", "agent"]);

function artifactsRoot(root) {
  return path.join(root, ARTIFACTS_DIRNAME);
}
function registryPath(root) {
  return path.join(artifactsRoot(root), "registry.json");
}

function slugify(s) {
  return String(s || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled";
}

export async function getRegistry(root) {
  try {
    const raw = await fs.readFile(registryPath(root), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.artifacts) ? parsed : { version: 1, artifacts: [] };
  } catch {
    return { version: 1, artifacts: [] };
  }
}

async function writeRegistry(root, registry) {
  await fs.mkdir(artifactsRoot(root), { recursive: true });
  await fs.writeFile(registryPath(root), JSON.stringify(registry, null, 2) + "\n");
}

export async function listArtifacts(root) {
  return (await getRegistry(root)).artifacts;
}

// Stage generated output. `files` is [{ path, content }] (the agent-pack bundle
// shape). Returns the registry entry. `now` is injectable for deterministic tests.
export async function stageArtifact(root, { type, name, files, meta = {}, now } = {}) {
  if (!ARTIFACT_TYPES.includes(type)) {
    throw new Error(`stageArtifact: unknown type "${type}" (expected ${ARTIFACT_TYPES.join("|")})`);
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("stageArtifact: files[] required");
  }
  const slug = slugify(name);
  const dir = path.join(artifactsRoot(root), type, slug);
  await fs.rm(dir, { recursive: true, force: true });
  for (const f of files) {
    const dest = path.join(dir, f.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, typeof f.content === "string" ? f.content : JSON.stringify(f.content, null, 2));
  }
  const id = `${type}:${slug}`;
  const createdAt = now || new Date().toISOString();
  const entry = { id, type, slug, name: name || slug, status: "staged", fileCount: files.length, dir, createdAt, promotedTo: null, meta };

  const registry = await getRegistry(root);
  const idx = registry.artifacts.findIndex((a) => a.id === id);
  if (idx >= 0) registry.artifacts[idx] = { ...registry.artifacts[idx], ...entry };
  else registry.artifacts.push(entry);
  await writeRegistry(root, registry);
  return entry;
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  for (const ent of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

// Promote a staged artifact to a standalone live folder OUTSIDE the app. Default
// destination is repo-root `promoted/<slug>/`; pass `to` for any absolute path
// (e.g. a sibling repo). The staged copy is kept (recoverable) unless `move`.
export async function promoteArtifact(root, id, { to, move = false, now } = {}) {
  const registry = await getRegistry(root);
  const entry = registry.artifacts.find((a) => a.id === id);
  if (!entry) throw new Error(`promoteArtifact: no staged artifact "${id}"`);
  const dest = to || path.join(root, "promoted", entry.slug);
  await fs.rm(dest, { recursive: true, force: true });
  await copyDir(entry.dir, dest);
  if (move) await fs.rm(entry.dir, { recursive: true, force: true });
  entry.status = "promoted";
  entry.promotedTo = dest;
  entry.promotedAt = now || new Date().toISOString();
  await writeRegistry(root, registry);
  return entry;
}
