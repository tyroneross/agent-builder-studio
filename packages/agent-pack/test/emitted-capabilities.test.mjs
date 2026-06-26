// Tests for conditional emitted capabilities (items 01/04/05/09).
import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentArtifacts } from "../index.mjs";
import {
  detectDocIngest,
  detectRiskSurfaces,
  detectDocProducer,
  resolveEmittedCapabilities,
} from "../index.mjs";

const BASE = {
  projectName: "Test Agent",
  description: "Answers questions about internal notes.",
  inputs: ["user_question"],
  outputs: ["final_answer"],
  tools: [],
  nodes: [
    {
      id: "answer",
      title: "Answer",
      kind: "agent",
      description: "Answer the question.",
      inputs: ["user_question"],
      outputs: ["final_answer"],
      tools: [],
      permission: "allow",
    },
  ],
  edges: [],
  evals: [],
};

function fileMap(out) {
  return Object.fromEntries(out.files.map((f) => [f.path, f.content]));
}

test("plain spec emits NO conditional capabilities (no decorative slots)", () => {
  const out = buildAgentArtifacts({ ...BASE });
  assert.deepEqual(out.emitted, []);
  const files = fileMap(out);
  assert.ok(!files["runtime/doc-ingest.mjs"]);
  assert.ok(!files["skills/threat-modeler.skill.md"]);
  assert.ok(!files["skills/pyramid-principle.skill.md"]);
  const tools = JSON.parse(files["tools.json"]);
  assert.ok(!tools.tools.some((t) => t.name === "doc-ingest"));
  const pkg = JSON.parse(files["package.json"]);
  assert.equal(pkg.dependencies, undefined, "no omniparse dep without doc input");
});

test("doc-input spec emits the omniparse ingest surface end to end", () => {
  const out = buildAgentArtifacts({
    ...BASE,
    description: "Summarizes uploaded PDF and xlsx files for analysts.",
  });
  const files = fileMap(out);
  const tools = JSON.parse(files["tools.json"]);
  assert.ok(tools.tools.some((t) => t.name === "doc-ingest"), "tool slot emitted");
  const manifest = JSON.parse(files["manifest.json"]);
  assert.ok(manifest.governance.toolTiers.some((t) => t.tool === "doc-ingest"), "manifest governance includes emitted tool");
  assert.match(files["contracts/tool-contracts.yaml"], /name: doc-ingest/);
  const runtime = files["runtime/doc-ingest.mjs"];
  assert.ok(runtime.includes('from "@tyroneross/omniparse"'));
  assert.ok(runtime.includes("detectInputType"));
  const pkg = JSON.parse(files["package.json"]);
  assert.equal(pkg.dependencies["@tyroneross/omniparse"], "^1.0.0");
  const packageManifest = JSON.parse(files["agent-package.json"]);
  const requirements = JSON.parse(files["setup/requirements.json"]);
  assert.ok(packageManifest.files.includes("runtime/doc-ingest.mjs"));
  assert.ok(requirements.requiredFiles.includes("runtime/doc-ingest.mjs"));
  const bank = JSON.parse(files["skills/skill-bank.json"]);
  assert.ok(bank.skills.some((s) => s.id.endsWith("doc-ingest-skill")));
});

test("risk-surface taxonomy: keyword and structural triggers", () => {
  assert.equal(detectRiskSurfaces({ ...BASE }).length, 0, "plain spec crosses nothing");

  const authy = detectRiskSurfaces({ ...BASE, description: "Handles OAuth login for users." });
  assert.ok(authy.some((c) => c.id === "auth-boundary"));

  // Structural: a write-side-effect tool crosses destructive-writes without keywords.
  const writer = detectRiskSurfaces({
    ...BASE,
    tools: [{ name: "save-notes", responsibility: "Persist notes.", sideEffect: "write", permission: "ask-first" }],
  });
  assert.ok(writer.some((c) => c.id === "destructive-writes"));

  // Structural: durable memory crosses sensitive-persistence.
  const mem = detectRiskSurfaces({ ...BASE, memory: "durable vector store" });
  assert.ok(mem.some((c) => c.id === "sensitive-persistence"));
});

test("risk-surface spec emits the threat-modeler skill naming crossed surfaces", () => {
  const out = buildAgentArtifacts({
    ...BASE,
    description: "Fetches data from an external API webhook and stores customer records with PII.",
  });
  const files = fileMap(out);
  const md = files["skills/threat-modeler.skill.md"];
  assert.ok(md.includes("STRIDE"));
  assert.ok(md.includes("Network exposure"));
  const bank = JSON.parse(files["skills/skill-bank.json"]);
  const entry = bank.skills.find((s) => s.id.endsWith("threat-modeler-skill"));
  assert.ok(entry);
  assert.ok(entry.riskSurfaces.length >= 2);
});

test("doc-producing spec emits the pyramid-principle skill", () => {
  const out = buildAgentArtifacts({
    ...BASE,
    outputs: ["weekly_report"],
    description: "Produces a weekly report for leadership.",
  });
  const files = fileMap(out);
  assert.ok(files["skills/pyramid-principle.skill.md"].includes("governing thought"));
  const bank = JSON.parse(files["skills/skill-bank.json"]);
  assert.ok(bank.skills.some((s) => s.id.endsWith("pyramid-principle-skill")));
});

test("detectors return signals for explainability and resist false positives", () => {
  const ingest = detectDocIngest({ ...BASE, description: "Parses uploaded pptx decks." });
  assert.equal(ingest.needed, true);
  assert.ok(ingest.signals.includes("pptx"));
  const producer = detectDocProducer({ ...BASE, outputs: ["executive memo"] });
  assert.equal(producer.needed, true);

  // False-positive guards (caught by the earnings-webex structure):
  // pasted text mentioning pdf is NOT file input...
  const pasted = detectDocIngest({ ...BASE, inputs: ["pasted_earnings_pdf_text"], description: "Summarize pasted pdf text." });
  assert.equal(pasted.needed, false, "pasted text must not trigger file ingest");
  // ..."profile" must not match "file"...
  const profile = detectDocIngest({ ...BASE, inputs: ["audience_profile"], description: "Tailor pdf-style summaries." });
  assert.equal(profile.needed, false, "substring 'file' in 'profile' must not count");
  // ...and negated capability must not trigger.
  const negated = detectDocIngest({ ...BASE, description: "Works from pdf excerpts without reading files or attachments." });
  assert.equal(negated.needed, false, "negated clause must not count");
});

test("prompting ladder + component model appear in every generated package (item 09)", () => {
  const out = buildAgentArtifacts({ ...BASE });
  const files = fileMap(out);
  const contract = files["prompts/prompt-builder-contract.md"];
  assert.ok(contract.includes("Prompting Pattern Ladder"));
  assert.ok(contract.includes("do not use it"), "ladder stop-rule present");
  assert.ok(contract.includes("echo the schema"), "measured local-model note present");
  const skillContract = files["skills/skill-contract.md"];
  assert.ok(skillContract.includes("Component Placement Model"));
  assert.ok(skillContract.includes("Hooks"), "component table present");
});

test("resolveEmittedCapabilities summary is human-readable", () => {
  const { summary } = resolveEmittedCapabilities(
    { ...BASE, description: "Ingest PDF documents and produce an executive summary report." },
    { slug: "test-agent" },
  );
  assert.ok(summary.length >= 2);
  assert.ok(summary.every((s) => typeof s === "string" && s.includes("emitted")));
});
