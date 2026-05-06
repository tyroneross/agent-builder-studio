import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "v0-sdk";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PROMPT_PATH = resolve(ROOT, "docs/v0-agent-console-ui-prompt.md");
const OUTPUT_DIR = resolve(ROOT, process.env.V0_OUTPUT_DIR || ".build-loop/v0-agent-console-ui");

const CONTEXT_FILES = [
  "README.md",
  "docs/architecture.md",
  "src/public/index.html",
  "src/public/styles.css",
  "src/public/app.js",
];

function requireApiKey() {
  if (process.env.V0_API_KEY) return process.env.V0_API_KEY;
  throw new Error(
    [
      "V0_API_KEY is not set.",
      "Create a v0 API key, then run:",
      "  V0_API_KEY=... npm run draft:agent-ui:v0",
    ].join("\n"),
  );
}

function assertInsideOutputDir(target) {
  const resolved = resolve(target);
  if (resolved !== OUTPUT_DIR && !resolved.startsWith(`${OUTPUT_DIR}${sep}`)) {
    throw new Error(`refusing to write generated file outside output dir: ${resolved}`);
  }
  return resolved;
}

async function readContextFile(name) {
  return {
    name,
    content: await readFile(resolve(ROOT, name), "utf8"),
    locked: true,
  };
}

async function saveGeneratedFiles(version) {
  if (!version?.files?.length) return [];
  const saved = [];
  for (const file of version.files) {
    if (!file.content) continue;
    const target = assertInsideOutputDir(resolve(OUTPUT_DIR, file.name));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
    saved.push(target);
  }
  return saved;
}

async function main() {
  const apiKey = requireApiKey();
  const client = createClient({ apiKey });
  const prompt = await readFile(PROMPT_PATH, "utf8");
  const files = await Promise.all(CONTEXT_FILES.map(readContextFile));

  const chat = await client.chats.init({
    type: "files",
    files,
    chatPrivacy: "private",
    metadata: {
      repo: "chief-of-staff",
      task: "agent-console-ui-draft",
      source: "codex",
    },
  });

  const result = await client.chats.sendMessage({
    chatId: chat.id,
    responseMode: "sync",
    modelConfiguration: {
      imageGenerations: false,
      thinking: true,
    },
    system: "You are a senior product designer and frontend engineer. Prioritize usable application UI over marketing pages.",
    message: prompt,
  });

  const versionId = result.latestVersion?.id;
  const version = versionId
    ? await client.chats.getVersion({
        chatId: result.id,
        versionId,
        includeDefaultFiles: false,
      })
    : result.latestVersion;
  const savedFiles = await saveGeneratedFiles(version);

  console.log(JSON.stringify({
    chatId: result.id,
    webUrl: result.webUrl,
    versionId: version?.id || null,
    status: version?.status || null,
    demoUrl: version?.demoUrl || null,
    screenshotUrl: version?.screenshotUrl || null,
    outputDir: savedFiles.length ? OUTPUT_DIR : null,
    savedFiles,
  }, null, 2));
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
