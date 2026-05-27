import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { inflateRawSync, inflateSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { MAC_RAM_PROFILES, profileByRam } from "./meeting-model-profiles.mjs";

const DEFAULT_STORE_DIR = join("agent-outputs", "local-knowledge-agent", "store");
const DEFAULT_STORE_FILE = "store.json";
const DEFAULT_DB_FILE = "knowledge.db";
const DEFAULT_OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const DEFAULT_CHAT_MODEL = process.env.MEETING_SUMMARY_MODEL ?? "qwen3:14b";
const DEFAULT_EMBEDDING_MODEL = process.env.MEETING_EMBED_MODEL ?? "nomic-embed-text";
const DEFAULT_OMNIPARSE_ENTRY = process.env.OMNIPARSE_SDK_PATH ?? "/Users/tyroneross/dev/git-folder/Omniparse/packages/sdk/dist/index.mjs";
const HASH_DIMENSIONS = 384;
const MAX_CHUNKS_PER_EMBED_BATCH = 16;
const MAX_OLLAMA_EMBED_CHARS = 6000;
const MAX_SUMMARY_CONTEXT_CHARS = 30000;
const SQL_LIMIT = 24;

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".html",
  ".htm",
  ".xml",
  ".log",
  ".srt",
  ".vtt",
]);

const OMNIPARSE_EXTENSIONS = new Set([".xlsx", ".xls", ".csv", ".tsv", ".ods", ".xlsb", ".pptx", ".py", ".pdf"]);

const ACTION_RE = /\b(action|todo|to-do|follow up|follow-up|owner|assigned|will|needs to|need to|next step|by \w+day|due|deadline)\b/i;
const DECISION_RE = /\b(decided|decision|agreed|approved|rejected|go with|aligned on|resolved)\b/i;
const NOTE_RE = /\b(priority|risk|blocker|customer|launch|budget|timeline|metric|revenue|hiring|product|partner|issue|concern)\b/i;

export async function analyzeMeetingUploads(uploads, options = {}) {
  const files = Array.from(uploads ?? []).filter(Boolean);
  if (!files.length) throw new Error("At least one upload is required.");

  const extracted = [];
  for (const upload of files) {
    extracted.push(await extractTextFromUpload(upload, {
      parserMode: options.parserMode ?? "auto",
      omniparseEntry: options.omniparseEntry,
      omniparseParseMode: options.omniparseParseMode,
    }));
  }

  const readable = extracted.filter((item) => item.text.trim());
  if (!readable.length) {
    throw new Error("No readable text was extracted from the uploaded files.");
  }

  const warnings = extracted.flatMap((item) => item.warnings);
  const profile = profileByRam(options.ramProfile ?? "24gb");
  const meetingTitle = cleanInline(options.meetingTitle) || titleFromFiles(readable);
  const combinedText = readable
    .map((item) => `# Source: ${item.name}\n\n${item.text}`)
    .join("\n\n---\n\n");
  const transcriptHash = sha256(`${meetingTitle}\n${readable.map((item) => item.sha256).join("\n")}`);
  const documentId = `meeting-${transcriptHash.slice(0, 16)}`;
  const now = options.createdAt ?? new Date().toISOString();
  const store = await loadMeetingStore(options);
  const retrievalQuery = cleanInline(options.retrievalQuery) || `${meetingTitle} ${firstWords(combinedText, 80)}`;
  const priorContext = await searchStore(store, retrievalQuery, {
    embeddingModel: options.embeddingModel || profile.embeddingModel || DEFAULT_EMBEDDING_MODEL,
    limit: options.retrievalLimit ?? 5,
    preferOllama: options.preferOllama !== false,
  });

  const summaryResult = await summarizeMeeting({
    title: meetingTitle,
    text: combinedText,
    files: readable,
    retrievedContext: priorContext.results,
    guidance: options.guidance,
    chatModel: options.chatModel || profile.chatModel || DEFAULT_CHAT_MODEL,
    outputInstructions: options.outputInstructions,
    modelOptions: modelOptionsFrom(options),
    preferOllama: options.preferOllama !== false,
  });

  const chunks = chunkText(combinedText).map((chunk, index) => ({
    id: `${documentId}-chunk-${String(index + 1).padStart(4, "0")}`,
    documentId,
    meetingTitle,
    sourceName: sourceNameForOffset(readable, combinedText, chunk.start) ?? meetingTitle,
    index,
    text: chunk.text,
    start: chunk.start,
    end: chunk.end,
  }));

  const embeddingResult = await embedTexts(chunks.map((chunk) => chunk.text), {
    embeddingModel: options.embeddingModel || profile.embeddingModel || DEFAULT_EMBEDDING_MODEL,
    preferOllama: options.preferOllama !== false,
  });
  warnings.push(...embeddingResult.warnings);
  if (summaryResult.warning) warnings.push(summaryResult.warning);

  const nextStore = rebuildKnowledgeGraph(upsertDocument(store, {
    document: {
      id: documentId,
      meetingTitle,
      createdAt: now,
      updatedAt: now,
      files: readable.map((item) => ({
        name: item.name,
        extension: item.extension,
        mediaType: item.mediaType,
        bytes: item.bytes,
        sha256: item.sha256,
        extraction: item.extraction,
      })),
      chunkCount: chunks.length,
      summary: summaryResult.output.summary,
      actionItemCount: summaryResult.output.actionItems.length,
      nextStepCount: summaryResult.output.nextSteps.length,
      model: summaryResult.model,
      modelOptions: modelOptionsFrom(options),
      embedding: {
        provider: embeddingResult.provider,
        model: embeddingResult.model,
        dimensions: embeddingResult.dimensions,
      },
      ramProfile: profile.id,
    },
    chunks: chunks.map((chunk, index) => ({
      ...chunk,
      vector: embeddingResult.vectors[index],
      vectorProvider: embeddingResult.provider,
      vectorModel: embeddingResult.model,
      textHash: sha256(chunk.text),
      createdAt: now,
    })),
    run: {
      id: `run-${now.replace(/[^0-9a-z]/gi, "-")}-${documentId.slice(-8)}`,
      documentId,
      meetingTitle,
      createdAt: now,
      summaryModel: summaryResult.model,
      embeddingModel: {
        provider: embeddingResult.provider,
        model: embeddingResult.model,
      },
      retrievedChunkIds: priorContext.results.map((item) => item.id),
      outputs: {
        notes: summaryResult.output.notes.length,
        actionItems: summaryResult.output.actionItems.length,
        nextSteps: summaryResult.output.nextSteps.length,
        decisions: summaryResult.output.decisions.length,
      },
    },
  }));

  await saveMeetingStore(nextStore, options);
  await saveKnowledgeDatabase(nextStore, options);
  const stats = storeStats(nextStore, options);

  return {
    ok: true,
    schemaVersion: "agent-builder.meeting-transcript-agent.result.v1",
    documentId,
    meetingTitle,
    createdAt: now,
    files: extracted.map(({ text, ...item }) => ({
      ...item,
      extractedChars: text.length,
    })),
    storedChunks: chunks.length,
    retrievedContext: priorContext.results,
    knowledgeGraph: nextStore.graph,
    output: summaryResult.output,
    markdown: buildMeetingMarkdown({
      meetingTitle,
      output: summaryResult.output,
      retrievedContext: priorContext.results,
      files: readable,
      createdAt: now,
    }),
    model: summaryResult.model,
    embedding: {
      provider: embeddingResult.provider,
      model: embeddingResult.model,
      dimensions: embeddingResult.dimensions,
    },
    localDatabase: databaseInfo(options),
    store: stats,
    warnings: uniqueStrings(warnings).slice(0, 12),
  };
}

