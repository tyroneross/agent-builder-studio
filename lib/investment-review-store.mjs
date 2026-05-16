import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export function investmentSlug(value) {
  return String(value ?? "investment-opportunity")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "investment-opportunity";
}

export function buildInvestmentReviewMarkdown(review = {}, options = {}) {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const company = review.company || "Untitled opportunity";
  const recommendation = review.recommendation || "Unspecified";
  const score = review.score ?? "Unscored";
  const conviction = review.conviction || "Unspecified";
  const checkSize = review.checkSize || "Unspecified";
  const notes = review.notes || "No notes provided.";
  const sourceContext = Array.isArray(review.sourceContext) ? review.sourceContext : [];
  const claims = Array.isArray(review.claims) ? review.claims : [];
  const scoreDetails = Array.isArray(review.scoreDetails) ? review.scoreDetails : [];
  const scoringWeights = review.scoringWeights && typeof review.scoringWeights === "object" ? review.scoringWeights : null;
  const researchValidation = review.researchValidation && typeof review.researchValidation === "object" ? review.researchValidation : null;

  return `---
schema: agent-builder.investment-review.v1
company: ${yamlScalar(company)}
created_at: ${yamlScalar(createdAt)}
score: ${yamlScalar(score)}
recommendation: ${yamlScalar(recommendation)}
conviction: ${yamlScalar(conviction)}
check_size: ${yamlScalar(checkSize)}
audience_scope: investments
retrieval_scope: investments
---

# ${company} Investment Review

## Recommendation

- Score: ${score}
- Recommendation: ${recommendation}
- Conviction: ${conviction}
- Check size: ${checkSize}

## Notes

${notes}

## Source Context

${sourceContext.length ? sourceContext.map((item) => `- ${item}`).join("\n") : "- No source context supplied."}

## Claim Validation Snapshot

${claims.length ? claims.map((claim) => `- ${claim.verdict || claim.status || "unlabeled"}: ${claim.claim || claim.text || "Unnamed claim"} (${claim.source || "source not supplied"})`).join("\n") : "- No claim validation rows supplied."}

## External Research Validation

${formatResearchValidation(researchValidation)}

## Scoring Weights

${formatScoringWeights(scoringWeights, scoreDetails)}

## Score Detail Sources

${scoreDetails.length ? scoreDetails.map((item) => `### ${item.label || "Score"}\n${(item.sources ?? []).map(formatSource).join("\n") || "- No sources supplied."}`).join("\n\n") : "- No score detail sources supplied."}

## Recall Tags

- investment
- opportunity-review
- agent-builder
`;
}

export function buildInvestmentFolderLogMarkdown(log = {}, options = {}) {
  const createdAt = options.createdAt ?? log.createdAt ?? new Date().toISOString();
  const folderName = log.folderName || "Selected folder";
  const summary = log.summary ?? {};
  const files = Array.isArray(log.files) ? log.files : [];
  const removed = Array.isArray(log.removed) ? log.removed : [];
  const changedMaterial = [...files, ...removed].filter((file) => file.isDealMaterial && file.changeStatus !== "unchanged");
  const changedRows = [...files, ...removed].filter((file) => file.changeStatus !== "unchanged");
  const researchBasis = Array.isArray(log.researchBasis) ? log.researchBasis : [];
  const materialSignals = log.materialSignals && typeof log.materialSignals === "object" ? log.materialSignals : {};

  return `---
schema: agent-builder.investment-folder-log.v1
folder: ${yamlScalar(folderName)}
created_at: ${yamlScalar(createdAt)}
audience_scope: investments
retrieval_scope: investments
---

# ${folderName} Folder Change Log

## Folder Assessment

${folderAssessment(summary)}

## Summary

- Total files: ${summary.totalFiles ?? files.length}
- Deck-like files: ${summary.deckLikeFiles ?? 0}
- Changed deal files: ${summary.changedDealFiles ?? 0}
- Added deal files: ${summary.addedDealFiles ?? 0}
- Removed deal files: ${summary.removedDealFiles ?? 0}
- Readable text files: ${summary.readableTextFiles ?? 0}
- Deal files with extracted text: ${summary.extractedMaterialFiles ?? 0}
- Extracted claim candidates: ${summary.claimCandidateCount ?? 0}

## Extracted Claim Signals

${formatClaimSignals(materialSignals.claimCandidates)}

## Content Diffs

${formatContentDiffs(materialSignals.contentChanges)}

## Material File Changes

${changedMaterial.length ? changedMaterial.map(formatFolderRow).join("\n") : "- No material deal-file changes detected."}

## All File Changes

${changedRows.length ? changedRows.slice(0, 80).map(formatFolderRow).join("\n") : "- No changes detected against the prior saved folder log."}

## Research Basis

${researchBasis.length ? researchBasis.map(formatSource).join("\n") : "- No research basis supplied."}

## Recall Tags

- investment
- opportunity-folder-log
- deck-change-detection
- agent-builder
`;
}

function formatSource(source = {}) {
  if (typeof source === "string") return `- ${source}`;
  const type = source.type || "source";
  const label = source.label || "Unnamed source";
  const locator = source.locator ? `, ${source.locator}` : "";
  const url = source.url ? ` - ${source.url}` : "";
  return `- ${type}: ${label}${locator}${url}`;
}

function formatScoringWeights(scoringWeights, scoreDetails) {
  if (!scoringWeights) return "- No scoring weights supplied.";
  const rows = Object.entries(scoringWeights);
  if (!rows.length) return "- No scoring weights supplied.";
  const labels = new Map(scoreDetails.map((item) => [item.id, item.label || item.id]));
  return rows
    .map(([key, value]) => `- ${labels.get(key) ?? key}: ${Math.round(Number(value) || 0)}%`)
    .join("\n");
}

function formatResearchValidation(validation) {
  const rows = Array.isArray(validation?.results) ? validation.results : [];
  if (!rows.length) return "- Not run in this review session.";
  return rows.map((item) => `- ${item.verdict || "unlabeled"}: ${item.claim || "Unnamed claim"}`).join("\n");
}

function formatClaimSignals(signals) {
  const rows = Array.isArray(signals) ? signals : [];
  if (!rows.length) return "- No extracted claim candidates.";
  return rows.slice(0, 30).map((item) => `- ${item.claim} (${item.file || "unknown file"})`).join("\n");
}

function formatContentDiffs(changes) {
  const rows = Array.isArray(changes) ? changes : [];
  if (!rows.length) return "- No text-level content diffs available.";
  return rows.slice(0, 20).map((item) => {
    const added = (item.added ?? []).slice(0, 3).map((line) => `    - added: ${line}`).join("\n");
    const removed = (item.removed ?? []).slice(0, 3).map((line) => `    - removed: ${line}`).join("\n");
    return `- ${item.file}: ${item.addedCount ?? 0} added signals, ${item.removedCount ?? 0} removed signals\n${[added, removed].filter(Boolean).join("\n")}`;
  }).join("\n");
}

function folderAssessment(summary = {}) {
  const materialChanges = Number(summary.changedDealFiles ?? 0) + Number(summary.addedDealFiles ?? 0) + Number(summary.removedDealFiles ?? 0);
  if (materialChanges > 0) return "Material deal files changed. Re-run claim extraction and scoring before relying on the prior recommendation.";
  const anyChanges = Number(summary.changed ?? 0) + Number(summary.added ?? 0) + Number(summary.removed ?? 0);
  if (anyChanges > 0) return "Supporting files changed. Review updated notes and data, but the prior deck-based score may still be comparable.";
  return "No file-level changes were detected against the prior saved folder log.";
}

function formatFolderRow(file = {}) {
  const status = file.changeStatus || "unknown";
  const path = file.relativePath || file.name || "Unnamed file";
  const type = file.extension || "no extension";
  const size = file.size === undefined ? "unknown size" : `${file.size} bytes`;
  const hash = file.sha256 ? `, sha256 ${String(file.sha256).slice(0, 16)}` : "";
  return `- ${status}: ${path} (${type}, ${size}${hash})`;
}

export async function saveInvestmentReview(review = {}, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const createdAt = options.createdAt ?? new Date().toISOString();
  const timestamp = createdAt.replace(/[:.]/g, "-");
  const slug = investmentSlug(review.company);
  const outputRoot = resolve(root, "agent-outputs", "investment-opportunity-agent", "reviews");
  const target = resolve(outputRoot, `${timestamp}-${slug}.md`);

  assertInside(root, target);
  await mkdir(dirname(target), { recursive: true });
  const markdown = buildInvestmentReviewMarkdown(review, { createdAt });
  await writeFile(target, markdown, "utf8");

  return {
    path: target,
    relativePath: relative(root, target),
    markdown,
  };
}

export async function saveInvestmentFolderLog(log = {}, options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const createdAt = options.createdAt ?? log.createdAt ?? new Date().toISOString();
  const timestamp = createdAt.replace(/[:.]/g, "-");
  const slug = investmentSlug(log.folderName || "selected-folder");
  const outputRoot = resolve(root, "agent-outputs", "investment-opportunity-agent", "folder-logs");
  const markdownTarget = resolve(outputRoot, `${timestamp}-${slug}.md`);
  const jsonTarget = resolve(outputRoot, `${timestamp}-${slug}.json`);

  assertInside(root, markdownTarget);
  assertInside(root, jsonTarget);
  await mkdir(dirname(markdownTarget), { recursive: true });

  const normalizedLog = {
    ...log,
    createdAt,
    schemaVersion: log.schemaVersion || "agent-builder.investment-folder-log.v1",
  };
  const markdown = buildInvestmentFolderLogMarkdown(normalizedLog, { createdAt });
  await writeFile(jsonTarget, `${JSON.stringify(normalizedLog, null, 2)}\n`, "utf8");
  await writeFile(markdownTarget, markdown, "utf8");

  return {
    path: markdownTarget,
    jsonPath: jsonTarget,
    relativePath: relative(root, markdownTarget),
    relativeJsonPath: relative(root, jsonTarget),
    markdown,
    log: normalizedLog,
  };
}

function yamlScalar(value) {
  const text = String(value ?? "");
  if (/^[a-zA-Z0-9_.:/ -]+$/.test(text) && !text.includes("#")) return text;
  return JSON.stringify(text);
}

function assertInside(root, target) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (!(resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${sep}`))) {
    throw new Error(`Investment review path escaped root: ${target}`);
  }
}
