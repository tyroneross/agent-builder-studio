import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import { GENERATED_AGENTS_DIR } from "./generated-paths.mjs";

export async function exportAgentPackage(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const sourceDir = resolveSourceDir(root, options);
  const packageManifest = JSON.parse(await readFile(resolve(sourceDir, "agent-package.json"), "utf8"));
  const slug = packageManifest.slug || basename(sourceDir);
  const targetDir = resolveTargetDir(root, slug, options);

  if (isInside(sourceDir, targetDir)) {
    throw new Error("Export target cannot be inside the source package directory.");
  }

  await mkdir(resolve(targetDir, ".."), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, force: true, errorOnExist: false });

  const setupCheck = options.skipCheck
    ? { skipped: true, passed: null, status: null, stdout: "", stderr: "" }
    : runSetupCheck(targetDir, options.env);

  const copiedFiles = await countFiles(targetDir);

  return {
    schemaVersion: "agent-builder.package-export.v1",
    package: {
      name: packageManifest.name,
      slug,
      sourceDir: formatPath(root, sourceDir),
      targetDir: formatPath(root, targetDir),
      copiedFiles,
    },
    setupCheck,
  };
}

function resolveSourceDir(root, options) {
  if (options.sourceDir) return resolve(root, options.sourceDir);
  if (!options.slug) throw new Error("Pass --slug=<agent-slug> or --source=<package-dir>.");
  return resolve(root, GENERATED_AGENTS_DIR, options.slug);
}

function resolveTargetDir(root, slug, options) {
  if (options.targetDir) return resolve(root, options.targetDir);
  return resolve(root, "agent-exports", slug);
}

function runSetupCheck(packageDir, env = process.env) {
  const script = resolve(packageDir, "scripts/setup-check.mjs");
  const result = spawnSync(process.execPath, [script], {
    cwd: packageDir,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });

  return {
    skipped: false,
    command: "npm run setup:check",
    passed: result.status === 0,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed: parseJson(result.stdout),
  };
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function countFiles(root) {
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) total += await countFiles(path);
    if (entry.isFile()) total += 1;
  }
  return total;
}

function isInside(parent, child) {
  const resolvedParent = resolve(parent);
  const resolvedChild = resolve(child);
  return resolvedChild === resolvedParent || resolvedChild.startsWith(`${resolvedParent}${sep}`);
}

function formatPath(root, target) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  const rel = relative(resolvedRoot, resolvedTarget);
  if (!rel || rel.startsWith("..") || rel.includes(`..${sep}`)) return resolvedTarget;
  return rel;
}

export async function readPackageSummary(packageDir) {
  const resolved = resolve(packageDir);
  const manifest = JSON.parse(await readFile(resolve(resolved, "agent-package.json"), "utf8"));
  const stats = await stat(resolved);
  return {
    slug: manifest.slug || basename(resolved),
    name: manifest.name,
    packageDir: resolved,
    modifiedAt: stats.mtime.toISOString(),
  };
}
