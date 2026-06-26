// Stays in agent-builder because it tests agent-structures (which lives here),
// not the meetings app. Split out of the former meeting-transcript-agent test
// when meetings moved to apps/meetings.
import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_STRUCTURES } from "../agent-structures/index.js";

test("local knowledge agent structure is available in Agent Builder", () => {
  const structure = AGENT_STRUCTURES.find((item) => item.id === "local-knowledge-agent");
  assert.ok(structure);
  assert.equal(structure.spec.modelProvider, "ollama");
  assert.ok(structure.spec.sources.includes("omniparse-local-sdk"));
  assert.ok(structure.spec.outputs.includes("rich_text_output"));
  assert.ok(structure.spec.outputs.includes("local_database"));
  assert.ok(structure.spec.outputs.includes("knowledge_graph"));
});
