#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildInstallManifest,
  getStoreStats,
  ingestKnowledgeFiles,
  initializeLocalStore,
  searchKnowledge,
} from "../src/agent.mjs";
import { startServer } from "../src/server.mjs";

const args = process.argv.slice(2);
const command = args.shift() ?? "help";

try {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
  } else if (command === "init") {
    const stats = await initializeLocalStore({ root: process.cwd() });
    writeJson({ ok: true, store: stats });
  } else if (command === "stats") {
    writeJson({ ok: true, store: await getStoreStats({ root: process.cwd() }) });
  } else if (command === "bundle" || command === "manifest") {
    writeJson(buildInstallManifest({ ramProfile: option(args, "--ram") ?? "24gb" }));
  } else if (command === "ingest") {
    const options = parseOptions(args);
    const files = options.positionals;
    if (!files.length) throw new Error("Provide at least one file path to ingest.");
    const uploads = [];
    for (const file of files) {
      const path = resolve(file);
      uploads.push({
        name: basename(path),
        type: mediaTypeFor(path),
        buffer: await readFile(path),
      });
    }
    const result = await ingestKnowledgeFiles(uploads, {
      root: process.cwd(),
      retrievalQuery: options.query,
      guidance: options.guidance,
      outputInstructions: options.output,
      ramProfile: options.ram ?? "24gb",
      chatModel: options.chatModel,
      embeddingModel: options.embeddingModel,
      parserMode: options.parserMode,
      omniparseEntry: options.omniparse,
      temperature: options.temperature,
      topP: options.topP,
      numCtx: options.numCtx,
      numPredict: options.numPredict,
      preferOllama: !options.noOllama,
    });
    writeJson(result);
  } else if (command === "search") {
    const options = parseOptions(args);
    const query = options.positionals.join(" ").trim() || options.query;
    if (!query) throw new Error("Provide a search query.");
    writeJson(await searchKnowledge(query, {
      root: process.cwd(),
      mode: options.mode ?? "hybrid",
      embeddingModel: options.embeddingModel,
      limit: options.limit ? Number(options.limit) : 8,
      preferOllama: !options.noOllama,
    }));
  } else if (command === "serve") {
    const options = parseOptions(args);
    await startServer({
      root: process.cwd(),
      host: options.host ?? "127.0.0.1",
      port: Number(options.port ?? 3737),
    });
  } else if (command === "setup-check") {
    await import(pathToFileURL(resolve("scripts/setup-check.mjs")).href);
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseOptions(values) {
  const parsed = { positionals: [] };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      parsed.positionals.push(value);
      continue;
    }
    const [rawKey, inlineValue] = value.split("=", 2);
    const key = rawKey.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    if (key === "noOllama") {
      parsed.noOllama = true;
      continue;
    }
    parsed[key] = inlineValue ?? values[index + 1];
    if (inlineValue === undefined) index += 1;
  }
  return parsed;
}

function option(values, key) {
  const index = values.indexOf(key);
  if (index >= 0) return values[index + 1];
  const inline = values.find((item) => item.startsWith(`${key}=`));
  return inline ? inline.slice(key.length + 1) : null;
}

function mediaTypeFor(path) {
  const ext = extname(path).toLowerCase();
  if ([".txt", ".md", ".markdown", ".log"].includes(ext)) return "text/plain";
  if (ext === ".rtf") return "application/rtf";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".csv") return "text/csv";
  if (ext === ".json") return "application/json";
  return "application/octet-stream";
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp() {
  process.stdout.write(`Local Knowledge Agent

Usage:
  local-knowledge-agent init
  local-knowledge-agent serve [--port 3737]
  local-knowledge-agent ingest <files...> [--ram 24gb] [--query "..."] [--no-ollama]
  local-knowledge-agent search "query" [--mode hybrid|semantic|sql]
  local-knowledge-agent stats
  local-knowledge-agent bundle [--ram 24gb]

Common options:
  --ram <8gb|16gb|24gb|32gb|48gb|64gb>
  --chat-model <ollama-model>
  --embedding-model <ollama-model>
  --temperature <0..2>
  --num-ctx <tokens>
  --num-predict <tokens>
  --omniparse <path-to-sdk-index.mjs>
  --no-ollama
`);
}
