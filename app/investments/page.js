"use client";

import {
  BadgeCheck,
  FileJson,
  FileText,
  FolderOpen,
  Gauge,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  buildMaterialFileRecord,
  classifyInvestmentFile,
  extractPrintableText,
  summarizeMaterialSignals,
} from "../../lib/investment-materials.mjs";

const SAMPLE_REVIEW = {
  company: "Irys Legal AI",
  headline: "AI-native legal workflow platform with strong fit to prior preference signals.",
  agentScore: 86,
  recommendation: "Advance to diligence",
  preferenceFit: [
    "Matches AI-native workflow app preference.",
    "Revenue and retention claims imply shipped customer pull.",
    "Legal workflow depth creates a better fit than generic AI tools.",
  ],
  scores: [
    {
      id: "preference-fit",
      label: "Preference fit",
      value: 92,
      weight: 30,
      recommendation: "Advance because this matches the AI-native workflow pattern you have favored.",
      details: [
        "Best fit signal is not just AI usage; it is workflow ownership inside a professional vertical.",
        "Score should fall if revenue is mostly pilots, if usage is shallow, or if the product is easy to replace with horizontal AI tools.",
      ],
      sources: [
        { type: "prior session", label: "Prior investment preference read", locator: "Session 019e2ddb-801b-7ab0-a38c-138865ece4a7" },
        { type: "deck", label: "Legal workflow positioning", locator: "Pitch deck slide 2" },
      ],
    },
    {
      id: "traction-quality",
      label: "Traction quality",
      value: 88,
      weight: 25,
      recommendation: "Verify ARR, retention, and paid-customer definitions before relying on this as a top-ranked traction signal.",
      details: [
        "The traction score is high because ARR, paying-firm count, retention, and NRR are the right SaaS proof points.",
        "The score is capped because the most important numbers are still deck-derived until billing and cohort evidence are reviewed.",
      ],
      sources: [
        { type: "deck", label: "$1.8M+ ARR, 200+ paying firms, 97%+ retention, 131% NRR", locator: "Pitch deck slide 8" },
        { type: "external", label: "Irys public usage claim", locator: "Company website", url: "https://www.irys.ai/" },
      ],
    },
    {
      id: "moat-durability",
      label: "Moat durability",
      value: 84,
      weight: 20,
      recommendation: "Underwrite moat through workflow depth, matter memory, integrations, and verified retention rather than AI model capability.",
      details: [
        "The moat is strongest if the product becomes embedded in daily legal drafting, review, and matter-memory workflows.",
        "The moat weakens if firms use it only for generic chat, search, or first-draft generation.",
      ],
      sources: [
        { type: "deck", label: "Matter memory, Word workflow, citation verification", locator: "Pitch deck slides 5-7" },
        { type: "external", label: "Irys product surface", locator: "Company website", url: "https://www.irys.ai/" },
      ],
    },
    {
      id: "evidence-confidence",
      label: "Evidence confidence",
      value: 78,
      weight: 15,
      recommendation: "Treat public validation as supportive but incomplete; request primary financial and customer evidence.",
      details: [
        "Public sources support usage/positioning, but not all financial metrics.",
        "The next diligence action is to reconcile deck metrics against billing exports, cohort tables, and customer references.",
      ],
      sources: [
        { type: "deck", label: "ARR, NRR, retention, customer count", locator: "Pitch deck slide 8" },
        { type: "external", label: "Irys public site", locator: "Company website", url: "https://www.irys.ai/" },
      ],
    },
    {
      id: "risk-adjusted-upside",
      label: "Risk-adjusted upside",
      value: 79,
      weight: 10,
      recommendation: "Keep upside in the case, but do not let it overwhelm evidence quality until financial and customer proof clears diligence.",
      details: [
        "The upside case is credible if legal workflow adoption expands across seats, matters, and recurring document workflows.",
        "The risk adjustment is meaningful because valuation, market saturation, and legal-AI competition can compress outcomes even with a useful product.",
      ],
      sources: [
        { type: "deck", label: "Upside path and market sizing", locator: "Pitch deck slides 9-11" },
        { type: "external", label: "Irys public positioning", locator: "Company website", url: "https://www.irys.ai/" },
      ],
    },
  ],
  claims: [
    {
      claim: "$1.8M+ ARR and 200+ paying firms",
      verdict: "deck-only",
      source: "Pitch deck claim; needs primary financial diligence.",
      sources: [
        { type: "deck", label: "ARR and paid firms", locator: "Pitch deck slide 8" },
      ],
    },
    {
      claim: "300+ legal teams use the product",
      verdict: "supported",
      source: "Public site sanity check in prior review session.",
      sources: [
        { type: "external", label: "Irys public usage claim", locator: "Company website", url: "https://www.irys.ai/" },
      ],
    },
    {
      claim: "131% NRR and 97%+ retention",
      verdict: "needs-review",
      source: "Deck-level metric; ask for cohort export or billing proof.",
      sources: [
        { type: "deck", label: "Retention and NRR", locator: "Pitch deck slide 8" },
      ],
    },
    {
      claim: "Generic legal AI tools are not a competitive threat",
      verdict: "refuted",
      source: "Market has strong competition; moat depends on workflow depth and retention.",
      sources: [
        { type: "deck", label: "Competitive differentiation claim", locator: "Pitch deck slide 10" },
        { type: "external", label: "Irys product surface", locator: "Company website", url: "https://www.irys.ai/" },
      ],
    },
  ],
  upside:
    "If retention, matter memory, Word workflow, and legal-team adoption are real, Irys can become a sticky legal operating layer with expanding seats and matter-level data advantages.",
  bear:
    "If ARR, retention, or NRR are deck-only and competition compresses differentiation, the company may look like another legal AI wrapper with expensive GTM and limited pricing power.",
  sourceContext: [
    "Prior session: 019e2ddb-801b-7ab0-a38c-138865ece4a7",
    "User pattern: AI-native workflow apps with shipped revenue; cautious on health and biotech without strong validation.",
  ],
};

