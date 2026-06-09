import { readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const contractPath = join(process.cwd(), "plugin", "references", "templates", "nightly-doe-contract.json");

test("nightly DOE contract: manual runner available, nightly flag stays off, repo policy read-only", async () => {
  const contract = JSON.parse(await readFile(contractPath, "utf8"));

  assert.equal(contract.schemaVersion, "agent-builder.nightly-doe-contract.v1");
  assert.equal(contract.status, "manual-runner-available");
  assert.equal(contract.featureFlag.id, "nightlyLocalDoe");
  assert.equal(contract.featureFlag.enabled, false);
  assert.equal(contract.featureFlag.defaultState, "off");
  assert.equal(contract.runnerStatus.executableRunnerIncluded, true);
  assert.equal(contract.runnerStatus.runner, "scripts/doe/run-local-json-doe.mjs");
  assert.match(contract.runnerStatus.invocation, /manual only/);
  assert.equal(contract.targetRepoPolicy.defaultAccess, "read-only");
  assert.equal(contract.targetRepoPolicy.writesAllowed, false);
  assert.equal(contract.targetRepoPolicy.requiresExplicitApprovalForPatches, true);
  assert.equal(contract.targetRepoPolicy.requiresExplicitApprovalForGuardExecution, true);
  assert.ok(contract.crossRepoScope.disallowedDefaultActions.includes("read secrets"));
  assert.ok(contract.crossRepoScope.disallowedDefaultActions.includes("download dependencies"));
});

test("nightly DOE contract requires cautious local-model interpretation", async () => {
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  const interpretation = contract.localModelInterpretation;

  assert.equal(interpretation.defaultMode, "cautious");
  assert.ok(interpretation.minimumReplicatesForRecommendation >= 3);
  assert.ok(interpretation.preferredReplicates >= interpretation.minimumReplicatesForRecommendation);
  assert.deepEqual(interpretation.confidenceLabels, ["low", "medium", "high"]);
  assert.ok(interpretation.rules.some((rule) => rule.includes("Do not infer a trend from one run")));
  assert.ok(interpretation.rules.some((rule) => rule.includes("Separate measurement from interpretation")));
});

test("nightly DOE morning packet includes trust and expansion fields", async () => {
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  const fields = contract.morningPacketContract.recommendationFields;

  assert.ok(fields.includes("confidence"));
  assert.ok(fields.includes("whyNotTrustYet"));
  assert.ok(contract.expansionTracks.includes("security and penetration-test simulation"));
  assert.ok(contract.expansionTracks.includes("UI improvement"));
  assert.ok(contract.expansionTracks.includes("customer-specific product update drafting"));
});