export async function searchMeetingMemory(query, options = {}) {
  const store = await loadMeetingStore(options);
  const mode = ["semantic", "sql", "hybrid"].includes(options.mode) ? options.mode : "hybrid";
  if (!existsSync(resolveDbFile(options)) && store.chunks.length) await saveKnowledgeDatabase(rebuildKnowledgeGraph(store), options);
  const semantic = mode === "sql"
    ? { results: [], embedding: { provider: "none", model: null }, warnings: [] }
    : await searchStore(store, query, {
      embeddingModel: options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
      limit: options.limit ?? 8,
      preferOllama: options.preferOllama !== false,
    });
  const sql = mode === "semantic" ? { results: [] } : searchKnowledgeSql(query, options);
  const results = mode === "semantic"
    ? semantic.results
    : mode === "sql"
      ? sql.results
      : mergeRetrievalResults(semantic.results, sql.results, options.limit ?? 8);
  return {
    ok: true,
    mode,
    query,
    results,
    semanticResults: semantic.results,
    sqlResults: sql.results,
    embedding: semantic.embedding,
    store: storeStats(store, options),
    graph: store.graph ?? { entities: [], relations: [] },
    warnings: semantic.warnings,
  };
}

export async function getMeetingStoreStats(options = {}) {
  const store = await loadMeetingStore(options);
  return storeStats(store, options);
}

export function buildMeetingInstallBundle(options = {}) {
  const profile = profileByRam(options.ramProfile ?? "24gb");
  const createdAt = options.createdAt ?? new Date().toISOString();
  return {
    schemaVersion: "agent-builder.single-file-install.v1",
    name: "Local Knowledge Agent",
    createdAt,
    selfContained: true,
    installType: "single-json-bundle",
    recommendedProfile: profile,
    supportedRamProfiles: MAC_RAM_PROFILES,
    localDatabase: {
      engine: "SQLite",
      defaultPath: DEFAULT_STORE_DIR,
      file: DEFAULT_DB_FILE,
      tables: ["documents", "chunks", "entities", "relations", "runs"],
    },
    retrieval: {
      modes: ["semantic", "sql", "hybrid"],
      vectorStore: DEFAULT_STORE_FILE,
      embeddingFallback: "deterministic local hashing vectorizer",
    },
    knowledgeGraph: {
      method: "local entity phrase extraction plus chunk co-occurrence relations",
      tables: ["entities", "relations"],
    },
    parser: {
      preferred: "Omniparse local SDK",
      fallback: "internal text, RTF, PDF-best-effort, and printable-text extraction",
      omniparsePath: DEFAULT_OMNIPARSE_ENTRY,
    },
    defaultControls: {
      chatModel: profile.chatModel,
      embeddingModel: profile.embeddingModel,
      temperature: 0.1,
      topP: 0.9,
      numCtx: profile.numCtx,
      numPredict: profile.numPredict,
    },
    install: {
      requiredRuntime: "Node.js 22+ for built-in SQLite support",
      optionalRuntime: "Ollama for local chat and embeddings",
      copyPolicy: "Save this file as local-knowledge-agent.agent.json and import it into an Agent Builder-compatible host.",
    },
  };
}