const FOLDER_LOG_STORAGE_KEY = "agent-builder-investment-folder-log";

function sourceLine(source) {
  const prefix = `${source.type}: ${source.label}`;
  const locator = source.locator ? `, ${source.locator}` : "";
  return source.url ? `${prefix}${locator} - ${source.url}` : `${prefix}${locator}`;
}

function defaultWeights() {
  return Object.fromEntries(SAMPLE_REVIEW.scores.map((item) => [item.id, item.weight]));
}

function normalizeWeights(weights) {
  const total = Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0);
  if (!total) return defaultWeights();
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, (Number(value || 0) / total) * 100]));
}

function weightedScore(weights) {
  const normalized = normalizeWeights(weights);
  const score = SAMPLE_REVIEW.scores.reduce((sum, item) => sum + item.value * (normalized[item.id] / 100), 0);
  return Math.round(score);
}

function recommendationForScore(value) {
  if (value >= 88) return "Invest / high-conviction diligence";
  if (value >= 80) return "Advance to diligence";
  if (value >= 70) return "Watchlist";
  return "Pass unless new evidence changes the case";
}

function weightTextFrom(weights) {
  return SAMPLE_REVIEW.scores.map((item) => `${item.label}: ${Math.round(weights[item.id] ?? item.weight)}`).join("\n");
}

function parseWeightText(text) {
  const next = { ...defaultWeights() };
  for (const rawLine of text.split("\n")) {
    const [rawLabel, rawValue] = rawLine.split(":");
    if (!rawLabel || rawValue === undefined) continue;
    const match = SAMPLE_REVIEW.scores.find((item) => item.label.toLowerCase() === rawLabel.trim().toLowerCase());
    const value = Number(rawValue.trim());
    if (match && Number.isFinite(value) && value >= 0) next[match.id] = value;
  }
  return normalizeWeights(next);
}

function hashBuffer(buffer) {
  return crypto.subtle.digest("SHA-256", buffer).then((digest) => (
    Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")
  ));
}

