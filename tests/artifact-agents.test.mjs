import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const root = join(process.cwd(), "agent-outputs", "test-artifact-suite");

test("artifact agents create real constrained outputs", async () => {
  rmSync(root, { recursive: true, force: true });
  const output = execFileSync("python3", [
    "scripts/run-artifact-agents.py",
    "--root",
    root,
    "--doe",
    "--skip-models",
    "--json",
  ], { encoding: "utf8" });

  const result = JSON.parse(output);
  assert.equal(result.passed, true, JSON.stringify(result.validation.errors, null, 2));
  assert.ok(result.score > 0);
  assert.ok(result.final.outputs.includes("powerpoint-deck-builder/board-update/deck.pptx"));
  assert.ok(result.final.outputs.includes("writing-agent/executive-brief/domain-learning-agent-brief.docx"));
  assert.ok(result.final.outputs.includes("chief-of-staff-agent/schedule-optimizer/weekly-time-plan.docx"));
  assert.ok(result.final.outputs.includes("chief-of-staff-agent/productivity-dashboard/index.html"));
  assert.ok(result.final.outputs.includes("chief-of-staff-agent/schedule-optimizer/time-block-plan.json"));
  assert.ok(result.final.outputs.includes("chief-of-staff-agent/schedule-optimizer/learning-ledger.json"));
  assert.ok(result.final.outputs.includes("chief-of-staff-agent/schedule-optimizer/optimized-week.ics"));
  assert.ok(result.final.outputs.includes("model-comparison-agent/local-llm-review/model-comparison.json"));
  assert.ok(result.final.outputs.includes("researched-deck-agent/agent-framework-topic/researched-agent-patterns.pptx"));
  assert.ok(result.final.outputs.includes("researched-deck-agent/agent-framework-topic/claim-table.json"));
  assert.ok(result.final.outputs.includes("local-llm-doe-agent/experiment-loop/local-doe-results.json"));
  assert.ok(result.final.outputs.includes("local-llm-doe-agent/experiment-loop/morning-recommendations.md"));
  assert.ok(result.final.outputs.includes("agent-handoff-agent/instruction-handoff/handoff-protocol.json"));
  assert.ok(result.final.outputs.includes("agent-skill-pack/skills-index.json"));
  assert.ok(result.final.outputs.includes("data-analysis-agent/usage-review/metrics-workbook.xlsx"));
  assert.ok(result.final.outputs.includes("data-analysis-agent/usage-review/metrics.csv"));
  assert.ok(result.final.outputs.includes("app-builder-agent/html-dashboard/index.html"));
  assert.ok(result.final.outputs.includes("investment-opportunity-agent/opportunity-review/review-dashboard.html"));
  assert.ok(result.final.outputs.includes("investment-opportunity-agent/opportunity-review/investment-scorecard.json"));
  assert.ok(result.final.outputs.includes("investment-opportunity-agent/opportunity-review/investment-claim-validation.json"));
  assert.ok(result.final.outputs.includes("investment-opportunity-agent/opportunity-review/external-research-validation.json"));
  assert.ok(result.final.outputs.includes("investment-opportunity-agent/opportunity-review/deck-content-diff-log.json"));
  assert.ok(result.final.outputs.includes("investment-opportunity-agent/opportunity-review/human-score-and-notes.md"));
  assert.ok(result.final.outputs.includes("artifact-index.html"));
  assert.ok(result.final.outputs.includes("research-brief-agent/security-research/security-brief.pdf"));
  assert.equal(result.doe.best.runId, "deckDepth-high-docDepth-high-dashboardDepth-high");

  for (const path of [
    "final/powerpoint-deck-builder/board-update/deck.pptx",
    "final/writing-agent/executive-brief/domain-learning-agent-brief.docx",
    "final/chief-of-staff-agent/schedule-optimizer/weekly-time-plan.docx",
    "final/chief-of-staff-agent/productivity-dashboard/index.html",
    "final/chief-of-staff-agent/schedule-optimizer/time-block-plan.json",
    "final/chief-of-staff-agent/schedule-optimizer/optimized-week.ics",
    "final/model-comparison-agent/local-llm-review/model-comparison.json",
    "final/researched-deck-agent/agent-framework-topic/researched-agent-patterns.pptx",
    "final/researched-deck-agent/agent-framework-topic/claim-table.json",
    "final/local-llm-doe-agent/experiment-loop/local-doe-results.json",
    "final/local-llm-doe-agent/experiment-loop/morning-recommendations.md",
    "final/agent-handoff-agent/instruction-handoff/handoff-protocol.json",
    "final/agent-skill-pack/skills-index.json",
    "final/data-analysis-agent/usage-review/metrics-workbook.xlsx",
    "final/data-analysis-agent/usage-review/metrics.csv",
    "final/app-builder-agent/html-dashboard/index.html",
    "final/investment-opportunity-agent/opportunity-review/review-dashboard.html",
    "final/investment-opportunity-agent/opportunity-review/investment-scorecard.json",
    "final/investment-opportunity-agent/opportunity-review/investment-claim-validation.json",
    "final/investment-opportunity-agent/opportunity-review/external-research-validation.json",
    "final/investment-opportunity-agent/opportunity-review/deck-content-diff-log.json",
    "final/investment-opportunity-agent/opportunity-review/human-score-and-notes.md",
    "final/artifact-index.html",
    "final/research-brief-agent/security-research/security-brief.pdf",
  ]) {
    assert.equal(existsSync(join(root, path)), true, `${path} should exist`);
  }

  const html = await readFile(join(root, "final/app-builder-agent/html-dashboard/index.html"), "utf8");
  assert.match(html, /dashboardData/);
  assert.doesNotMatch(html, /https:\/\//);

  const investmentHtml = await readFile(join(root, "final/investment-opportunity-agent/opportunity-review/review-dashboard.html"), "utf8");
  assert.match(investmentHtml, /dashboardData/);
  assert.match(investmentHtml, /humanScore/);
  assert.match(investmentHtml, /recommendation/);
  assert.match(investmentHtml, /markdownOutput/);
  assert.match(investmentHtml, /score-card/);
  assert.match(investmentHtml, /Pitch deck slide 8/);
  assert.match(investmentHtml, /https:\/\/www\.irys\.ai\//);
  assert.match(investmentHtml, /External Research Validation/);
  assert.match(investmentHtml, /Deck Content Diff/);

  const investmentScorecard = JSON.parse(await readFile(join(root, "final/investment-opportunity-agent/opportunity-review/investment-scorecard.json"), "utf8"));
  assert.equal(investmentScorecard.schemaVersion, "agent-builder.investment-scorecard.v1");
  assert.ok(investmentScorecard.overallScore >= 1);
  assert.match(investmentScorecard.upsideCase, /retention/);
  assert.match(investmentScorecard.bearCase, /competitive/);
  assert.ok(investmentScorecard.dimensions.every((dimension) => dimension.recommendation));
  assert.ok(investmentScorecard.dimensions.every((dimension) => dimension.sources?.length));

  const investmentClaims = JSON.parse(await readFile(join(root, "final/investment-opportunity-agent/opportunity-review/investment-claim-validation.json"), "utf8"));
  assert.equal(investmentClaims.priorSessionId, "019e2ddb-801b-7ab0-a38c-138865ece4a7");
  assert.ok(investmentClaims.claims.some((claim) => claim.verdict === "supported"));
  assert.ok(investmentClaims.claims.some((claim) => claim.verdict === "refuted"));
  assert.ok(investmentClaims.claims.some((claim) => claim.sources?.some((source) => source.type === "deck" && /slide/i.test(source.locator))));
  assert.ok(investmentClaims.claims.some((claim) => claim.sources?.some((source) => source.type === "external" && source.url)));

  const externalValidation = JSON.parse(await readFile(join(root, "final/investment-opportunity-agent/opportunity-review/external-research-validation.json"), "utf8"));
  assert.equal(externalValidation.schemaVersion, "agent-builder.investment-research-validation.v1");
  assert.ok(externalValidation.results.some((item) => item.verdict === "externally-supported"));

  const deckDiff = JSON.parse(await readFile(join(root, "final/investment-opportunity-agent/opportunity-review/deck-content-diff-log.json"), "utf8"));
  assert.equal(deckDiff.schemaVersion, "agent-builder.investment-deck-content-diff.v1");
  assert.ok(deckDiff.contentChanges.some((item) => item.addedCount > 0));

  const investmentNotes = await readFile(join(root, "final/investment-opportunity-agent/opportunity-review/human-score-and-notes.md"), "utf8");
  assert.match(investmentNotes, /audience_scope: investments/);
  assert.match(investmentNotes, /retrieval_scope: investments/);
  assert.match(investmentNotes, /Claim Validation Snapshot/);
  assert.match(investmentNotes, /External Research Validation/);
  assert.match(investmentNotes, /Deck Content Diff/);
  assert.match(investmentNotes, /Score Detail Sources/);

  const timePlan = JSON.parse(await readFile(join(root, "final/chief-of-staff-agent/schedule-optimizer/time-block-plan.json"), "utf8"));
  assert.ok(timePlan.optimizedMetrics.deepWorkHours > timePlan.baselineMetrics.deepWorkHours);
  assert.ok(timePlan.team.length >= 5);
  assert.ok(timePlan.learningLedger.length >= 3);

  const skillIndex = JSON.parse(await readFile(join(root, "final/agent-skill-pack/skills-index.json"), "utf8"));
  assert.ok(skillIndex.skills.some((skill) => skill.id.includes("honesty")));
  assert.ok(skillIndex.skills.some((skill) => skill.id.includes("local-llm-doe")));

  const localDoe = JSON.parse(await readFile(join(root, "final/local-llm-doe-agent/experiment-loop/local-doe-results.json"), "utf8"));
  assert.equal(localDoe.runCadence, "nightly");
  assert.ok(localDoe.smallModelCautions.length >= 5);
  assert.ok(localDoe.experiments.every((experiment) => experiment.confidence));

  rmSync(root, { recursive: true, force: true });
});

test("artifact agents can run a mixed-level DOE", async () => {
  const doeRoot = join(process.cwd(), "agent-outputs", "test-artifact-doe-suite");
  rmSync(doeRoot, { recursive: true, force: true });
  const output = execFileSync("python3", [
    "scripts/run-artifact-agents.py",
    "--root",
    doeRoot,
    "--doe",
    "--doe-runs",
    "12",
    "--skip-models",
    "--json",
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

  const result = JSON.parse(output);
  assert.equal(result.passed, true, JSON.stringify(result.validation.errors, null, 2));
  assert.equal(result.doe.runs.length, 12);
  assert.match(result.doe.design, /mixed-level DOE/);
  assert.ok(result.doe.effects.some((effect) => effect.factor === "handoffFormat"));
  assert.ok(result.doe.effects.some((effect) => effect.factor === "localDoeInterpretation"));
  assert.ok(result.doe.best.factors.handoffFormat);
  assert.equal(existsSync(join(doeRoot, "doe-12-runs")), true);

  rmSync(doeRoot, { recursive: true, force: true });
});