export async function extractTextFromUpload(upload, options = {}) {
  const { name, mediaType, buffer } = await readUpload(upload);
  const extension = extname(name).toLowerCase();
  const warnings = [];
  let text = "";
  let extraction = "utf8";
  let parserMetadata = null;

  const omniparse = await parseWithOmniparse({ name, buffer, extension, options });
  if (omniparse?.text) {
    text = omniparse.text;
    extraction = omniparse.extraction;
    parserMetadata = omniparse.metadata;
    warnings.push(...omniparse.warnings);
  } else if (omniparse?.warnings?.length) {
    warnings.push(...omniparse.warnings);
  }

  if (text) {
    // Omniparse succeeded.
  } else if (TEXT_EXTENSIONS.has(extension) || mediaType.startsWith("text/")) {
    text = decodeUtf8(buffer);
  } else if (extension === ".rtf" || mediaType === "application/rtf" || mediaType === "text/rtf") {
    extraction = "rtf";
    text = rtfToText(decodeUtf8(buffer));
  } else if (extension === ".pdf" || mediaType === "application/pdf") {
    extraction = "pdf-best-effort";
    text = extractPdfText(buffer);
    if (text.length < 120) {
      warnings.push(`${name}: PDF text extraction was limited. If the PDF is scanned or heavily encoded, export text and upload the .txt version.`);
    }
  } else {
    extraction = "printable-text";
    text = printableText(buffer);
    warnings.push(`${name}: used best-effort printable text extraction for unsupported type ${extension || mediaType || "unknown"}.`);
  }

  text = cleanText(text);
  if (!text) warnings.push(`${name}: no readable text was found.`);

  return {
    name,
    mediaType,
    extension,
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
    extraction,
    parserMetadata,
    text,
    warnings,
  };
}

export function chunkText(text, options = {}) {
  const maxChars = options.maxChars ?? 2200;
  const overlap = options.overlap ?? 240;
  const source = cleanText(text);
  if (!source) return [];

  const paragraphs = source.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let cursor = 0;
  let current = "";
  let start = 0;

  for (const paragraph of paragraphs) {
    if (!current) start = source.indexOf(paragraph, cursor);
    if ((current + "\n\n" + paragraph).length > maxChars && current) {
      const end = start + current.length;
      chunks.push({ text: current.trim(), start, end });
      const tail = current.slice(Math.max(0, current.length - overlap));
      current = `${tail}\n\n${paragraph}`;
      start = Math.max(0, end - tail.length);
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
    cursor = Math.max(cursor, source.indexOf(paragraph, cursor) + paragraph.length);
  }

  if (current.trim()) chunks.push({ text: current.trim(), start, end: start + current.length });

  return chunks.flatMap((chunk) => {
    if (chunk.text.length <= maxChars * 1.4) return [chunk];
    const pieces = [];
    for (let i = 0; i < chunk.text.length; i += maxChars - overlap) {
      const textPart = chunk.text.slice(i, i + maxChars).trim();
      if (textPart) pieces.push({ text: textPart, start: chunk.start + i, end: chunk.start + i + textPart.length });
    }
    return pieces;
  });
}

export function hashEmbedding(text, dimensions = HASH_DIMENSIONS) {
  const counts = new Map();
  for (const token of tokenize(text)) counts.set(token, (counts.get(token) ?? 0) + 1);
  const vector = new Array(dimensions).fill(0);
  for (const [token, count] of counts) {
    const digest = createHash("sha256").update(token).digest();
    const index = digest.readUInt32BE(0) % dimensions;
    const sign = digest[4] % 2 === 0 ? 1 : -1;
    vector[index] += sign * (1 + Math.log(count));
  }
  return normalizeVector(vector);
}

export function buildMeetingMarkdown({ meetingTitle, output, retrievedContext = [], files = [], createdAt }) {
  const actions = output.actionItems.length
    ? output.actionItems.map((item) => `- ${item.owner || "Unassigned"}: ${item.task}${item.due ? ` (due ${item.due})` : ""}`).join("\n")
    : "- No action items identified.";
  const notes = output.notes.length
    ? output.notes.map((item) => `- ${item.text}`).join("\n")
    : "- No notes identified.";
  const nextSteps = output.nextSteps.length
    ? output.nextSteps.map((item) => `- ${item.text}${item.owner ? ` (${item.owner})` : ""}`).join("\n")
    : "- No next steps identified.";
  const decisions = output.decisions.length
    ? output.decisions.map((item) => `- ${item.text}`).join("\n")
    : "- No decisions identified.";
  const questions = output.openQuestions.length
    ? output.openQuestions.map((item) => `- ${item.text}`).join("\n")
    : "- No open questions identified.";
  const context = retrievedContext.length
    ? retrievedContext.map((item) => `- ${item.meetingTitle || item.sourceName}: ${item.excerpt}`).join("\n")
    : "- No prior meeting context retrieved.";

  return `---
schema: agent-builder.local-knowledge-output.v1
knowledge_title: ${JSON.stringify(meetingTitle)}
created_at: ${createdAt}
source_files: ${files.length}
retrieval_scope: local-knowledge
---

# ${meetingTitle}

## Summary

${output.summary}

## Notes

${notes}

## Action Items

${actions}

## Next Steps

${nextSteps}

## Decisions

${decisions}

## Open Questions

${questions}

## Retrieved Prior Context

${context}
`;
}

async function summarizeMeeting({ title, text, files, retrievedContext, guidance, chatModel, outputInstructions, modelOptions, preferOllama }) {
  if (preferOllama && chatModel) {
    try {
      const result = await summarizeWithOllama({ title, text, files, retrievedContext, guidance, chatModel, outputInstructions, modelOptions });
      return {
        output: normalizeSummaryOutput(result.parsed, text),
        model: { provider: "ollama", model: chatModel, metrics: result.metrics },
      };
    } catch (error) {
      return {
        output: extractiveSummary({ title, text, files, retrievedContext }),
        model: { provider: "extractive-fallback", model: "local-heuristics" },
        warning: `Ollama summary failed; used local extractive fallback. ${error.message}`,
      };
    }
  }

  return {
    output: extractiveSummary({ title, text, files, retrievedContext }),
    model: { provider: "extractive-fallback", model: "local-heuristics" },
  };
}

async function summarizeWithOllama({ title, text, files, retrievedContext, guidance, chatModel, outputInstructions, modelOptions = {} }) {
  const sourceInventory = files.map((file) => `${file.name}: ${file.text.length} chars via ${file.extraction}`).join("\n");
  const prior = retrievedContext.length
    ? retrievedContext.map((item, index) => `[${index + 1}] ${item.meetingTitle || item.sourceName}: ${item.excerpt}`).join("\n")
    : "No prior context retrieved.";
  const prompt = {
    meetingTitle: title,
    operatorGuidance: cleanText(guidance || "Summarize for a human operator who needs notes, action items, and next steps."),
    outputInstructions: cleanText(outputInstructions || "Use the default format: summary, notes, action items, next steps, decisions, and open questions."),
    sourceInventory,
    priorMeetingContext: prior,
    transcript: compactTranscriptForPrompt(text),
    requiredOutput: {
      summary: "one concise paragraph",
      notes: [{ text: "material note", source: "source file or transcript section if available" }],
      actionItems: [{ owner: "person/team or Unassigned", task: "specific action", due: "date/time or null", source: "source phrase if available" }],
      nextSteps: [{ text: "concrete next step", owner: "person/team or null", timing: "date/window or null" }],
      decisions: [{ text: "decision made or explicitly pending", source: "source phrase if available" }],
      openQuestions: [{ text: "question or missing decision", owner: "person/team or null" }],
    },
  };

  const response = await fetch(`${DEFAULT_OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: chatModel,
      stream: false,
      format: "json",
      options: {
        temperature: modelOptions.temperature,
        top_p: modelOptions.topP,
        num_ctx: modelOptions.numCtx,
        num_predict: modelOptions.numPredict,
      },
      messages: [
        {
          role: "system",
          content: "You produce source-faithful meeting notes. Return only valid JSON. Do not invent owners, due dates, decisions, or facts.",
        },
        {
          role: "user",
          content: JSON.stringify(prompt),
        },
      ],
    }),
    signal: AbortSignal.timeout(180000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ollama ${response.status}: ${body.slice(0, 300)}`);
  }

  const body = await response.json();
  const content = body?.message?.content ?? "";
  try {
    return {
      parsed: JSON.parse(content),
      metrics: {
        totalDurationNs: body.total_duration ?? null,
        loadDurationNs: body.load_duration ?? null,
        promptEvalCount: body.prompt_eval_count ?? null,
        promptEvalDurationNs: body.prompt_eval_duration ?? null,
        evalCount: body.eval_count ?? null,
        evalDurationNs: body.eval_duration ?? null,
      },
    };
  } catch {
    throw new Error("ollama returned non-JSON meeting summary");
  }
}

