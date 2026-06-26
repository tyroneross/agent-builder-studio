"use client";

import {
  AlertTriangle,
  Bold,
  Brain,
  Database,
  Download,
  FileText,
  FileUp,
  Italic,
  List,
  Network,
  Pilcrow,
  RefreshCw,
  Search,
  Settings2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CHAT_MODELS, EMBEDDING_MODELS, MAC_RAM_PROFILES, profileByRam } from "../lib/meeting-model-profiles.mjs";

const DEFAULT_PROFILE = profileByRam("24gb");
const DEFAULTS = {
  chatModel: DEFAULT_PROFILE.chatModel,
  embeddingModel: DEFAULT_PROFILE.embeddingModel,
  parserMode: "auto",
  omniparseParseMode: "text",
  temperature: 0.1,
  topP: 0.9,
  numCtx: DEFAULT_PROFILE.numCtx,
  numPredict: DEFAULT_PROFILE.numPredict,
  guidance: "Keep the answer source-faithful. Do not invent facts, owners, dates, or decisions.",
  outputInstructions: "Return a concise answer, important notes, action items, next steps, decisions, and open questions.",
};

function markdownToHtml(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const html = [];
  let inList = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      continue;
    }
    if (line.startsWith("---")) continue;
    if (line.startsWith("# ")) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("- ")) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${escapeHtml(line.slice(2))}</li>`);
    } else if (!line.startsWith("schema:") && !line.startsWith("knowledge_title:") && !line.startsWith("created_at:") && !line.startsWith("source_files:") && !line.startsWith("retrieval_scope:")) {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
      html.push(`<p>${escapeHtml(line)}</p>`);
    }
  }

  if (inList) html.push("</ul>");
  return html.join("\n");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMsFromNs(value) {
  if (!value) return "n/a";
  return `${Math.round(value / 1_000_000)} ms`;
}

function formatFiles(files) {
  if (!files.length) return "Choose files to ingest";
  if (files.length === 1) return files[0].name;
  return `${files.length} files selected`;
}

function modelLabel(models, id) {
  return models.find((item) => item.id === id)?.label ?? id;
}

export default function MeetingsPage() {
  const editorRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [ramProfile, setRamProfile] = useState("24gb");
  const [settings, setSettings] = useState(DEFAULTS);
  const [status, setStatus] = useState({ status: "idle" });
  const [result, setResult] = useState(null);
  const [store, setStore] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState("hybrid");
  const [searchState, setSearchState] = useState({ status: "idle", results: [] });

  const profile = profileByRam(ramProfile);
  const modelMetrics = result?.model?.metrics;
  const richWordCount = useMemo(() => {
    if (!result?.markdown) return 0;
    return result.markdown.split(/\s+/).filter(Boolean).length;
  }, [result]);

  useEffect(() => {
    fetch("/api/meetings/analyze")
      .then((response) => response.json())
      .then((body) => {
        if (body.ok) setStore(body.store);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (editorRef.current && result?.markdown) {
      editorRef.current.innerHTML = markdownToHtml(result.markdown);
    }
  }, [result?.documentId, result?.markdown]);

  function updateSetting(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function applyProfile(id) {
    const nextProfile = profileByRam(id);
    setRamProfile(id);
    setSettings((current) => ({
      ...current,
      chatModel: nextProfile.chatModel,
      embeddingModel: nextProfile.embeddingModel,
      numCtx: nextProfile.numCtx,
      numPredict: nextProfile.numPredict,
    }));
  }

  function resetDefaults() {
    applyProfile("24gb");
    setSettings(DEFAULTS);
  }

  function richCommand(command, value = null) {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
  }

  async function ingestFiles() {
    if (!files.length) {
      setStatus({ status: "error", error: "No files selected. Choose one or more local files. Then run ingest again." });
      return;
    }

    const form = new FormData();
    for (const file of files) form.append("files", file);
    form.append("ramProfile", ramProfile);
    for (const [key, value] of Object.entries(settings)) form.append(key, value);

    setStatus({ status: "running", message: `Embedding ${files.length} file${files.length === 1 ? "" : "s"} into the local store.` });
    try {
      const response = await fetch("/api/meetings/analyze", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Ingest failed");
      setResult(body);
      setStore(body.store);
      setStatus({ status: "ready", message: `${body.storedChunks} chunks embedded. ${body.knowledgeGraph?.entities?.length ?? 0} graph entities saved.` });
    } catch (error) {
      setStatus({ status: "error", error: `Ingest failed. ${error instanceof Error ? error.message : "The local parser or database could not finish."} Try fewer files or export the source as text/PDF.` });
    }
  }

  async function searchMemory() {
    if (!searchQuery.trim()) {
      setSearchState({ status: "error", error: "Search is empty. Enter a term or question. Then search again.", results: [] });
      return;
    }
    setSearchState({ status: "running", results: [] });
    try {
      const response = await fetch("/api/meetings/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: searchQuery, mode: searchMode, embeddingModel: settings.embeddingModel, limit: 8 }),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Search failed");
      setSearchState({ status: "ready", results: body.results, mode: body.mode, warnings: body.warnings });
    } catch (error) {
      setSearchState({ status: "error", error: `Search failed. ${error instanceof Error ? error.message : "The local store could not answer."} Try hybrid mode or a broader query.`, results: [] });
    }
  }

  function exportBundle() {
    window.location.href = `/api/meetings/bundle?ram=${encodeURIComponent(ramProfile)}`;
  }

  return (
    <main className="meeting-shell">
      <section className="meeting-header">
        <div>
          <p className="eyebrow">Local Knowledge Agent</p>
          <h1>Ingest files. Search local knowledge.</h1>
          <p>Files stay local. The app stores parsed chunks, vectors, SQL rows, and a small graph.</p>
        </div>
        <a className="ghost-button" href="/">
          <FileText size={16} />
          Builder
        </a>
      </section>

      <section className="meeting-layout">
        <div className="meeting-main">
          <section className="meeting-section meeting-primary">
            <div className="section-heading-row">
              <h2><FileUp size={18} /> Source Files</h2>
              <span className="meeting-pill">{files.length} selected</span>
            </div>
            <label className="meeting-upload">
              <input
                type="file"
                multiple
                accept=".txt,.rtf,.pdf,.md,.csv,.json,.html,.htm,.log,.srt,.vtt,.xlsx,.xls,.tsv,.ods,.xlsb,.pptx,.py,.doc,.docx"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
              <span>{formatFiles(files)}</span>
            </label>
            <div className="meeting-quiet-grid">
              <label className="field">
                <span>Mac RAM</span>
                <select value={ramProfile} onChange={(event) => applyProfile(event.target.value)}>
                  {MAC_RAM_PROFILES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                </select>
              </label>
              <div className="meeting-recommendation">
                <span>Recommended</span>
                <strong>{modelLabel(CHAT_MODELS, profile.recommended)}</strong>
                <small>{profile.note}</small>
              </div>
            </div>
            <button
              className="primary-button meeting-run"
              type="button"
              onClick={ingestFiles}
              disabled={status.status === "running" || files.length === 0}
              title={files.length === 0 ? "Choose one or more files first" : undefined}
            >
              <Brain size={17} />
              {status.status === "running" ? "Ingesting Files" : "Ingest Files"}
            </button>
            {status.status === "running" && <p className="meeting-save-state">{status.message}</p>}
            {status.status === "ready" && <p className="meeting-save-state">{status.message}</p>}
            {status.status === "error" && <p className="meeting-error"><AlertTriangle size={15} /> {status.error}</p>}
          </section>

          <section className="meeting-section">
            <div className="section-heading-row">
              <h2><Search size={18} /> Retrieval</h2>
              <span className="meeting-pill">{searchMode}</span>
            </div>
            <div className="meeting-search-line">
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") searchMemory(); }}
                placeholder="Search sources..."
              />
              <select value={searchMode} onChange={(event) => setSearchMode(event.target.value)} aria-label="Retrieval mode">
                <option value="hybrid">Hybrid</option>
                <option value="semantic">Semantic</option>
                <option value="sql">SQL</option>
              </select>
              <button className="ghost-button" type="button" onClick={searchMemory} disabled={searchState.status === "running"}>
                <Search size={15} />
                Search
              </button>
            </div>
            {searchState.status === "error" && <p className="meeting-error"><AlertTriangle size={15} /> {searchState.error}</p>}
            <div className="meeting-search-results">
              {searchState.results.map((item) => (
                <article key={item.id}>
                  <span>{item.source ?? searchState.mode}</span>
                  <strong>{item.meetingTitle || item.sourceName}</strong>
                  <p>{item.excerpt}</p>
                </article>
              ))}
            </div>
          </section>

          {result && (
            <section className="meeting-section">
              <div className="section-heading-row">
                <h2><FileText size={18} /> Rich Output</h2>
                <span className="meeting-pill">{richWordCount} words</span>
              </div>
              <div className="meeting-rich-toolbar">
                <button className="icon-button" type="button" onClick={() => richCommand("bold")} title="Bold"><Bold size={16} /></button>
                <button className="icon-button" type="button" onClick={() => richCommand("italic")} title="Italic"><Italic size={16} /></button>
                <button className="icon-button" type="button" onClick={() => richCommand("insertUnorderedList")} title="Bullets"><List size={16} /></button>
                <button className="icon-button" type="button" onClick={() => richCommand("formatBlock", "p")} title="Paragraph"><Pilcrow size={16} /></button>
              </div>
              <div className="meeting-rich-editor" ref={editorRef} contentEditable suppressContentEditableWarning />
              {!!result.warnings?.length && (
                <div className="meeting-warning-list">
                  {result.warnings.map((warning) => <p key={warning}><AlertTriangle size={14} /> {warning}</p>)}
                </div>
              )}
            </section>
          )}

          <details className="meeting-section meeting-details">
            <summary><Settings2 size={17} /> Advanced Settings</summary>
            <div className="meeting-form-grid">
              <label className="field">
                <span>Answer model</span>
                <select value={settings.chatModel} onChange={(event) => updateSetting("chatModel", event.target.value)}>
                  {CHAT_MODELS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Embedding model</span>
                <select value={settings.embeddingModel} onChange={(event) => updateSetting("embeddingModel", event.target.value)}>
                  {EMBEDDING_MODELS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Parser</span>
                <select value={settings.parserMode} onChange={(event) => updateSetting("parserMode", event.target.value)}>
                  <option value="auto">Omniparse + fallback</option>
                  <option value="internal">Internal only</option>
                </select>
              </label>
              <label className="field">
                <span>Parse depth</span>
                <select value={settings.omniparseParseMode} onChange={(event) => updateSetting("omniparseParseMode", event.target.value)}>
                  <option value="text">Text</option>
                  <option value="full">Full</option>
                </select>
              </label>
            </div>
            <div className="meeting-slider-grid">
              <label className="meeting-slider">
                <span>Temperature <strong>{settings.temperature}</strong></span>
                <input type="range" min="0" max="1" step="0.05" value={settings.temperature} onChange={(event) => updateSetting("temperature", event.target.value)} />
              </label>
              <label className="meeting-slider">
                <span>Top P <strong>{settings.topP}</strong></span>
                <input type="range" min="0.05" max="1" step="0.05" value={settings.topP} onChange={(event) => updateSetting("topP", event.target.value)} />
              </label>
              <label className="field">
                <span>Context tokens</span>
                <input type="number" min="2048" max="131072" step="1024" value={settings.numCtx} onChange={(event) => updateSetting("numCtx", event.target.value)} />
              </label>
              <label className="field">
                <span>Output tokens</span>
                <input type="number" min="256" max="8192" step="256" value={settings.numPredict} onChange={(event) => updateSetting("numPredict", event.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Prompt guidance</span>
              <textarea rows={3} value={settings.guidance} onChange={(event) => updateSetting("guidance", event.target.value)} />
            </label>
            <label className="field">
              <span>Output format</span>
              <textarea rows={3} value={settings.outputInstructions} onChange={(event) => updateSetting("outputInstructions", event.target.value)} />
            </label>
            <button className="ghost-button" type="button" onClick={resetDefaults}>
              <RefreshCw size={15} />
              Reset
            </button>
          </details>
        </div>

        <aside className="meeting-side">
          <section className="meeting-section">
            <h2><Database size={18} /> Local Database</h2>
            <div className="meeting-stat-grid">
              <div><span>Documents</span><strong>{store?.documents ?? 0}</strong></div>
              <div><span>Chunks</span><strong>{store?.chunks ?? 0}</strong></div>
              <div><span>Entities</span><strong>{store?.entities ?? 0}</strong></div>
              <div><span>Relations</span><strong>{store?.relations ?? 0}</strong></div>
            </div>
            <p className="meeting-muted">{store?.localDatabase?.path ?? "agent-outputs/local-knowledge-agent/store/knowledge.db"}</p>
            <button className="ghost-button meeting-search-button" type="button" onClick={exportBundle}>
              <Download size={15} />
              Export Bundle
            </button>
          </section>

          <section className="meeting-section">
            <h2><Network size={18} /> Knowledge Graph</h2>
            <div className="meeting-graph-list">
              {(result?.knowledgeGraph?.entities ?? []).slice(0, 8).map((item) => (
                <span key={item.id}>{item.label}<strong>{item.occurrences}</strong></span>
              ))}
              {!result?.knowledgeGraph?.entities?.length && <p className="meeting-muted">Ingest files to create graph entities.</p>}
            </div>
          </section>

          {result?.model && (
            <section className="meeting-section">
              <h2><Brain size={18} /> Model Run</h2>
              <div className="meeting-model-table">
                <span>Provider</span><strong>{result.model.provider}</strong>
                <span>Model</span><strong>{result.model.model}</strong>
                <span>Prompt tokens</span><strong>{modelMetrics?.promptEvalCount ?? "n/a"}</strong>
                <span>Output tokens</span><strong>{modelMetrics?.evalCount ?? "n/a"}</strong>
                <span>Total time</span><strong>{formatMsFromNs(modelMetrics?.totalDurationNs)}</strong>
              </div>
            </section>
          )}
        </aside>
      </section>
    </main>
  );
}
