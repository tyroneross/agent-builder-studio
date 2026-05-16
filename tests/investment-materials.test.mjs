import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMaterialFileRecord,
  extractClaimCandidates,
  extractPrintableText,
  summarizeMaterialSignals,
  summarizeTextDiff,
} from "../lib/investment-materials.mjs";

test("extractClaimCandidates captures numeric investment claims", () => {
  const claims = extractClaimCandidates("The company has $1.8M ARR. Retention is 97% and NRR is 131%. This sentence is qualitative.");
  assert.ok(claims.some((claim) => claim.includes("$1.8M ARR")));
  assert.ok(claims.some((claim) => claim.includes("97%")));
});

test("extractPrintableText surfaces readable snippets from binary buffers", () => {
  const buffer = new TextEncoder().encode("%PDF-1.7 hidden stream ARR is $2M with 120 customers").buffer;
  const text = extractPrintableText(buffer);
  assert.match(text, /ARR is \$2M/);
});

test("material file record includes content diff and claim signals", () => {
  const record = buildMaterialFileRecord(
    {
      relativePath: "deal/deck.pdf",
      name: "deck.pdf",
      changeStatus: "changed",
      textPreview: "ARR is $2M. Retention is 98%.",
    },
    { previous: { textPreview: "ARR is $1M. Retention is 92%." } },
  );
  assert.equal(record.isDealMaterial, true);
  assert.ok(record.claimCandidates.length >= 2);
  assert.ok(record.contentDiff.addedCount > 0);
});

test("summarizeMaterialSignals aggregates extracted deal content", () => {
  const files = [
    buildMaterialFileRecord({ relativePath: "deck.pdf", name: "deck.pdf", changeStatus: "changed", textPreview: "ARR is $2M." }),
    buildMaterialFileRecord({ relativePath: "notes.md", name: "notes.md", changeStatus: "unchanged", textPreview: "Customer retention is 95%." }),
  ];
  const summary = summarizeMaterialSignals(files);
  assert.equal(summary.dealFilesWithExtractedText, 2);
  assert.equal(summary.changedDealFilesWithExtractedText, 1);
  assert.ok(summary.claimCandidateCount >= 2);
});

test("summarizeTextDiff reports added and removed signals", () => {
  const diff = summarizeTextDiff("ARR is $1M. Retention is 92%.", "ARR is $2M. Retention is 98%.");
  assert.ok(diff.addedCount > 0);
  assert.ok(diff.removedCount > 0);
});
