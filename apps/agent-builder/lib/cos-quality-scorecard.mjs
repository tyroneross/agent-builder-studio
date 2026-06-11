const NODE_KEYS = [
  "intake",
  "triage",
  "time_block_plan",
  "decision_log",
  "follow_up_plan",
  "operating_risks",
];

export function buildChiefOfStaffQualityScorecard(transcript) {
  const dimensions = [
    scoreCompleteness(transcript),
    scoreOwnerCoverage(transcript),
    scoreDecisionClarity(transcript),
    scoreScheduleRealism(transcript),
    scoreRiskSurface(transcript),
  ];
  const score = dimensions.reduce((sum, item) => sum + item.score, 0);
  const maxScore = dimensions.reduce((sum, item) => sum + item.maxScore, 0);
  return {
    schemaVersion: "agent-builder.chief-of-staff-quality.v1",
    score,
    maxScore,
    scorePercent: maxScore ? Math.round((score / maxScore) * 1000) / 10 : 0,
    status: score === maxScore ? "pass" : score >= Math.ceil(maxScore * 0.7) ? "warn" : "fail",
    dimensions,
  };
}

export function formatQualityScorecardMarkdown(scorecard) {
  if (!scorecard) return "";
  return [
    "## Quality scorecard",
    "",
    `Overall: ${scorecard.score}/${scorecard.maxScore} (${scorecard.scorePercent}%) - ${scorecard.status}`,
    "",
    ...scorecard.dimensions.map((item) =>
      `- **${item.label}**: ${item.score}/${item.maxScore} - ${item.evidence}`,
    ),
  ].join("\n");
}

function scoreCompleteness(transcript) {
  const parsed = NODE_KEYS.filter((key) => transcript?.nodes?.[key]?.parsed != null).length;
  const score = parsed === NODE_KEYS.length ? 2 : parsed >= 4 ? 1 : 0;
  return dimension("completeness", "Completeness", score, `${parsed}/${NODE_KEYS.length} nodes returned parsed JSON.`);
}

function scoreOwnerCoverage(transcript) {
  const top = transcript?.nodes?.triage?.parsed?.topThree ?? [];
  const followUps = transcript?.nodes?.follow_up_plan?.parsed?.items ?? [];
  const missingOwners = transcript?.nodes?.follow_up_plan?.parsed?.missingOwners ?? [];
  const ownerFields = [
    ...top.map((item) => item?.owner),
    ...followUps.map((item) => item?.owner),
  ];
  const covered = ownerFields.filter((owner) => ownerPresent(owner)).length;
  const ratio = ownerFields.length ? covered / ownerFields.length : 0;
  const score = ownerFields.length && missingOwners.length === 0 && ratio === 1
    ? 2
    : ratio >= 0.7
      ? 1
      : 0;
  return dimension(
    "owner-coverage",
    "Owner coverage",
    score,
    `${covered}/${ownerFields.length || 0} owner fields are filled; ${missingOwners.length} missing-owner flags.`,
  );
}

function scoreDecisionClarity(transcript) {
  const decisions = transcript?.nodes?.decision_log?.parsed?.decisions ?? [];
  const clear = decisions.filter((item) =>
    clean(item?.title) &&
    clean(item?.recommendation) &&
    clean(item?.status) &&
    Array.isArray(item?.options) &&
    item.options.length >= 2,
  ).length;
  const score = decisions.length && clear === decisions.length ? 2 : clear > 0 ? 1 : 0;
  return dimension("decision-clarity", "Decision clarity", score, `${clear}/${decisions.length || 0} decisions have options, recommendation, and status.`);
}

function scoreScheduleRealism(transcript) {
  const blocks = transcript?.nodes?.time_block_plan?.parsed?.blocks ?? [];
  const validTimes = blocks.filter((block) => validTime(block?.start) && validTime(block?.end)).length;
  const countOk = blocks.length >= 5 && blocks.length <= 9;
  const noOverlap = !hasSameDayOverlap(blocks);
  const score = blocks.length && validTimes === blocks.length && countOk && noOverlap
    ? 2
    : blocks.length && validTimes >= Math.ceil(blocks.length * 0.7)
      ? 1
      : 0;
  const countLabel = countOk ? "5-9 blocks" : `${blocks.length} blocks`;
  return dimension("schedule-realism", "Schedule realism", score, `${validTimes}/${blocks.length || 0} blocks have valid times; ${countLabel}; overlap=${noOverlap ? "no" : "yes"}.`);
}

function scoreRiskSurface(transcript) {
  const risks = transcript?.nodes?.operating_risks?.parsed?.risks ?? [];
  const clear = risks.filter((item) => clean(item?.risk) && clean(item?.severity) && clean(item?.mitigation)).length;
  const unverified = transcript?.nodes?.operating_risks?.parsed?.unverifiedClaims;
  const hasUnverifiedList = Array.isArray(unverified);
  const score = risks.length && clear === risks.length && hasUnverifiedList ? 2 : risks.length ? 1 : 0;
  return dimension("risk-surface", "Risk surface", score, `${clear}/${risks.length || 0} risks include severity and mitigation; unverified-claims list=${hasUnverifiedList ? "yes" : "no"}.`);
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

function ownerPresent(owner) {
  const text = clean(owner).toLowerCase();
  return text && text !== "missing" && text !== "null" && text !== "unknown";
}

function clean(value) {
  return String(value ?? "").trim();
}

function validTime(value) {
  const match = clean(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function hasSameDayOverlap(blocks) {
  const byDay = new Map();
  for (const block of blocks ?? []) {
    if (!validTime(block?.start) || !validTime(block?.end)) continue;
    const day = clean(block?.day).toLowerCase();
    const list = byDay.get(day) ?? [];
    list.push([toMinutes(block.start), toMinutes(block.end)]);
    byDay.set(day, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < list.length; i += 1) {
      if (list[i][0] < list[i - 1][1]) return true;
    }
  }
  return false;
}

function toMinutes(time) {
  const [h, m] = clean(time).split(":").map(Number);
  return h * 60 + m;
}
