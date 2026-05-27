import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

import { writeAgentArtifacts } from "../lib/build-files.js";
import { listGeneratedAgentStructures } from "../lib/generated-agent-packages.mjs";

async function makeTestRoot(prefix) {
  const base = process.env.AGENT_BUILDER_TMPDIR || join(process.cwd(), ".tmp");
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, prefix));
}

test("listGeneratedAgentStructures exposes generated packages as reusable structures", async () => {
  const root = await makeTestRoot("generated-structures-");
  try {
    await writeAgentArtifacts(
      {
        patternId: "solo-tool-agent",
        projectName: "Generated Reusable Agent",
        description: "A reusable generated agent.",
        modelProvider: "none",
      },
      { root },
    );

    const structures = await listGeneratedAgentStructures({ root });
    assert.equal(structures.length, 1);
    assert.equal(structures[0].id, "generated:generated-reusable-agent");
    assert.equal(structures[0].category, "generated");
    assert.equal(structures[0].outputDir, "generated/agents/generated-reusable-agent");
    assert.equal(structures[0].spec.projectName, "Generated Reusable Agent");
    assert.ok(structures[0].spec.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