function summarizeFolder(files, removed = []) {
  const changed = files.filter((file) => file.changeStatus === "changed").length;
  const added = files.filter((file) => file.changeStatus === "added").length;
  const unchanged = files.filter((file) => file.changeStatus === "unchanged").length;
  const deckLike = files.filter((file) => [".pdf", ".ppt", ".pptx", ".key"].includes(file.extension)).length;
  const readable = files.filter((file) => file.textPreview).length;
  const changedDealFiles = files.filter((file) => file.isDealMaterial && file.changeStatus === "changed").length;
  const addedDealFiles = files.filter((file) => file.isDealMaterial && file.changeStatus === "added").length;
  const removedDealFiles = removed.filter((file) => file.isDealMaterial).length;
  const materialSignals = summarizeMaterialSignals(files);
  return {
    totalFiles: files.length,
    deckLikeFiles: deckLike,
    added,
    changed,
    unchanged,
    removed: removed.length,
    readableTextFiles: readable,
    changedDealFiles,
    addedDealFiles,
    removedDealFiles,
    extractedMaterialFiles: materialSignals.dealFilesWithExtractedText,
    changedDealFilesWithExtractedText: materialSignals.changedDealFilesWithExtractedText,
    claimCandidateCount: materialSignals.claimCandidateCount,
  };
}

function folderAssessment(log) {
  if (!log) return "";
  const summary = log.summary ?? {};
  const materialChanges = (summary.changedDealFiles ?? 0) + (summary.addedDealFiles ?? 0) + (summary.removedDealFiles ?? 0);
  if (materialChanges > 0) return "Material deal files changed. Re-run claim extraction and scoring before relying on the prior recommendation.";
  if ((summary.changed ?? 0) > 0 || (summary.added ?? 0) > 0 || (summary.removed ?? 0) > 0) return "Non-deal files changed. Review notes and supporting files, but prior deck-based scoring may still be usable.";
  return "No file-level changes detected against the last saved browser log.";
}

