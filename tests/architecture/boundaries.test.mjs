import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, normalize, relative, resolve } from "node:path";

const ROOT = resolve(".");
const SRC = join(ROOT, "src");

async function listSourceFiles(dir = SRC) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listSourceFiles(path));
    else if (entry.name.endsWith(".mjs") || entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

function layerOf(file) {
  const rel = relative(SRC, file).split("/").join("/");
  if (rel === "server.mjs") return "entrypoint";
  return rel.split("/")[0];
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  let target = normalize(resolve(dirname(fromFile), specifier));
  if (!/\.(mjs|js)$/.test(target)) target += ".mjs";
  if (!target.startsWith(SRC)) return null;
  return target;
}

function importSpecifiers(source) {
  const specs = [];
  const importFrom = /import\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g;
  const exportFrom = /export\s+[^'"]+\s+from\s+["']([^"']+)["']/g;
  for (const regex of [importFrom, exportFrom]) {
    let match;
    while ((match = regex.exec(source))) specs.push(match[1]);
  }
  return specs;
}

const ALLOWED = {
  entrypoint: new Set(["server"]),
  server: new Set(["server", "core", "rituals", "tools", "integrations"]),
  core: new Set(["core"]),
  integrations: new Set(["integrations", "core"]),
  rituals: new Set(["rituals", "core", "tools", "integrations"]),
  tools: new Set(["tools", "core", "integrations"]),
  lib: new Set(["core", "rituals", "integrations"]),
  public: new Set(["public"]),
};

test("source layers follow the long-term architecture boundaries", async () => {
  const files = await listSourceFiles();
  const violations = [];
  for (const file of files) {
    const fromLayer = layerOf(file);
    const source = await readFile(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      const target = resolveImport(file, specifier);
      if (!target) continue;
      const toLayer = layerOf(target);
      const allowed = ALLOWED[fromLayer] || new Set();
      if (!allowed.has(toLayer)) {
        violations.push(`${relative(ROOT, file)} imports ${relative(ROOT, target)}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
