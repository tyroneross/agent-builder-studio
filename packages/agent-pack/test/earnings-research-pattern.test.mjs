import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAgentArtifacts,
  PATTERNS,
  findCanvasPattern,
  canvasFromPattern,
} from "../index.mjs";

function fileMap(out) {
  return Object.fromEntries(out.files.map((file) => [file.path, file.content]));
}

test("earnings-call-research pattern is available to Studio as a shared canvas seed", () => {
  const pattern = PATTERNS.find((item) => item.id === "earnings-call-research");
  assert.ok(pattern, "governance pattern exists");
  assert.equal(pattern.name, "Earnings Call Research");
  assert.ok(pattern.outputs.includes("claim_table"));
  assert.ok(pattern.outputs.includes("unverified_claims"));
  assert.equal(pattern.researchEvidence.unsupportedClaimsPolicy, "block_from_brief");
  assert.ok(pattern.nodes.some((node) => node.id === "fact-gate" && node.kind === "verifier"));

  const seed = findCanvasPattern("earnings-call-research");
  assert.ok(seed, "canvas seed exists");
  assert.ok(seed.nodes.some((node) => node.id === "fact-gate" && node.role === "eval"));

  const canvas = canvasFromPattern(seed);
  assert.equal(canvas.nodes.length, pattern.nodeCount);
  assert.ok(canvas.edges.some((edge) => edge.from === "fact-gate" && edge.to === "synthesis"));
});

test("Arista earnings-call package emits research evidence contracts and fact-gate rules", () => {
  const out = buildAgentArtifacts(
    {
      projectName: "Arista Networks Earnings Research Agent",
      patternId: "earnings-call-research",
      description:
        "Research Arista Networks earnings calls from issuer investor-relations materials, SEC filings, presentations, and approved transcripts.",
    },
    { createdAt: "2026-07-06T00:00:00.000Z" },
  );
  const files = fileMap(out);

  assert.ok(files["contracts/research-evidence.yaml"], "research evidence contract emitted");
  assert.ok(files["context/source-manifest.schema.json"], "source manifest schema emitted");
  assert.ok(files["evals/research-claim-table.schema.json"], "claim table schema emitted");
  assert.match(files["contracts/research-evidence.yaml"], /unsupported_claims_policy: block_from_brief/);
  assert.match(files["system-prompt.md"], /Unsupported factual claims follow policy `block_from_brief`/);
  assert.match(files["system-prompt.md"], /Build `claim_table` before synthesis/);

  const manifest = JSON.parse(files["manifest.json"]);
  assert.equal(manifest.pattern.id, "earnings-call-research");
  assert.equal(manifest.researchEvidence.unsupportedClaimsPolicy, "block_from_brief");
  assert.deepEqual(manifest.outputs, [
    "source_manifest",
    "claim_table",
    "verified_claims",
    "unverified_claims",
    "cited_research_brief",
  ]);
  assert.ok(manifest.graph.nodes.some((node) => node.id === "fact-gate" && node.kind === "verifier"));

  const tools = JSON.parse(files["tools.json"]);
  assert.ok(tools.tools.some((tool) => tool.name === "verify_claims_against_sources" && tool.permission === "allow-read"));

  const claimSchema = JSON.parse(files["evals/research-claim-table.schema.json"]);
  assert.deepEqual(claimSchema.items.properties.status.enum, [
    "verified",
    "partially_supported",
    "contradicted",
    "not_found",
    "requires_human_review",
  ]);
  assert.ok(claimSchema.items.required.includes("quote_or_locator"));

  const packageManifest = JSON.parse(files["agent-package.json"]);
  assert.equal(packageManifest.entrypoints.researchEvidence, "contracts/research-evidence.yaml");
  assert.ok(packageManifest.files.includes("contracts/research-evidence.yaml"));

  const requirements = JSON.parse(files["setup/requirements.json"]);
  assert.ok(requirements.requiredFiles.includes("context/source-manifest.schema.json"));
  assert.ok(requirements.requiredFiles.includes("evals/research-claim-table.schema.json"));
  assert.equal(out.warnings.length, 0);
});
