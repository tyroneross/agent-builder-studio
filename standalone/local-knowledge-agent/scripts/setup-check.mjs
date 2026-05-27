import { existsSync } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initializeLocalStore } from "../src/agent.mjs";

const root = process.cwd();
const report = {
  ok: true,
  required: [],
  optional: [],
  nextSteps: [],
};

await checkNode();
await checkSqlite();
await checkWritableStore();
await checkOllama();
await checkOmniparse();

if (!report.required.every((item) => item.ok)) report.ok = false;
if (!report.optional.find((item) => item.name === "ollama")?.ok) {
  report.nextSteps.push("Optional: install Ollama from https://ollama.com/ and run `ollama pull qwen3:14b` plus `ollama pull nomic-embed-text`.");
}
if (!report.optional.find((item) => item.name === "omniparse")?.ok) {
  report.nextSteps.push("Optional: set OMNIPARSE_SDK_PATH to a local Omniparse SDK entrypoint for richer PDF/spreadsheet parsing.");
}

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

async function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  report.required.push({
    name: "node",
    ok: major >= 22,
    found: process.version,
    required: ">=22",
  });
}

async function checkSqlite() {
  try {
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE TABLE checkup (id TEXT PRIMARY KEY)");
    db.close();
    report.required.push({ name: "node:sqlite", ok: true });
  } catch (error) {
    report.required.push({ name: "node:sqlite", ok: false, error: error.message });
  }
}

async function checkWritableStore() {
  try {
    await mkdir(resolve(root, "data/store"), { recursive: true });
    const probe = resolve(root, "data/store/.write-check");
    await writeFile(probe, "ok\n", "utf8");
    await access(dirname(probe), constants.W_OK);
    await initializeLocalStore({ root });
    report.required.push({ name: "local-store", ok: true, path: "data/store" });
  } catch (error) {
    report.required.push({ name: "local-store", ok: false, error: error.message });
  }
}

async function checkOllama() {
  try {
    const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
    const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2500) });
    report.optional.push({ name: "ollama", ok: response.ok, url: base });
  } catch (error) {
    report.optional.push({ name: "ollama", ok: false, error: error.message });
  }
}

async function checkOmniparse() {
  const entry = process.env.OMNIPARSE_SDK_PATH ?? "";
  report.optional.push({
    name: "omniparse",
    ok: Boolean(entry && existsSync(entry)),
    path: entry || null,
  });
}