async function parseWithOmniparse({ name, buffer, extension, options }) {
  if (options.parserMode === "internal") return null;
  if (!OMNIPARSE_EXTENSIONS.has(extension)) return null;

  const entry = options.omniparseEntry ?? DEFAULT_OMNIPARSE_ENTRY;
  if (!entry || !existsSync(entry)) {
    return {
      text: "",
      warnings: [`${name}: Omniparse SDK was not found at ${entry}; used internal parser fallback.`],
    };
  }

  const tmpRoot = await mkdtemp(join(tmpdir(), "agent-builder-omniparse-"));
  const filePath = join(tmpRoot, safeFileName(name, extension));
  try {
    await writeFile(filePath, buffer);
    const sdk = await import(pathToFileURL(entry).href);
    if (typeof sdk.parse !== "function") throw new Error("Omniparse SDK does not export parse()");
    const parsed = await sdk.parse(filePath, {
      parseMode: options.omniparseParseMode ?? "text",
      includeNotes: true,
      quiet: true,
    });
    const result = Array.isArray(parsed) ? parsed[0] : parsed;
    const markdown = cleanText(result?.markdown);
    const text = markdown || cleanText(result?.text);
    return {
      text,
      extraction: `omniparse:${result?.inputType ?? extension.slice(1)}`,
      metadata: {
        wordCount: result?.wordCount ?? null,
        estimatedTokens: result?.estimatedTokens ?? null,
        parseTime: result?.parseTime ?? null,
        inputType: result?.inputType ?? null,
      },
      warnings: (result?.errors ?? []).map((error) => `${name}: ${error}`),
    };
  } catch (error) {
    return {
      text: "",
      warnings: [`${name}: Omniparse parse failed; used internal parser fallback. ${error.message}`],
    };
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

function modelOptionsFrom(options = {}) {
  return {
    temperature: numberOption(options.temperature, 0.1, 0, 2),
    topP: numberOption(options.topP, 0.9, 0.05, 1),
    numCtx: integerOption(options.numCtx, 32768, 2048, 131072),
    numPredict: integerOption(options.numPredict, 2048, 256, 8192),
  };
}

function numberOption(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function integerOption(value, fallback, min, max) {
  return Math.round(numberOption(value, fallback, min, max));
}

async function embedTexts(texts, options = {}) {
  const normalizedTexts = texts.map((item) => cleanText(item).slice(0, MAX_OLLAMA_EMBED_CHARS));
  if (options.preferOllama && options.embeddingModel) {
    const vectors = [];
    try {
      for (let i = 0; i < normalizedTexts.length; i += MAX_CHUNKS_PER_EMBED_BATCH) {
        const batch = normalizedTexts.slice(i, i + MAX_CHUNKS_PER_EMBED_BATCH);
        vectors.push(...await ollamaEmbed(batch, options.embeddingModel));
      }
      return {
        provider: "ollama",
        model: options.embeddingModel,
        dimensions: vectors[0]?.length ?? 0,
        vectors: vectors.map(normalizeVector),
        warnings: [],
      };
    } catch (error) {
      return {
        provider: "local-hash",
        model: "hashing-vectorizer",
        dimensions: HASH_DIMENSIONS,
        vectors: normalizedTexts.map((text) => hashEmbedding(text)),
        warnings: [`Ollama embeddings failed; used deterministic local hash vectors. ${error.message}`],
      };
    }
  }

  return {
    provider: "local-hash",
    model: "hashing-vectorizer",
    dimensions: HASH_DIMENSIONS,
    vectors: normalizedTexts.map((text) => hashEmbedding(text)),
    warnings: [],
  };
}

async function ollamaEmbed(texts, model) {
  const response = await fetch(`${DEFAULT_OLLAMA_BASE}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: texts, truncate: true }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`ollama embed ${response.status}: ${body.slice(0, 300)}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload.embeddings)) throw new Error("ollama embed response did not include embeddings");
  return payload.embeddings;
}

async function searchStore(store, query, options = {}) {
  if (!cleanText(query) || !store.chunks.length) {
    return {
      results: [],
      embedding: { provider: "none", model: null },
      warnings: [],
    };
  }

  const embedding = await embedTexts([query], {
    embeddingModel: options.embeddingModel ?? DEFAULT_EMBEDDING_MODEL,
    preferOllama: options.preferOllama !== false,
  });
  const queryVector = embedding.vectors[0];
  const scored = store.chunks
    .map((chunk) => {
      const vectorScore = cosine(queryVector, chunk.vector ?? []);
      const lexicalScore = lexicalOverlap(query, chunk.text);
      return {
        id: chunk.id,
        documentId: chunk.documentId,
        meetingTitle: chunk.meetingTitle,
        sourceName: chunk.sourceName,
        score: Number((vectorScore * 0.82 + lexicalScore * 0.18).toFixed(4)),
        vectorScore: Number(vectorScore.toFixed(4)),
        lexicalScore: Number(lexicalScore.toFixed(4)),
        excerpt: excerptForQuery(chunk.text, query),
        createdAt: chunk.createdAt,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 8);

  return {
    results: scored,
    embedding: {
      provider: embedding.provider,
      model: embedding.model,
      dimensions: embedding.dimensions,
    },
    warnings: embedding.warnings,
  };
}

function extractiveSummary({ title, text, files, retrievedContext }) {
  const sentences = splitSentences(text);
  const lines = text.split(/\n+/).map((item) => cleanInline(item)).filter((item) => item.length > 12);
  const noteSentences = rankedSentences(sentences, NOTE_RE).slice(0, 8);
  const actionLines = rankedSentences([...lines, ...sentences], ACTION_RE).slice(0, 12);
  const decisionLines = rankedSentences([...lines, ...sentences], DECISION_RE).slice(0, 6);
  const questionLines = lines.filter((line) => line.includes("?") || /\b(open question|unclear|confirm|verify)\b/i.test(line)).slice(0, 6);
  const summaryBase = noteSentences.slice(0, 3).map((item) => item.text).join(" ");
  const retrievedNote = retrievedContext.length ? ` Prior related context was found in ${retrievedContext.length} stored chunk${retrievedContext.length === 1 ? "" : "s"}.` : "";

  return {
    summary: summaryBase || `${titleFromFiles(files)} was processed from ${files.length} source file${files.length === 1 ? "" : "s"}.${retrievedNote}`,
    notes: noteSentences.map((item) => ({ text: item.text, source: "transcript" })),
    actionItems: actionLines.map((item) => parseActionItem(item.text)),
    nextSteps: actionLines.slice(0, 6).map((item) => ({
      text: item.text,
      owner: ownerFromText(item.text),
      timing: dueFromText(item.text),
    })),
    decisions: decisionLines.map((item) => ({ text: item.text, source: "transcript" })),
    openQuestions: questionLines.map((text) => ({ text, owner: ownerFromText(text) })),
  };
}

function normalizeSummaryOutput(value, fallbackText) {
  const fallback = extractiveSummary({ title: "Meeting", text: fallbackText, files: [], retrievedContext: [] });
  return {
    summary: cleanInline(value?.summary) || fallback.summary,
    notes: normalizeObjectList(value?.notes, "text").slice(0, 16),
    actionItems: normalizeObjectList(value?.actionItems, "task").map((item) => ({
      owner: cleanInline(item.owner) || "Unassigned",
      task: cleanInline(item.task || item.text) || "Review meeting follow-up.",
      due: cleanInline(item.due) || null,
      source: cleanInline(item.source) || null,
    })).slice(0, 20),
    nextSteps: normalizeObjectList(value?.nextSteps, "text").map((item) => ({
      text: cleanInline(item.text || item.task) || "Review next step.",
      owner: cleanInline(item.owner) || null,
      timing: cleanInline(item.timing || item.due) || null,
    })).slice(0, 12),
    decisions: normalizeObjectList(value?.decisions, "text").slice(0, 12),
    openQuestions: normalizeObjectList(value?.openQuestions, "text").map((item) => ({
      text: cleanInline(item.text || item.question) || "Confirm unresolved item.",
      owner: cleanInline(item.owner) || null,
    })).slice(0, 12),
  };
}

async function readUpload(upload) {
  const name = cleanInline(upload?.name) || "meeting-upload.txt";
  const mediaType = cleanInline(upload?.type) || "application/octet-stream";
  if (Buffer.isBuffer(upload?.buffer)) return { name, mediaType, buffer: upload.buffer };
  if (upload?.arrayBuffer) return { name, mediaType, buffer: Buffer.from(await upload.arrayBuffer()) };
  if (upload instanceof Uint8Array) return { name, mediaType, buffer: Buffer.from(upload) };
  throw new Error(`Unsupported upload object for ${name}`);
}

async function loadMeetingStore(options = {}) {
  const file = resolveStoreFile(options);
  if (!existsSync(file)) return emptyStore();
  try {
    const store = JSON.parse(await readFile(file, "utf8"));
    return {
      ...emptyStore(),
      ...store,
      documents: Array.isArray(store.documents) ? store.documents : [],
      chunks: Array.isArray(store.chunks) ? store.chunks : [],
      runs: Array.isArray(store.runs) ? store.runs : [],
    };
  } catch {
    return emptyStore();
  }
}

async function saveMeetingStore(store, options = {}) {
  const file = resolveStoreFile(options);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  return file;
}

function resolveStoreFile(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const configured = options.storePath ?? process.env.MEETING_VECTOR_STORE_PATH ?? DEFAULT_STORE_DIR;
  const base = isAbsolute(configured) ? resolve(configured) : resolve(root, configured);
  return extname(base) ? base : join(base, DEFAULT_STORE_FILE);
}

function emptyStore() {
  const now = new Date().toISOString();
  return {
    schemaVersion: "agent-builder.local-knowledge-store.v1",
    createdAt: now,
    updatedAt: now,
    documents: [],
    chunks: [],
    runs: [],
    graph: {
      entities: [],
      relations: [],
    },
  };
}

function upsertDocument(store, { document, chunks, run }) {
  return {
    ...store,
    documents: [
      document,
      ...store.documents.filter((item) => item.id !== document.id),
    ],
    chunks: [
      ...store.chunks.filter((item) => item.documentId !== document.id),
      ...chunks,
    ],
    runs: [run, ...store.runs].slice(0, 100),
    updatedAt: document.updatedAt,
  };
}

function rebuildKnowledgeGraph(store) {
  const entityMap = new Map();
  const relationMap = new Map();

  for (const chunk of store.chunks ?? []) {
    const entities = extractEntities(chunk.text).slice(0, 16);
    for (const label of entities) {
      const id = entityId(label);
      const current = entityMap.get(id) ?? {
        id,
        label,
        type: entityType(label),
        occurrences: 0,
        documentIds: new Set(),
      };
      current.occurrences += 1;
      current.documentIds.add(chunk.documentId);
      entityMap.set(id, current);
    }

    for (let i = 0; i < entities.length; i += 1) {
      for (let j = i + 1; j < Math.min(entities.length, i + 6); j += 1) {
        const a = entityId(entities[i]);
        const b = entityId(entities[j]);
        if (!a || !b || a === b) continue;
        const [source, target] = [a, b].sort();
        const id = `${source}--${target}`;
        const current = relationMap.get(id) ?? {
          id,
          source,
          target,
          type: "co_occurs",
          weight: 0,
          documentIds: new Set(),
        };
        current.weight += 1;
        current.documentIds.add(chunk.documentId);
        relationMap.set(id, current);
      }
    }
  }

  return {
    ...store,
    graph: {
      entities: [...entityMap.values()]
        .map((item) => ({ ...item, documentIds: [...item.documentIds] }))
        .sort((a, b) => b.occurrences - a.occurrences)
        .slice(0, 200),
      relations: [...relationMap.values()]
        .map((item) => ({ ...item, documentIds: [...item.documentIds] }))
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 400),
    },
  };
}

async function saveKnowledgeDatabase(store, options = {}) {
  const file = resolveDbFile(options);
  await mkdir(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    ensureKnowledgeSchema(db);
    db.exec("BEGIN");
    db.exec("DELETE FROM documents");
    db.exec("DELETE FROM chunks");
    db.exec("DELETE FROM entities");
    db.exec("DELETE FROM relations");
    db.exec("DELETE FROM runs");

    const insertDocument = db.prepare(`INSERT INTO documents
      (id, title, created_at, updated_at, summary, chunk_count, action_item_count, next_step_count, files_json, model_json, embedding_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const doc of store.documents ?? []) {
      insertDocument.run(
        doc.id,
        doc.meetingTitle,
        doc.createdAt,
        doc.updatedAt,
        doc.summary,
        doc.chunkCount ?? 0,
        doc.actionItemCount ?? 0,
        doc.nextStepCount ?? 0,
        JSON.stringify(doc.files ?? []),
        JSON.stringify(doc.model ?? {}),
        JSON.stringify(doc.embedding ?? {}),
      );
    }

    const insertChunk = db.prepare(`INSERT INTO chunks
      (id, document_id, source_name, chunk_index, text, text_hash, vector_provider, vector_model, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const chunk of store.chunks ?? []) {
      insertChunk.run(
        chunk.id,
        chunk.documentId,
        chunk.sourceName,
        chunk.index,
        chunk.text,
        chunk.textHash,
        chunk.vectorProvider,
        chunk.vectorModel,
        chunk.createdAt,
      );
    }

    const insertEntity = db.prepare(`INSERT INTO entities
      (id, label, type, occurrences, document_ids_json)
      VALUES (?, ?, ?, ?, ?)`);
    for (const entity of store.graph?.entities ?? []) {
      insertEntity.run(entity.id, entity.label, entity.type, entity.occurrences, JSON.stringify(entity.documentIds ?? []));
    }

    const insertRelation = db.prepare(`INSERT INTO relations
      (id, source, target, type, weight, document_ids_json)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const relation of store.graph?.relations ?? []) {
      insertRelation.run(relation.id, relation.source, relation.target, relation.type, relation.weight, JSON.stringify(relation.documentIds ?? []));
    }

    const insertRun = db.prepare(`INSERT INTO runs
      (id, document_id, created_at, summary_model_json, embedding_model_json, outputs_json)
      VALUES (?, ?, ?, ?, ?, ?)`);
    for (const run of store.runs ?? []) {
      insertRun.run(
        run.id,
        run.documentId,
        run.createdAt,
        JSON.stringify(run.summaryModel ?? {}),
        JSON.stringify(run.embeddingModel ?? {}),
        JSON.stringify(run.outputs ?? {}),
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

function ensureKnowledgeSchema(db) {
  db.exec(`
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  summary TEXT,
  chunk_count INTEGER DEFAULT 0,
  action_item_count INTEGER DEFAULT 0,
  next_step_count INTEGER DEFAULT 0,
  files_json TEXT NOT NULL,
  model_json TEXT NOT NULL,
  embedding_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  source_name TEXT,
  chunk_index INTEGER,
  text TEXT NOT NULL,
  text_hash TEXT,
  vector_provider TEXT,
  vector_model TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL,
  occurrences INTEGER DEFAULT 0,
  document_ids_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  type TEXT NOT NULL,
  weight INTEGER DEFAULT 0,
  document_ids_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  summary_model_json TEXT NOT NULL,
  embedding_model_json TEXT NOT NULL,
  outputs_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_document_idx ON chunks(document_id);
CREATE INDEX IF NOT EXISTS chunks_source_idx ON chunks(source_name);
CREATE INDEX IF NOT EXISTS entities_label_idx ON entities(label);
`);
}

function searchKnowledgeSql(query, options = {}) {
  const file = resolveDbFile(options);
  if (!existsSync(file) || !cleanText(query)) return { results: [] };
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const chunkStmt = db.prepare(`
SELECT c.id, c.document_id AS documentId, d.title AS meetingTitle, c.source_name AS sourceName,
       c.text, c.created_at AS createdAt
FROM chunks c
LEFT JOIN documents d ON d.id = c.document_id
WHERE c.text LIKE ? ESCAPE '\\'
   OR c.source_name LIKE ? ESCAPE '\\'
   OR d.title LIKE ? ESCAPE '\\'
ORDER BY c.created_at DESC
LIMIT ?`);
    const entityStmt = db.prepare(`
SELECT id, label, type, occurrences
FROM entities
WHERE label LIKE ? ESCAPE '\\'
ORDER BY occurrences DESC
LIMIT ?`);
    const likes = [`%${cleanText(query).replace(/[%_]/g, "\\$&")}%`];
    for (const term of tokenize(query).slice(0, 6)) likes.push(`%${term.replace(/[%_]/g, "\\$&")}%`);
    const rowMap = new Map();
    const entityMap = new Map();
    for (const like of likes) {
      for (const row of chunkStmt.all(like, like, like, options.limit ?? SQL_LIMIT)) rowMap.set(row.id, row);
      for (const row of entityStmt.all(like, Math.max(4, Math.min(12, options.limit ?? SQL_LIMIT)))) entityMap.set(row.id, row);
      if (rowMap.size >= (options.limit ?? SQL_LIMIT)) break;
    }
    const rows = [...rowMap.values()];
    const entityRows = [...entityMap.values()];
    return {
      results: [
        ...rows.map((row) => ({
          id: `sql:${row.id}`,
          source: "sql",
          documentId: row.documentId,
          meetingTitle: row.meetingTitle,
          sourceName: row.sourceName,
          score: 1,
          excerpt: excerptForQuery(row.text, query),
          createdAt: row.createdAt,
        })),
        ...entityRows.map((row) => ({
          id: `sql:entity:${row.id}`,
          source: "sql",
          documentId: null,
          meetingTitle: "Knowledge graph",
          sourceName: row.type,
          score: Number((0.75 + Math.min(0.24, row.occurrences / 100)).toFixed(4)),
          excerpt: `${row.label} appears ${row.occurrences} time${row.occurrences === 1 ? "" : "s"} in the local graph.`,
          createdAt: null,
        })),
      ].slice(0, options.limit ?? SQL_LIMIT),
    };
  } finally {
    db.close();
  }
}

function mergeRetrievalResults(semanticResults, sqlResults, limit) {
  const merged = new Map();
  for (const item of semanticResults) merged.set(item.id.replace(/^sql:/, ""), { ...item, source: item.source ?? "semantic" });
  for (const item of sqlResults) {
    const key = item.id.replace(/^sql:/, "");
    const current = merged.get(key);
    if (current) {
      merged.set(key, { ...current, source: "hybrid", score: Number(Math.max(current.score, item.score).toFixed(4)) });
    } else {
      merged.set(key, item);
    }
  }
  return [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

function resolveDbFile(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const configured = options.dbPath ?? process.env.MEETING_LOCAL_DB_PATH ?? join(DEFAULT_STORE_DIR, DEFAULT_DB_FILE);
  return isAbsolute(configured) ? resolve(configured) : resolve(root, configured);
}

function databaseInfo(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const file = resolveDbFile(options);
  return {
    engine: "sqlite",
    path: file.startsWith(root) ? relative(root, file) : file,
    tables: ["documents", "chunks", "entities", "relations", "runs"],
    exists: existsSync(file),
  };
}

function storeStats(store, options = {}) {
  const embeddingModels = new Set(store.chunks.map((chunk) => chunk.vectorModel).filter(Boolean));
  return {
    schemaVersion: store.schemaVersion,
    documents: store.documents.length,
    chunks: store.chunks.length,
    runs: store.runs.length,
    entities: store.graph?.entities?.length ?? 0,
    relations: store.graph?.relations?.length ?? 0,
    embeddingModels: [...embeddingModels],
    localDatabase: databaseInfo(options),
    latestDocument: store.documents[0] ?? null,
  };
}

function sourceNameForOffset(files, combinedText, offset) {
  for (const file of files) {
    const marker = `# Source: ${file.name}`;
    const start = combinedText.indexOf(marker);
    if (start >= 0 && offset >= start && offset <= start + marker.length + file.text.length + 20) return file.name;
  }
  return null;
}

function rtfToText(rtf) {
  return rtf
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(par|line)\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\\[{}\\]/g, (match) => match.slice(1))
    .replace(/\{\\\*[^{}]*\}/g, "")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

function extractPdfText(buffer) {
  const raw = buffer.toString("latin1");
  const streams = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamRe.exec(raw)) !== null) {
    const streamBuffer = Buffer.from(match[1], "latin1");
    streams.push(streamBuffer);
  }

  const decoded = [];
  for (const stream of streams) {
    decoded.push(decodePdfStream(stream));
  }
  if (!decoded.length) decoded.push(raw);

  const text = decoded.map(extractPdfTextOperators).filter(Boolean).join("\n");
  return text || printableText(buffer);
}

function decodePdfStream(buffer) {
  for (const fn of [inflateSync, inflateRawSync]) {
    try {
      return fn(buffer).toString("latin1");
    } catch {}
  }
  return buffer.toString("latin1");
}

function extractPdfTextOperators(streamText) {
  if (!/(BT|Tj|TJ|Tf|Td)/.test(streamText)) return "";
  const matches = streamText.match(/\((?:\\.|[^\\()])*\)/g) ?? [];
  return matches
    .map((item) => decodePdfLiteral(item.slice(1, -1)))
    .filter((item) => /[a-zA-Z0-9]{2,}/.test(item))
    .join(" ");
}

function decodePdfLiteral(value) {
  return value.replace(/\\([nrtbf()\\])/g, (_, code) => {
    const map = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };
    return map[code] ?? code;
  }).replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function printableText(buffer) {
  const raw = buffer.toString("latin1");
  const runs = raw.match(/[ -~\t\r\n]{4,}/g) ?? [];
  return runs.join("\n").slice(0, 120000);
}

function compactTranscriptForPrompt(text) {
  const source = cleanText(text);
  if (source.length <= MAX_SUMMARY_CONTEXT_CHARS) return source;
  const actionLines = source
    .split(/\n+/)
    .filter((line) => ACTION_RE.test(line) || DECISION_RE.test(line))
    .slice(0, 120)
    .join("\n");
  return [
    source.slice(0, 12000),
    "\n\n[Middle transcript compressed]\n\n",
    actionLines,
    "\n\n[Final transcript section]\n\n",
    source.slice(-12000),
  ].join("").slice(0, MAX_SUMMARY_CONTEXT_CHARS);
}

function splitSentences(text) {
  return cleanText(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map(cleanInline)
    .filter((item) => item.length >= 24 && item.length <= 420);
}

function rankedSentences(sentences, matcher) {
  return sentences
    .map((text, index) => ({
      text,
      score: (matcher.test(text) ? 5 : 0) + Math.min(4, tokenize(text).length / 12) - index * 0.01,
    }))
    .filter((item) => item.score > 0.5)
    .sort((a, b) => b.score - a.score);
}

function parseActionItem(text) {
  return {
    owner: ownerFromText(text) || "Unassigned",
    task: cleanInline(text),
    due: dueFromText(text),
    source: "transcript",
  };
}

function ownerFromText(text) {
  const colon = text.match(/^([A-Z][A-Za-z .'-]{1,40}):\s+/);
  if (colon) return cleanInline(colon[1]);
  const owner = text.match(/\b(?:owner|assigned to|by)\s*:?\s*([A-Z][A-Za-z .'-]{1,40})/i);
  return owner ? cleanInline(owner[1]).replace(/\s+(will|to|by|due).*$/i, "") : null;
}

function dueFromText(text) {
  const due = text.match(/\b(?:due|by|deadline)\s*:?\s*([A-Za-z]+day|next week|this week|tomorrow|today|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})/i);
  return due ? cleanInline(due[1]) : null;
}

function extractEntities(text) {
  const matches = cleanText(text).match(/\b[A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,3}\b/g) ?? [];
  const stop = new Set([
    "Action",
    "Actions",
    "Decision",
    "Decisions",
    "Next",
    "Notes",
    "Open",
    "Question",
    "Questions",
    "Source",
    "Summary",
    "The",
    "This",
  ]);
  return uniqueStrings(matches)
    .map((item) => item.replace(/\s+(Notes|Summary|Action|Decision)$/i, ""))
    .filter((item) => item.length >= 3 && item.length <= 70)
    .filter((item) => !stop.has(item))
    .slice(0, 80);
}

function entityType(label) {
  if (/\b(Inc|LLC|Corp|Company|AI|Labs|Bank|Capital|Ventures)\b/.test(label)) return "organization";
  if (/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}$/.test(label)) return "person_or_topic";
  return "topic";
}

function entityId(label) {
  return cleanInline(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function excerptForQuery(text, query) {
  const terms = tokenize(query);
  const lower = text.toLowerCase();
  let index = -1;
  for (const term of terms) {
    index = lower.indexOf(term);
    if (index >= 0) break;
  }
  const start = Math.max(0, index - 180);
  const excerpt = text.slice(start, start + 420);
  return cleanInline(`${start > 0 ? "... " : ""}${excerpt}${start + 420 < text.length ? " ..." : ""}`);
}

function lexicalOverlap(a, b) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let overlap = 0;
  for (const token of aTokens) if (bTokens.has(token)) overlap += 1;
  return overlap / Math.sqrt(aTokens.size * bTokens.size);
}

function cosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let aMag = 0;
  let bMag = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    aMag += a[i] * a[i];
    bMag += b[i] * b[i];
  }
  if (!aMag || !bMag) return 0;
  return dot / Math.sqrt(aMag * bMag);
}

function normalizeVector(vector) {
  const mag = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!mag) return vector;
  return vector.map((value) => Number((value / mag).toFixed(8)));
}

function normalizeObjectList(value, textKey) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { [textKey]: cleanInline(item), text: cleanInline(item) };
      if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, val]) => [key, typeof val === "string" ? cleanInline(val) : val]));
      return null;
    })
    .filter(Boolean)
    .filter((item) => cleanInline(item[textKey] ?? item.text ?? item.task ?? item.question));
}

function tokenize(text) {
  return cleanText(text).toLowerCase().match(/[a-z0-9][a-z0-9'-]{1,}/g) ?? [];
}

function cleanText(text) {
  return String(text ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function cleanInline(text) {
  return cleanText(text).replace(/\s+/g, " ").trim();
}

function decodeUtf8(buffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

function titleFromFiles(files) {
  return cleanInline(files[0]?.name?.replace(/\.[^.]+$/, "")) || "Meeting Transcript";
}

function safeFileName(name, extension) {
  const cleaned = cleanInline(name).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (cleaned) return cleaned;
  return `upload${extension || ".txt"}`;
}

function firstWords(text, count) {
  return tokenize(text).slice(0, count).join(" ");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean).map(cleanInline))];
}
