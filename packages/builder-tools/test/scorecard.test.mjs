import test from "node:test";
import assert from "node:assert/strict";

import { buildLocalValidationScorecard } from "../index.mjs";

test("buildLocalValidationScorecard grades completed passing results", () => {
  const scorecard = buildLocalValidationScorecard([
    {
      passed: true,
      score: 12,
      maxScore: 12,
      scenarios: [{ passed: true }, { passed: true }],
      files: ["memory/learning-ledger.json"],
    },
  ]);

  assert.equal(scorecard.schemaVersion, "agent-builder.local-validation-scorecard.v1");
  assert.equal(scorecard.status, "pass");
  assert.equal(scorecard.score, scorecard.maxScore);
  assert.equal(scorecard.dimensions.length, 5);
});
