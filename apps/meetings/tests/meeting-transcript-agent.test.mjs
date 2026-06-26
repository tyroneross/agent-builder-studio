import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  analyzeMeetingUploads,
  buildMeetingInstallBundle,
  extractTextFromUpload,
  searchMeetingMemory,
} from "../lib/meeting-transcript-agent.mjs";

const OMNIPARSE_ENTRY = process.env.OMNIPARSE_ENTRY
  ?? "/Users/tyroneross/dev/git-folder/Omniparse/packages/sdk/dist/index.mjs";

function upload(name, text, type = "text/plain") {
  const buffer = Buffer.from(text, "utf8");
  return {
    name,
    type,
    arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
  };
}

test("RTF extraction strips control words in internal fallback mode", async () => {
  const extracted = await extractTextFromUpload(
    upload("weekly.rtf", "{\\rtf1\\ansi Product weekly\\par Alice will send launch notes by Friday.}", "application/rtf"),
    { parserMode: "internal" },
  );

  assert.equal(extracted.extraction, "rtf");
  assert.match(extracted.text, /Product weekly/);
  assert.match(extracted.text, /Alice will send launch notes by Friday/);
  assert.doesNotMatch(extracted.text, /\\rtf/);
});

test("analysis stores chunks, sqlite rows, graph entities, and retrieves locally without Ollama", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-builder-meetings-"));
  try {
    const result = await analyzeMeetingUploads([
      upload(
        "customer-call.txt",
        "Customer call notes. The buyer raised pricing risk and onboarding timeline concerns. Alice will send a revised onboarding plan by Friday. Decision: keep pilot scope narrow.",
      ),
    ], {
      root,
      storePath: "meeting-store",
      dbPath: "meeting-store/knowledge.db",
      parserMode: "internal",
      preferOllama: false,
      createdAt: "2026-05-19T12:00:00.000Z",
    });

    assert.equal(result.ok, true);
    assert.equal(result.store.documents, 1);
    assert.ok(result.storedChunks >= 1);
    assert.ok(result.store.entities >= 1);
    assert.ok(result.store.localDatabase.path.endsWith("knowledge.db"));
    assert.match(result.markdown, /Action Items/);

    const search = await searchMeetingMemory("pricing onboarding", {
      root,
      storePath: "meeting-store",
      dbPath: "meeting-store/knowledge.db",
      preferOllama: false,
      mode: "hybrid",
      limit: 3,
    });

    assert.equal(search.ok, true);
    assert.equal(search.mode, "hybrid");
    assert.ok(search.results.length >= 1);
    assert.ok(search.sqlResults.length >= 1);
    assert.match(search.results[0].excerpt, /pricing|onboarding/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("single-file install bundle includes local database and model profiles", () => {
  const bundle = buildMeetingInstallBundle({ ramProfile: "24gb", createdAt: "2026-05-19T12:00:00.000Z" });
  assert.equal(bundle.schemaVersion, "agent-builder.single-file-install.v1");
  assert.equal(bundle.name, "Local Knowledge Agent");
  assert.equal(bundle.localDatabase.engine, "SQLite");
  assert.ok(bundle.localDatabase.tables.includes("entities"));
  assert.equal(bundle.recommendedProfile.chatModel, "qwen3:14b");
  assert.ok(bundle.retrieval.modes.includes("sql"));
  assert.ok(bundle.retrieval.modes.includes("semantic"));
});

test("Omniparse parses supported documents when the local SDK is present", { skip: !existsSync(OMNIPARSE_ENTRY) }, async () => {
  const extracted = await extractTextFromUpload(
    upload("actions.csv", "Owner,Task\nAlice,Send notes\nBob,Review plan\n", "text/csv"),
    { parserMode: "auto", omniparseEntry: OMNIPARSE_ENTRY },
  );

  assert.match(extracted.extraction, /^omniparse:/);
  assert.match(extracted.text, /Alice/);
  assert.match(extracted.text, /Review plan/);
});
