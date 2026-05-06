import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (/\.(mjs|js)$/.test(entry.name)) files.push(path);
  }
  return files;
}

const files = [
  ...await listFiles("src"),
  ...await listFiles("tests"),
  ...await listFiles("scripts"),
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "pipe", encoding: "utf8" });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status || 1);
  }
}

console.log(`Checked syntax for ${files.length} JavaScript modules.`);