function markdownFromState({ score, recommendation, conviction, checkSize, notes, weights, scenarioScore, scenarioRecommendation, researchValidation }) {
  const scoringWeights = weights ?? normalizeWeights(defaultWeights());
  const researchRows = researchValidation?.results ?? [];
  return `# ${SAMPLE_REVIEW.company} Investment Review

## Recommendation

- Agent score: ${SAMPLE_REVIEW.agentScore}/100
- Human score: ${score}/100
- Recommendation: ${recommendation}
- Conviction: ${conviction}
- Check size: ${checkSize}
- Reweighted score: ${scenarioScore ?? SAMPLE_REVIEW.agentScore}/100
- Reweighted recommendation: ${scenarioRecommendation ?? SAMPLE_REVIEW.recommendation}

## Notes

${notes || "No notes yet."}

## Upside Case

${SAMPLE_REVIEW.upside}

## Bear Case

${SAMPLE_REVIEW.bear}

## Claim Validation Snapshot

${SAMPLE_REVIEW.claims.map((claim) => `- ${claim.verdict}: ${claim.claim} (${claim.source})`).join("\n")}

## External Research Validation

${researchRows.length ? researchRows.map((item) => `- ${item.verdict}: ${item.claim}`).join("\n") : "- Not run in this review session."}

## Scoring Weights

${SAMPLE_REVIEW.scores.map((item) => `- ${item.label}: ${Math.round(scoringWeights[item.id] ?? item.weight)}%`).join("\n")}

## Score Detail Sources

${SAMPLE_REVIEW.scores.map((item) => `### ${item.label}\n${item.sources.map((source) => `- ${sourceLine(source)}`).join("\n")}`).join("\n\n")}

## Source Context

${SAMPLE_REVIEW.sourceContext.map((item) => `- ${item}`).join("\n")}
`;
}

function Verdict({ value }) {
  return <span className={`investment-verdict investment-verdict-${value}`}>{value}</span>;
}

function SourceList({ sources }) {
  return (
    <ul className="investment-source-list">
      {sources.map((source) => (
        <li key={`${source.type}-${source.label}-${source.locator}`}>
          <span>{source.type}</span>
          <strong>{source.label}</strong>
          <small>{source.locator}</small>
          {source.url && (
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.url}
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

function FolderStatusBadge({ value }) {
  return <span className={`folder-status folder-status-${value}`}>{value}</span>;
}

export default function InvestmentsPage() {
  const [selectedScoreId, setSelectedScoreId] = useState(SAMPLE_REVIEW.scores[0].id);
  const [weights, setWeights] = useState(defaultWeights);
  const [weightText, setWeightText] = useState(() => weightTextFrom(defaultWeights()));
  const [folderLog, setFolderLog] = useState(null);
  const [folderStatus, setFolderStatus] = useState({ status: "idle" });
  const [folderSaveState, setFolderSaveState] = useState({ status: "idle" });
  const [researchState, setResearchState] = useState({ status: "idle" });
  const [score, setScore] = useState(86);
  const [recommendation, setRecommendation] = useState(SAMPLE_REVIEW.recommendation);
  const [conviction, setConviction] = useState("Medium-high");
  const [checkSize, setCheckSize] = useState("Diligence first");
  const [notes, setNotes] = useState("Verify ARR, NRR, retention cohorts, customer concentration, and legal-market competitive overlap before committing capital.");
  const [saveState, setSaveState] = useState({ status: "idle" });

  const selectedScore = SAMPLE_REVIEW.scores.find((item) => item.id === selectedScoreId) ?? SAMPLE_REVIEW.scores[0];
  const normalizedWeights = useMemo(() => normalizeWeights(weights), [weights]);
  const scenarioScore = useMemo(() => weightedScore(weights), [weights]);
  const scenarioRecommendation = recommendationForScore(scenarioScore);
  const scenarioDelta = scenarioScore - SAMPLE_REVIEW.agentScore;
  const markdownPreview = useMemo(
    () => markdownFromState({ score, recommendation, conviction, checkSize, notes, weights: normalizedWeights, scenarioScore, scenarioRecommendation, researchValidation: researchState.validation }),
    [score, recommendation, conviction, checkSize, notes, normalizedWeights, scenarioScore, scenarioRecommendation, researchState.validation],
  );

  function updateWeight(id, value) {
    const next = normalizeWeights({ ...weights, [id]: Number(value) });
    setWeights(next);
    setWeightText(weightTextFrom(next));
  }

  function applyPlainTextWeights() {
    const next = parseWeightText(weightText);
    setWeights(next);
    setWeightText(weightTextFrom(next));
  }

  function resetWeights() {
    const next = defaultWeights();
    setWeights(next);
    setWeightText(weightTextFrom(next));
  }

  async function handleFolderSelection(event) {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (!selectedFiles.length) return;
    setFolderStatus({ status: "scanning", message: `Scanning ${selectedFiles.length} files` });
    setFolderSaveState({ status: "idle" });

    try {
      const prior = JSON.parse(localStorage.getItem(FOLDER_LOG_STORAGE_KEY) || "null");
      const priorFiles = new Map((prior?.files ?? []).map((file) => [file.relativePath, file]));
      const currentPaths = new Set();
      const files = [];

      for (const file of selectedFiles) {
        const relativePath = file.webkitRelativePath || file.name;
        currentPaths.add(relativePath);
        const buffer = await file.arrayBuffer();
        const sha256 = await hashBuffer(buffer);
        const previous = priorFiles.get(relativePath);
        const changeStatus = !previous ? "added" : previous.sha256 !== sha256 || previous.size !== file.size ? "changed" : "unchanged";
        const classification = classifyInvestmentFile(file);
        let textPreview = "";
        if (classification.isTextReadable) {
          textPreview = new TextDecoder().decode(buffer.slice(0, 2400));
        } else if (classification.isBinaryTextCandidate) {
          textPreview = extractPrintableText(buffer, { maxChars: 6000 });
        }
        files.push(buildMaterialFileRecord({
          relativePath,
          name: file.name,
          extension: classification.extension,
          size: file.size,
          lastModified: new Date(file.lastModified).toISOString(),
          sha256,
          changeStatus,
          textPreview,
        }, { previous, textPreview }));
      }

      const removed = [...priorFiles.values()]
        .filter((file) => !currentPaths.has(file.relativePath))
        .map((file) => ({ ...file, changeStatus: "removed" }));
      const rootFolder = selectedFiles[0]?.webkitRelativePath?.split("/")?.[0] || "selected-folder";
      const log = {
        schemaVersion: "agent-builder.investment-folder-log.v1",
        createdAt: new Date().toISOString(),
        folderName: rootFolder,
        researchBasis: [
          { type: "standard", label: "WICG File System Access API", locator: "user-gated directory access", url: "https://wicg.github.io/file-system-access/" },
          { type: "standard", label: "W3C File API", locator: "name, size, lastModified, immutable File data", url: "https://www.w3.org/TR/FileAPI/" },
          { type: "standard", label: "W3C Web Cryptography API", locator: "SubtleCrypto digest for SHA-256 fingerprints", url: "https://w3c.github.io/webcrypto/" },
          { type: "research", label: "MCDA sensitivity analysis", locator: "weight changes can alter decision ranking", url: "https://www.betterevaluation.org/sites/default/files/multicriteria_analysis.pdf" },
        ],
        files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
        removed,
        materialSignals: summarizeMaterialSignals(files),
        summary: summarizeFolder(files, removed),
      };
      setFolderLog(log);
      setFolderStatus({ status: "ready", message: `${log.summary.changed} changed, ${log.summary.added} added, ${log.summary.removed} removed` });
    } catch (error) {
      setFolderStatus({ status: "error", message: error instanceof Error ? error.message : "Folder scan failed" });
    }
  }

  async function saveFolderLog() {
    if (!folderLog) return;
    setFolderSaveState({ status: "saving" });
    localStorage.setItem(FOLDER_LOG_STORAGE_KEY, JSON.stringify(folderLog));
    try {
      const response = await fetch("/api/investments/folder-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(folderLog),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Could not save folder log");
      setFolderSaveState({ status: "saved", path: body.path });
    } catch (error) {
      setFolderSaveState({ status: "error", error: error instanceof Error ? error.message : "Could not save folder log" });
    }
  }

  async function saveReview() {
    setSaveState({ status: "saving" });
    try {
      const response = await fetch("/api/investments/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          company: SAMPLE_REVIEW.company,
          score,
          recommendation,
          conviction,
          checkSize,
          notes,
          sourceContext: SAMPLE_REVIEW.sourceContext,
          claims: SAMPLE_REVIEW.claims,
          researchValidation: researchState.validation,
          scoreDetails: SAMPLE_REVIEW.scores,
          scoringWeights: normalizedWeights,
        }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Save failed");
      setSaveState({ status: "saved", path: body.path });
    } catch (error) {
      setSaveState({ status: "error", error: error instanceof Error ? error.message : "Save failed" });
    }
  }

  async function validateExternalResearch() {
    setResearchState({ status: "running" });
    try {
      const response = await fetch("/api/investments/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claims: SAMPLE_REVIEW.claims }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Research validation failed");
      setResearchState({ status: "ready", validation: body.validation });
    } catch (error) {
      setResearchState({ status: "error", error: error instanceof Error ? error.message : "Research validation failed" });
    }
  }

  return (
    <main className="investment-shell">
      <section className="investment-header">
        <div>
          <p className="eyebrow">Investment Opportunity Agent</p>
          <h1>{SAMPLE_REVIEW.company}</h1>
          <p>{SAMPLE_REVIEW.headline}</p>
        </div>
        <a className="ghost-button" href="/">
          <FileText size={16} />
          Builder
        </a>
      </section>

      <section className="investment-layout">
        <div className="investment-main">
          <section className="investment-band">
            <div className="investment-score">
              <Gauge size={22} />
              <span>Agent score</span>
              <strong>{SAMPLE_REVIEW.agentScore}</strong>
            </div>
            <div className="investment-call">
              <BadgeCheck size={20} />
              <div>
                <span>Recommendation</span>
                <strong>{SAMPLE_REVIEW.recommendation}</strong>
              </div>
            </div>
          </section>

          <section className="investment-section">
            <h2><SlidersHorizontal size={18} /> Scoring Mechanism</h2>
            <div className="score-impact">
              <div>
                <span>Reweighted score</span>
                <strong>{scenarioScore}</strong>
                <small>{scenarioDelta >= 0 ? "+" : ""}{scenarioDelta} vs current agent score</small>
              </div>
              <div>
                <span>Recommendation impact</span>
                <strong>{scenarioRecommendation}</strong>
                <small>Weights are normalized to 100%</small>
              </div>
            </div>
            <div className="weight-grid">
              <div className="weight-sliders">
                {SAMPLE_REVIEW.scores.map((item) => (
                  <label className="weight-row" key={item.id}>
                    <span>{item.label}</span>
                    <input
                      type="range"
                      min="0"
                      max="60"
                      value={Math.round(normalizedWeights[item.id] ?? item.weight)}
                      onChange={(event) => updateWeight(item.id, event.target.value)}
                    />
                    <strong>{Math.round(normalizedWeights[item.id] ?? item.weight)}%</strong>
                  </label>
                ))}
              </div>
              <div className="weight-text">
                <label className="field">
                  <span>Plain text weights</span>
                  <textarea rows={7} value={weightText} onChange={(event) => setWeightText(event.target.value)} />
                </label>
                <div className="button-row">
                  <button className="ghost-button" type="button" onClick={applyPlainTextWeights}>
                    Apply Text
                  </button>
                  <button className="ghost-button" type="button" onClick={resetWeights}>
                    <RefreshCw size={15} />
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="investment-grid">
            {SAMPLE_REVIEW.scores.map((item) => (
              <button
                className={`investment-card investment-score-button ${item.id === selectedScoreId ? "is-active" : ""}`}
                key={item.label}
                onClick={() => setSelectedScoreId(item.id)}
                type="button"
              >
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <meter min="0" max="100" value={item.value} />
              </button>
            ))}
          </section>

          <section className="investment-section">
            <h2>{selectedScore.label} Details</h2>
            <p className="investment-recommendation">{selectedScore.recommendation}</p>
            <ul className="investment-list">
              {selectedScore.details.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <h3>Sources</h3>
            <SourceList sources={selectedScore.sources} />
          </section>

          <section className="investment-section">
            <h2>Preference Fit</h2>
            <ul className="investment-list">
              {SAMPLE_REVIEW.preferenceFit.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>

          <section className="investment-section">
            <div className="section-heading-row">
              <h2>Claim Validation</h2>
              <button className="ghost-button" type="button" onClick={validateExternalResearch} disabled={researchState.status === "running"}>
                <ShieldCheck size={15} />
                {researchState.status === "running" ? "Validating" : "Validate Sources"}
              </button>
            </div>
            <div className="investment-table-wrap">
              <table className="investment-table">
                <thead>
                  <tr>
                    <th>Claim</th>
                    <th>Verdict</th>
                    <th>Source note</th>
                    <th>Sources</th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_REVIEW.claims.map((item) => (
                    <tr key={item.claim}>
                      <td>{item.claim}</td>
                      <td><Verdict value={item.verdict} /></td>
                      <td>{item.source}</td>
                      <td><SourceList sources={item.sources} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {researchState.status === "ready" && (
              <div className="research-validation">
                <div className="folder-summary">
                  <div><span>Supported</span><strong>{researchState.validation.summary.externallySupported}</strong></div>
                  <div><span>Partial</span><strong>{researchState.validation.summary.partiallySupported}</strong></div>
                  <div><span>Not found</span><strong>{researchState.validation.summary.notFound}</strong></div>
                  <div><span>Fetch failed</span><strong>{researchState.validation.summary.fetchFailed}</strong></div>
                </div>
                <div className="investment-table-wrap">
                  <table className="investment-table">
                    <thead>
                      <tr>
                        <th>Claim</th>
                        <th>External verdict</th>
                        <th>Matched terms</th>
                        <th>External sources</th>
                      </tr>
                    </thead>
                    <tbody>
                      {researchState.validation.results.map((item) => (
                        <tr key={item.claim}>
                          <td>{item.claim}</td>
                          <td><Verdict value={item.verdict} /></td>
                          <td>{item.sourceResults.flatMap((result) => result.evidence.matchedTerms).slice(0, 6).join(", ") || "none"}</td>
                          <td><SourceList sources={item.sourceResults.map((result) => result.source)} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {researchState.status === "error" && <p className="investment-save-state is-error">{researchState.error}</p>}
          </section>

          <section className="investment-case-grid">
            <div className="investment-case">
              <h2><TrendingUp size={18} /> Upside Case</h2>
              <p>{SAMPLE_REVIEW.upside}</p>
            </div>
            <div className="investment-case">
              <h2><TrendingDown size={18} /> Bear Case</h2>
              <p>{SAMPLE_REVIEW.bear}</p>
            </div>
          </section>

          <section className="investment-section">
            <h2><FolderOpen size={18} /> Folder Intake And Deck Change Log</h2>
            <p className="investment-recommendation">
              Select a deal folder to fingerprint all files. Decks, PDFs, spreadsheets, and notes are logged by relative path, size, modified time, and SHA-256 hash. The current scan is compared with the last saved log to flag updates.
            </p>
            <label className="folder-picker">
              <input type="file" multiple webkitdirectory="" directory="" onChange={handleFolderSelection} />
              <span>Select Folder</span>
            </label>
            {folderStatus.status !== "idle" && <p className={`investment-save-state ${folderStatus.status === "error" ? "is-error" : ""}`}>{folderStatus.message}</p>}
            {folderLog && (
              <>
                <div className="folder-summary">
                  <div><span>Total files</span><strong>{folderLog.summary.totalFiles}</strong></div>
                  <div><span>Deal files</span><strong>{folderLog.summary.deckLikeFiles}</strong></div>
                  <div><span>Changed deal files</span><strong>{folderLog.summary.changedDealFiles}</strong></div>
                  <div><span>Changed</span><strong>{folderLog.summary.changed}</strong></div>
                  <div><span>Added</span><strong>{folderLog.summary.added}</strong></div>
                  <div><span>Removed</span><strong>{folderLog.summary.removed}</strong></div>
                  <div><span>Text extracted</span><strong>{folderLog.summary.extractedMaterialFiles}</strong></div>
                  <div><span>Claim signals</span><strong>{folderLog.summary.claimCandidateCount}</strong></div>
                </div>
                <p className="investment-recommendation">{folderAssessment(folderLog)}</p>
                {folderLog.materialSignals.claimCandidates.length > 0 && (
                  <>
                    <h3>Extracted Claim Signals</h3>
                    <ul className="investment-list">
                      {folderLog.materialSignals.claimCandidates.slice(0, 8).map((item) => (
                        <li key={`${item.file}-${item.claim}`}>{item.claim} <small>({item.file})</small></li>
                      ))}
                    </ul>
                  </>
                )}
                <h3>Research Basis</h3>
                <SourceList sources={folderLog.researchBasis} />
                <div className="investment-table-wrap">
                  <table className="investment-table">
                    <thead>
                      <tr>
                        <th>File</th>
                        <th>Status</th>
                        <th>Type</th>
                        <th>Size</th>
                        <th>Content signals</th>
                        <th>Hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...folderLog.files, ...folderLog.removed].slice(0, 40).map((file) => (
                        <tr key={`${file.changeStatus}-${file.relativePath}`}>
                          <td>{file.relativePath}</td>
                          <td><FolderStatusBadge value={file.changeStatus} /></td>
                          <td>{file.extension || "none"}</td>
                          <td>{file.size?.toLocaleString?.() ?? file.size}</td>
                          <td>{file.claimCandidates?.length ? `${file.claimCandidates.length} claims` : file.extractedTextChars ? `${file.extractedTextChars} chars` : "none"}</td>
                          <td><code>{file.sha256?.slice(0, 16)}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="button-row">
                  <button className="primary-button" type="button" onClick={saveFolderLog}>
                    <FileJson size={16} />
                    Save Log
                  </button>
                  {folderSaveState.status === "saved" && <p className="investment-save-state">Saved: {folderSaveState.path}</p>}
                  {folderSaveState.status === "error" && <p className="investment-save-state is-error">{folderSaveState.error}</p>}
                </div>
              </>
            )}
          </section>
        </div>

        <aside className="investment-review-panel">
          <h2><ShieldCheck size={18} /> My Review</h2>
          <label className="field">
            <span>Human score</span>
            <input type="number" min="0" max="100" value={score} onChange={(event) => setScore(event.target.value)} />
          </label>
          <label className="field">
            <span>Recommendation</span>
            <select value={recommendation} onChange={(event) => setRecommendation(event.target.value)}>
              <option>Advance to diligence</option>
              <option>Watchlist</option>
              <option>Pass</option>
              <option>Invest</option>
            </select>
          </label>
          <label className="field">
            <span>Conviction</span>
            <select value={conviction} onChange={(event) => setConviction(event.target.value)}>
              <option>Low</option>
              <option>Medium</option>
              <option>Medium-high</option>
              <option>High</option>
            </select>
          </label>
          <label className="field">
            <span>Check size</span>
            <input value={checkSize} onChange={(event) => setCheckSize(event.target.value)} />
          </label>
          <label className="field">
            <span>Notes</span>
            <textarea rows={7} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <button className="primary-button investment-save" onClick={saveReview} disabled={saveState.status === "saving"}>
            <Save size={16} />
            {saveState.status === "saving" ? "Saving" : "Save Markdown"}
          </button>
          {saveState.status === "saved" && <p className="investment-save-state">Saved: {saveState.path}</p>}
          {saveState.status === "error" && <p className="investment-save-state is-error">{saveState.error}</p>}
          <textarea className="investment-markdown" readOnly value={markdownPreview} rows={12} />
        </aside>
      </section>
    </main>
  );
}
