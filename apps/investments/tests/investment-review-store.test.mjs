import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInvestmentFolderLogMarkdown,
  buildInvestmentReviewMarkdown,
  investmentSlug,
  saveInvestmentFolderLog,
  saveInvestmentReview,
} from "../lib/investment-review-store.mjs";

test("investmentSlug returns a safe review slug", () => {
  assert.equal(investmentSlug("Irys Legal AI / Series Seed"), "irys-legal-ai-series-seed");
  assert.equal(investmentSlug("../Bad Deal"), "bad-deal");
  assert.equal(investmentSlug(""), "investment-opportunity");
});

test("buildInvestmentReviewMarkdown includes investment recall metadata", () => {
  const markdown = buildInvestmentReviewMarkdown({
    company: "Irys Legal AI",
    score: 86,
    recommendation: "Advance to diligence",
    conviction: "Medium-high",
    checkSize: "Diligence first",
    notes: "Verify ARR and retention.",
    sourceContext: ["prior session 019e2ddb"],
    claims: [{ claim: "$1.8M ARR", verdict: "deck-only", source: "pitch deck" }],
    researchValidation: {
      results: [{ claim: "$1.8M ARR", verdict: "externally-supported" }],
    },
    scoreDetails: [{
      id: "traction-quality",
      label: "Traction quality",
      sources: [
        { type: "deck", label: "ARR", locator: "Pitch deck slide 8" },
        { type: "external", label: "Irys", locator: "Company website", url: "https://www.irys.ai/" },
      ],
    }],
    scoringWeights: { "traction-quality": 42 },
  }, { createdAt: "2026-05-16T00:00:00.000Z" });

  assert.match(markdown, /schema: agent-builder\.investment-review\.v1/);
  assert.match(markdown, /audience_scope: investments/);
  assert.match(markdown, /retrieval_scope: investments/);
  assert.match(markdown, /Human score|Score: 86/);
  assert.match(markdown, /Advance to diligence/);
  assert.match(markdown, /Claim Validation Snapshot/);
  assert.match(markdown, /deck-only: \$1\.8M ARR/);
  assert.match(markdown, /External Research Validation/);
  assert.match(markdown, /externally-supported: \$1\.8M ARR/);
  assert.match(markdown, /Score Detail Sources/);
  assert.match(markdown, /Scoring Weights/);
  assert.match(markdown, /Traction quality: 42%/);
  assert.match(markdown, /Pitch deck slide 8/);
  assert.match(markdown, /https:\/\/www\.irys\.ai\//);
});

test("buildInvestmentFolderLogMarkdown summarizes material file changes", () => {
  const markdown = buildInvestmentFolderLogMarkdown({
    folderName: "Irys Diligence",
    summary: {
      totalFiles: 3,
      deckLikeFiles: 1,
      changedDealFiles: 1,
      addedDealFiles: 0,
      removedDealFiles: 0,
      readableTextFiles: 1,
      extractedMaterialFiles: 1,
      claimCandidateCount: 1,
    },
    materialSignals: {
      claimCandidates: [{ claim: "$1.8M ARR", file: "Irys Diligence/deck.pdf" }],
      contentChanges: [{ file: "Irys Diligence/deck.pdf", addedCount: 1, removedCount: 0, added: ["ARR is $1.8M"], removed: [] }],
    },
    files: [{
      relativePath: "Irys Diligence/deck.pdf",
      extension: ".pdf",
      size: 1200,
      sha256: "abc1234567890def",
      changeStatus: "changed",
      isDealMaterial: true,
    }],
    researchBasis: [
      { type: "standard", label: "W3C File API", locator: "lastModified", url: "https://www.w3.org/TR/FileAPI/" },
    ],
  }, { createdAt: "2026-05-16T00:00:00.000Z" });

  assert.match(markdown, /schema: agent-builder\.investment-folder-log\.v1/);
  assert.match(markdown, /Material deal files changed/);
  assert.match(markdown, /Extracted Claim Signals/);
  assert.match(markdown, /\$1\.8M ARR/);
  assert.match(markdown, /Content Diffs/);
  assert.match(markdown, /changed: Irys Diligence\/deck\.pdf/);
  assert.match(markdown, /https:\/\/www\.w3\.org\/TR\/FileAPI\//);
});

test("saveInvestmentReview stages a repo-local review artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-builder-investment-"));
  try {
    const result = await saveInvestmentReview({
      company: "Irys Legal AI",
      score: 86,
      recommendation: "Advance to diligence",
      notes: "Verify financial metrics.",
    }, { root, createdAt: "2026-05-16T00:00:00.000Z" });

    assert.equal(result.relativePath, ".artifacts/agent/investment-review-2026-05-16t00-00-00-000z-irys-legal-ai/reviews/2026-05-16T00-00-00-000Z-irys-legal-ai.md");
    const written = await readFile(join(root, result.relativePath), "utf8");
    const registry = JSON.parse(await readFile(join(root, ".artifacts/registry.json"), "utf8"));
    assert.match(written, /Irys Legal AI Investment Review/);
    assert.match(written, /Verify financial metrics/);
    assert.equal(registry.artifacts[0].id, "agent:investment-review-2026-05-16t00-00-00-000z-irys-legal-ai");
    assert.equal(registry.artifacts[0].meta.kind, "investment-review");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saveInvestmentReview sanitizes staged artifact path segments", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-builder-investment-safe-path-"));
  try {
    const result = await saveInvestmentReview({
      company: "../Bad Deal",
      notes: "Check path handling.",
    }, { root, createdAt: "../../2026/05/16" });

    assert.equal(result.relativePath, ".artifacts/agent/investment-review-2026-05-16-bad-deal/reviews/2026-05-16-bad-deal.md");
    assert.doesNotMatch(result.relativePath, /\.\./);
    assert.match(await readFile(join(root, result.relativePath), "utf8"), /Check path handling/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("saveInvestmentFolderLog stages markdown and JSON folder log artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-builder-investment-folder-"));
  try {
    const result = await saveInvestmentFolderLog({
      folderName: "Irys Diligence",
      summary: { totalFiles: 1, deckLikeFiles: 1, changedDealFiles: 1 },
      files: [{
        relativePath: "Irys Diligence/deck.pdf",
        extension: ".pdf",
        size: 1200,
        sha256: "abc1234567890def",
        changeStatus: "changed",
        isDealMaterial: true,
      }],
    }, { root, createdAt: "2026-05-16T00:00:00.000Z" });

    assert.equal(result.relativePath, ".artifacts/agent/investment-folder-log-2026-05-16t00-00-00-000z-irys-diligence/folder-logs/2026-05-16T00-00-00-000Z-irys-diligence.md");
    assert.equal(result.relativeJsonPath, ".artifacts/agent/investment-folder-log-2026-05-16t00-00-00-000z-irys-diligence/folder-logs/2026-05-16T00-00-00-000Z-irys-diligence.json");
    const written = await readFile(join(root, result.relativePath), "utf8");
    const writtenJson = JSON.parse(await readFile(join(root, result.relativeJsonPath), "utf8"));
    const registry = JSON.parse(await readFile(join(root, ".artifacts/registry.json"), "utf8"));
    assert.match(written, /Irys Diligence Folder Change Log/);
    assert.equal(writtenJson.schemaVersion, "agent-builder.investment-folder-log.v1");
    assert.equal(registry.artifacts[0].id, "agent:investment-folder-log-2026-05-16t00-00-00-000z-irys-diligence");
    assert.equal(registry.artifacts[0].fileCount, 2);
    assert.equal(registry.artifacts[0].meta.kind, "investment-folder-log");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
