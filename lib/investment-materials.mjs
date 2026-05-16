const TEXT_EXTENSIONS = new Set([".csv", ".json", ".md", ".txt", ".tsv"]);
const BINARY_TEXT_EXTENSIONS = new Set([".pdf", ".ppt", ".pptx", ".doc", ".docx"]);
const DEAL_EXTENSIONS = new Set([...TEXT_EXTENSIONS, ...BINARY_TEXT_EXTENSIONS, ".key", ".xlsx"]);

export function extensionOf(name = "") {
  const dot = String(name).lastIndexOf(".");
  return dot >= 0 ? String(name).slice(dot).toLowerCase() : "";
}

export function classifyInvestmentFile(file = {}) {
  const extension = file.extension || extensionOf(file.name || file.relativePath || "");
  return {
    extension,
    isDealMaterial: DEAL_EXTENSIONS.has(extension),
    isTextReadable: TEXT_EXTENSIONS.has(extension),
    isBinaryTextCandidate: BINARY_TEXT_EXTENSIONS.has(extension),
    isDeckLike: [".pdf", ".ppt", ".pptx", ".key"].includes(extension),
  };
}

export function extractPrintableText(buffer, options = {}) {
  const maxBytes = options.maxBytes ?? 240000;
  const bytes = new Uint8Array(buffer.slice(0, Math.min(buffer.byteLength, maxBytes)));
  const chunks = [];
  let current = "";

  for (const byte of bytes) {
    if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 13 || byte === 9) {
      current += String.fromCharCode(byte);
    } else if (current.length) {
      if (current.trim().length >= 4) chunks.push(current);
      current = "";
    }
  }
  if (current.trim().length >= 4) chunks.push(current);

  return normalizeWhitespace(chunks.join(" ")).slice(0, options.maxChars ?? 6000);
}

export function extractClaimCandidates(text = "", options = {}) {
  const maxClaims = options.maxClaims ?? 12;
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const claimLike = /(\$|%|\b\d+(\.\d+)?\b|\bARR\b|\bNRR\b|\bretention\b|\brevenue\b|\bcustomer\b|\busers?\b|\bmarket\b|\bTAM\b|\bgrowth\b)/i;
  const claims = [];
  const seen = new Set();

  for (const sentence of sentences) {
    if (!claimLike.test(sentence)) continue;
    const compact = sentence.slice(0, 260);
    const key = compact.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    claims.push(compact);
    if (claims.length >= maxClaims) break;
  }

  return claims;
}

export function summarizeTextDiff(previousText = "", currentText = "") {
  const previousLines = stableLines(previousText);
  const currentLines = stableLines(currentText);
  const previousSet = new Set(previousLines);
  const currentSet = new Set(currentLines);
  const added = currentLines.filter((line) => !previousSet.has(line)).slice(0, 12);
  const removed = previousLines.filter((line) => !currentSet.has(line)).slice(0, 12);

  return {
    addedCount: currentLines.filter((line) => !previousSet.has(line)).length,
    removedCount: previousLines.filter((line) => !currentSet.has(line)).length,
    added,
    removed,
  };
}

export function buildMaterialFileRecord(file, options = {}) {
  const classification = classifyInvestmentFile(file);
  const textPreview = normalizeWhitespace(options.textPreview || file.textPreview || "");
  const claimCandidates = extractClaimCandidates(textPreview);
  const previous = options.previous || null;
  const contentDiff = previous?.textPreview && textPreview
    ? summarizeTextDiff(previous.textPreview, textPreview)
    : null;

  return {
    ...file,
    extension: classification.extension,
    isDealMaterial: classification.isDealMaterial,
    textPreview,
    extractedTextChars: textPreview.length,
    claimCandidates,
    contentDiff,
  };
}

export function summarizeMaterialSignals(files = []) {
  const rows = files.filter((file) => file.isDealMaterial);
  const changedWithText = rows.filter((file) => file.changeStatus !== "unchanged" && file.extractedTextChars > 0);
  const claimCandidates = rows.flatMap((file) =>
    (file.claimCandidates ?? []).map((claim) => ({
      claim,
      file: file.relativePath || file.name,
      source: "folder-extracted-text",
    })),
  );

  return {
    dealFilesWithExtractedText: rows.filter((file) => file.extractedTextChars > 0).length,
    changedDealFilesWithExtractedText: changedWithText.length,
    claimCandidateCount: claimCandidates.length,
    claimCandidates: claimCandidates.slice(0, 30),
    contentChanges: changedWithText
      .filter((file) => file.contentDiff)
      .map((file) => ({
        file: file.relativePath || file.name,
        addedCount: file.contentDiff.addedCount,
        removedCount: file.contentDiff.removedCount,
        added: file.contentDiff.added,
        removed: file.contentDiff.removed,
      })),
  };
}

function stableLines(text = "") {
  return normalizeWhitespace(text)
    .split(/(?:\. |\n|; )/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8)
    .slice(0, 200);
}

export function normalizeWhitespace(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

export const INVESTMENT_TEXT_EXTENSIONS = TEXT_EXTENSIONS;
export const INVESTMENT_BINARY_TEXT_EXTENSIONS = BINARY_TEXT_EXTENSIONS;
export const INVESTMENT_DEAL_EXTENSIONS = DEAL_EXTENSIONS;
