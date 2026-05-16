import assert from "node:assert/strict";
import test from "node:test";

import { claimTerms, scoreEvidence, validateInvestmentClaims } from "../lib/investment-research.mjs";

test("claimTerms keeps numeric and business terms for validation", () => {
  const terms = claimTerms("$1.8M ARR and 200+ paying firms with 97% retention");
  assert.ok(terms.includes("$1.8M"));
  assert.ok(terms.includes("ARR"));
  assert.ok(terms.includes("97%"));
  assert.ok(terms.includes("retention"));
});

test("scoreEvidence scores matched source text", () => {
  const score = scoreEvidence("$1.8M ARR and 200+ paying firms", "Company update: $1.8M ARR with 200 paying firms.");
  assert.ok(score.score >= 70);
  assert.ok(score.matchedTerms.includes("$1.8M"));
  assert.match(score.excerpt, /ARR/);
});

test("validateInvestmentClaims fetches external sources and returns summary", async () => {
  const validation = await validateInvestmentClaims(
    [
      {
        claim: "$1.8M ARR and 200+ paying firms",
        verdict: "deck-only",
        sources: [{ type: "external", label: "Company page", url: "https://example.com/company" }],
      },
      {
        claim: "No external source claim",
        verdict: "deck-only",
        sources: [],
      },
    ],
    {
      createdAt: "2026-05-16T00:00:00.000Z",
      fetcher: async () => ({
        ok: true,
        status: 200,
        text: async () => "<html><body>$1.8M ARR and 200 paying firms.</body></html>",
      }),
    },
  );

  assert.equal(validation.schemaVersion, "agent-builder.investment-research-validation.v1");
  assert.equal(validation.results[0].verdict, "externally-supported");
  assert.equal(validation.results[1].verdict, "no-external-source");
  assert.equal(validation.summary.externallySupported, 1);
  assert.equal(validation.summary.noExternalSource, 1);
});
