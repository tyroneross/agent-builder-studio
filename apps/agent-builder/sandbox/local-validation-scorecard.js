export function buildLocalValidationScorecard(results = []) {
  const dimensions = [
    scoreCompletion(results),
    scoreScenarioPassRate(results),
    scoreArtifactCompleteness(results),
    scoreLearningPromotion(results),
    scoreRuntimeStability(results),
  ];
  const score = dimensions.reduce((sum, item) => sum + item.score, 0);
  const maxScore = dimensions.reduce((sum, item) => sum + item.maxScore, 0);
  return {
    schemaVersion: "agent-builder.local-validation-scorecard.v1",
    score,
    maxScore,
    scorePercent: maxScore ? Math.round((score / maxScore) * 1000) / 10 : 0,
    status: score === maxScore ? "pass" : score >= Math.ceil(maxScore * 0.7) ? "warn" : "fail",
    dimensions,
  };
}

function scoreCompletion(results) {
  const completed = results.length;
  const score = completed > 0 ? 2 : 0;
  return dimension("structure-completion", "Structure completion", score, `${completed} structures have saved validation results.`);
}

function scoreScenarioPassRate(results) {
  const scenarios = results.flatMap((result) => result?.scenarios ?? []);
  const passed = scenarios.filter((scenario) => scenario.passed).length;
  const ratio = scenarios.length ? passed / scenarios.length : 0;
  const score = ratio === 1 ? 2 : ratio >= 0.8 ? 1 : 0;
  return dimension("scenario-pass-rate", "Scenario pass rate", score, `${passed}/${scenarios.length || 0} scenarios passed.`);
}

function scoreArtifactCompleteness(results) {
  const complete = results.filter((result) => Number(result?.score ?? 0) >= Number(result?.maxScore ?? 1)).length;
  const ratio = results.length ? complete / results.length : 0;
  const score = ratio === 1 ? 2 : ratio >= 0.8 ? 1 : 0;
  return dimension("artifact-completeness", "Artifact completeness", score, `${complete}/${results.length || 0} structures reached max score.`);
}

function scoreLearningPromotion(results) {
  const withLearning = results.filter((result) => (result?.files ?? []).some((file) => String(file).endsWith("memory/learning-ledger.json"))).length;
  const score = results.length && withLearning === results.length ? 2 : withLearning > 0 ? 1 : 0;
  return dimension("learning-promotion", "Learning promotion", score, `${withLearning}/${results.length || 0} structures produced learning-ledger artifacts.`);
}

function scoreRuntimeStability(results) {
  const failed = results.filter((result) => !result?.passed).length;
  const score = failed === 0 && results.length > 0 ? 2 : failed <= 1 && results.length > 0 ? 1 : 0;
  return dimension("runtime-stability", "Runtime stability", score, `${failed}/${results.length || 0} structures failed validation.`);
}

function dimension(id, label, score, evidence) {
  return {
    id,
    label,
    score,
    maxScore: 2,
    status: score === 2 ? "pass" : score === 1 ? "warn" : "fail",
    evidence,
  };
}
