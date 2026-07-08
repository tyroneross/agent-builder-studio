// v7 schema / migration test (node, no window).
//
// Asserts the v7 additive governance fields:
//   - node:    tools[] (default []), permission (default "ask-first")
//   - project: memory (default {}), validationProfile (default "personal")
// and that a legacy v6-shaped project migrates by default-fill without losing
// authored values. Pure-function test — exercises makeProject + the exported
// normalizers without touching localStorage.

import assert from "node:assert/strict";
import {
  draftCanvasInstructions,
  buildNodeDraftInstructions,
  makeProject,
  normalizeInstructionDraftMode,
  normalizeNode,
  normalizeProject,
  STORAGE_VERSION,
} from "../app/lib/projects.js";

let passed = 0;
const ok = (m) => { console.log(`ok - ${m}`); passed++; };

// 1. STORAGE_VERSION is the single source and is v7.
assert.equal(STORAGE_VERSION, 7);
ok("STORAGE_VERSION === 7 (single source)");

// 2. makeProject seeds the new governance fields.
const p = makeProject({ name: "T" });
assert.deepEqual(p.memory, {});
assert.equal(p.validationProfile, "personal");
for (const n of p.canvas.nodes) {
  assert.ok(Array.isArray(n.tools), `node ${n.id} has tools[]`);
  assert.equal(typeof n.permission, "string");
  assert.equal(n.permission, "ask-first");
}
ok("makeProject seeds project.memory/validationProfile + node.tools/permission");

// 3. normalizeNode fills defaults on a legacy node, preserves authored values.
const legacyNode = { id: "x", role: "executor", title: "X" };
const nn = normalizeNode(legacyNode);
assert.deepEqual(nn.tools, []);
assert.equal(nn.permission, "ask-first");
const authoredNode = {
  id: "y", role: "executor", title: "Y",
  tools: [{ name: "write_file", sideEffect: "write", permission: "approval-required" }],
  permission: "deny-by-default",
};
const an = normalizeNode(authoredNode);
assert.equal(an.tools.length, 1);
assert.equal(an.tools[0].name, "write_file");
assert.equal(an.permission, "deny-by-default");
ok("normalizeNode fills defaults + preserves authored tools/permission");

// 4. normalizeProject migrates a v6-shaped project (no memory/profile) by default-fill.
const v6project = {
  id: "p1", name: "v6", workingFolder: "", createdAt: new Date().toISOString(),
  goal: "", context: "", outcome: "", uploads: [], rolePromptOverrides: {},
  runCache: {}, status: "draft", snapshots: [],
  canvas: { nodes: [{ id: "a", role: "agent", title: "A" }], edges: [], pan: { x: 0, y: 0 }, zoom: 1 },
};
const np = normalizeProject(v6project);
assert.deepEqual(np.memory, {});
assert.equal(np.validationProfile, "personal");
assert.deepEqual(np.canvas.nodes[0].tools, []);
assert.equal(np.canvas.nodes[0].permission, "ask-first");
ok("normalizeProject migrates v6 project → v7 defaults (memory/profile + node governance)");

// 5. normalizeProject preserves an authored validationProfile + memory.
const authoredProject = normalizeProject({ ...v6project, validationProfile: "enterprise", memory: { persistent: "vector" } });
assert.equal(authoredProject.validationProfile, "enterprise");
assert.deepEqual(authoredProject.memory, { persistent: "vector" });
ok("normalizeProject preserves authored validationProfile + memory");

// 6. Instruction drafts are opt-in so legacy creation still starts blank.
const blankCanvas = {
  nodes: [{
    id: "research",
    role: "agent",
    title: "Research Agent",
    description: "Collect and reconcile source material.",
    inputs: ["source_manifest"],
    outputs: ["claim_table"],
    instructions: "",
  }],
  edges: [],
  pan: { x: 0, y: 0 },
  zoom: 1,
};
const noDraftProject = makeProject({ name: "No Draft", canvas: blankCanvas });
assert.equal(noDraftProject.canvas.nodes[0].instructions, "");
ok("makeProject leaves node instructions blank unless drafting is requested");

// 7. Quick drafts seed runnable node instructions from project + node metadata.
const quickDraftProject = makeProject({
  name: "Draft",
  goal: "Research earnings calls",
  context: "Focus on factual support.",
  outcome: "Auditable claims table.",
  canvas: blankCanvas,
  instructionDraftMode: "quick",
});
const quickInstructions = quickDraftProject.canvas.nodes[0].instructions;
assert.match(quickInstructions, /Draft instructions for Research Agent/);
assert.match(quickInstructions, /Goal: Research earnings calls/);
assert.match(quickInstructions, /Use inputs: `source_manifest`\./);
assert.match(quickInstructions, /Return outputs: `claim_table`\./);
ok("quick instruction drafts include project brief, inputs, and outputs");

// 8. Detailed drafts expose the reviewable sections operators need to assess.
const detailedInstructions = buildNodeDraftInstructions(
  normalizeNode(blankCanvas.nodes[0]),
  "detailed",
  { goal: "Research earnings calls" },
);
assert.match(detailedInstructions, /# Research Agent Draft Instructions/);
assert.match(detailedInstructions, /## Work Loop/);
assert.match(detailedInstructions, /## Output Contract/);
assert.match(detailedInstructions, /## Guardrails/);
ok("detailed instruction drafts include work loop, output contract, and guardrails");

// 9. Drafting fills only blank instructions and preserves authored prompts.
const mixedCanvas = draftCanvasInstructions({
  ...blankCanvas,
  nodes: [
    { ...blankCanvas.nodes[0], id: "blank", instructions: "" },
    { ...blankCanvas.nodes[0], id: "authored", instructions: "Keep this prompt." },
  ],
}, "quick", { goal: "Research earnings calls" });
assert.notEqual(mixedCanvas.nodes[0].instructions, "");
assert.equal(mixedCanvas.nodes[1].instructions, "Keep this prompt.");
assert.equal(normalizeInstructionDraftMode("bogus"), "quick");
assert.equal(normalizeInstructionDraftMode("none"), "none");
ok("draftCanvasInstructions preserves authored prompts and normalizes modes");

console.log(`\nall ${passed} v7 schema checks passed`);
