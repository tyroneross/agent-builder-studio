import { normalizeWhitespace } from "./investment-materials.mjs";

export async function validateInvestmentClaims(claims = [], options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8000;
  const results = [];

  for (const claim of claims) {
    const externalSources = (claim.sources ?? []).filter((source) => source.url);
    const sourceResults = [];

    for (const source of externalSources) {
      sourceResults.push(await validateSourceAgainstClaim(claim, source, { fetcher, timeoutMs }));
    }

    results.push({
      claim: claim.claim || claim.text || "",
      priorVerdict: claim.verdict || claim.status || "unlabeled",
      verdict: verdictFromSourceResults(sourceResults),
      sourceResults,
      externalSourceCount: externalSources.length,
    });
  }

  return {
    schemaVersion: "agent-builder.investment-research-validation.v1",
    createdAt: options.createdAt ?? new Date().toISOString(),
    results,
    summary: summarizeValidation(results),
  };
}

async function validateSourceAgainstClaim(claim, source, options) {
  const url = source.url;
  try {
    const response = await options.fetcher(url, {
      headers: { "user-agent": "agent-builder-investment-validation" },
      signal: timeoutSignal(options.timeoutMs),
    });
    const body = await response.text();
    const text = normalizeWhitespace(stripHtml(body)).slice(0, 20000);
    const evidence = scoreEvidence(claim.claim || claim.text || "", text);
    return {
      source,
      ok: response.ok,
      status: response.status,
      evidence,
      excerpt: evidence.excerpt,
    };
  } catch (error) {
    return {
      source,
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
      evidence: { score: 0, matchedTerms: [], missingTerms: claimTerms(claim.claim || claim.text || ""), excerpt: "" },
      excerpt: "",
    };
  }
}

export function scoreEvidence(claim = "", sourceText = "") {
  const terms = claimTerms(claim);
  if (!terms.length) return { score: 0, matchedTerms: [], missingTerms: [], excerpt: "" };
  const normalizedSource = normalizeWhitespace(sourceText).toLowerCase();
  const matchedTerms = terms.filter((term) => normalizedSource.includes(term.toLowerCase()));
  const missingTerms = terms.filter((term) => !matchedTerms.includes(term));
  const score = Math.round((matchedTerms.length / terms.length) * 100);
  return {
    score,
    matchedTerms,
    missingTerms,
    excerpt: excerptForTerms(sourceText, matchedTerms),
  };
}

function verdictFromSourceResults(results) {
  if (!results.length) return "no-external-source";
  if (results.some((result) => result.evidence.score >= 70)) return "externally-supported";
  if (results.some((result) => result.ok && result.evidence.score >= 35)) return "partially-supported";
  if (results.some((result) => result.ok)) return "not-found-in-sources";
  return "source-fetch-failed";
}

function summarizeValidation(results) {
  return {
    totalClaims: results.length,
    externallySupported: results.filter((result) => result.verdict === "externally-supported").length,
    partiallySupported: results.filter((result) => result.verdict === "partially-supported").length,
    notFound: results.filter((result) => result.verdict === "not-found-in-sources").length,
    fetchFailed: results.filter((result) => result.verdict === "source-fetch-failed").length,
    noExternalSource: results.filter((result) => result.verdict === "no-external-source").length,
  };
}

export function claimTerms(claim = "") {
  const normalized = normalizeWhitespace(claim);
  const numeric = normalized.match(/\$?\d+(?:\.\d+)?\s?(?:M|B|K|%|x)?/gi) ?? [];
  const acronyms = normalized.match(/\b[A-Z]{2,}\b/g) ?? [];
  const words = normalized
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 5 && !STOP_WORDS.has(word));
  return [...new Set([...numeric, ...acronyms, ...words].slice(0, 12))];
}

function excerptForTerms(sourceText, matchedTerms) {
  if (!matchedTerms.length) return "";
  const normalized = normalizeWhitespace(sourceText);
  const lower = normalized.toLowerCase();
  const term = matchedTerms[0].toLowerCase();
  const index = lower.indexOf(term);
  if (index < 0) return "";
  return normalized.slice(Math.max(0, index - 120), index + 260);
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "against",
  "before",
  "claim",
  "firms",
  "generic",
  "legal",
  "needs",
  "product",
  "review",
  "source",
  "still",
  "tools",
  "using",
]);
