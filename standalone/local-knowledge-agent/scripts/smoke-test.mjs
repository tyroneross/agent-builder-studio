import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { ingestKnowledgeFiles, searchKnowledge } from "../src/agent.mjs";

const root = await mkdtemp(join(tmpdir(), "local-knowledge-agent-smoke-"));

try {
  const fixturePath = join(process.cwd(), "fixtures/sample-notes.txt");
  const result = await ingestKnowledgeFiles([
    {
      name: basename(fixturePath),
      type: "text/plain",
      buffer: await readFile(fixturePath),
    },
  ], {
    root,
    preferOllama: false,
    ramProfile: "24gb",
    retrievalQuery: "onboarding checklist sql search",
  });

  assert.equal(result.ok, true);
  assert.ok(result.storedChunks >= 1);
  assert.ok(result.store.localDatabase.exists);
  assert.ok(result.knowledgeGraph.entities.length >= 1);

  const search = await searchKnowledge("SQL search onboarding", {
    root,
    preferOllama: false,
    mode: "hybrid",
    limit: 5,
  });
  assert.equal(search.ok, true);
  assert.ok(search.results.length >= 1);

  console.log(JSON.stringify({
    ok: true,
    storedChunks: result.storedChunks,
    entities: result.knowledgeGraph.entities.length,
    searchResults: search.results.length,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
