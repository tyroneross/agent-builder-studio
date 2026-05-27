import { createServer } from "node:http";
import {
  buildInstallManifest,
  getStoreStats,
  ingestKnowledgeFiles,
  initializeLocalStore,
  searchKnowledge,
} from "./agent.mjs";
import { CHAT_MODELS, EMBEDDING_MODELS, MAC_RAM_PROFILES, profileByRam } from "./model-profiles.mjs";

const MAX_BODY_BYTES = 80 * 1024 * 1024;

export async function startServer(options = {}) {
  const root = options.root ?? process.cwd();
  const host = options.host ?? "127.0.0.1";
  const port = Number(options.port ?? 3737);

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/") {
        return html(response, renderPage());
      }
      if (request.method === "GET" && request.url?.startsWith("/api/stats")) {
        return json(response, { ok: true, store: await getStoreStats({ root }) });
      }
      if (request.method === "GET" && request.url?.startsWith("/api/bundle")) {
        const url = new URL(request.url, `http://${request.headers.host}`);
        return json(response, buildInstallManifest({ ramProfile: url.searchParams.get("ram") ?? "24gb" }), {
          "content-disposition": "attachment; filename=\"local-knowledge-agent.agent.json\"",
        });
      }
      if (request.method === "POST" && request.url === "/api/init") {
        return json(response, { ok: true, store: await initializeLocalStore({ root }) });
      }
      if (request.method === "POST" && request.url === "/api/ingest") {
        const body = await readJson(request);
        const uploads = (body.files ?? []).map((file) => ({
          name: file.name,
          type: file.type,
          buffer: Buffer.from(file.dataBase64 ?? "", "base64"),
        }));
        const result = await ingestKnowledgeFiles(uploads, {
          root,
          retrievalQuery: body.retrievalQuery,
          guidance: body.guidance,
          outputInstructions: body.outputInstructions,
          ramProfile: body.ramProfile,
          chatModel: body.chatModel,
          embeddingModel: body.embeddingModel,
          parserMode: body.parserMode,
          omniparseEntry: body.omniparseEntry,
          temperature: body.temperature,
          topP: body.topP,
          numCtx: body.numCtx,
          numPredict: body.numPredict,
          preferOllama: body.preferOllama !== false,
        });
        return json(response, result);
      }
      if (request.method === "POST" && request.url === "/api/search") {
        const body = await readJson(request);
        const result = await searchKnowledge(body.query ?? "", {
          root,
          mode: body.mode ?? "hybrid",
          embeddingModel: body.embeddingModel,
          limit: body.limit ?? 8,
          preferOllama: body.preferOllama !== false,
        });
        return json(response, result);
      }
      return json(response, { ok: false, error: "Not found" }, {}, 404);
    } catch (error) {
      return json(response, { ok: false, error: error instanceof Error ? error.message : String(error) }, {}, 400);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  console.log(`Local Knowledge Agent running at http://${host}:${port}`);
  return server;
}

async function readJson(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.byteLength;
    if (total > MAX_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function json(response, value, headers = {}, status = 200) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function html(response, value) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(value);
}

function renderPage() {
  const profiles = JSON.stringify(MAC_RAM_PROFILES);
  const chatModels = JSON.stringify(CHAT_MODELS);
  const embeddingModels = JSON.stringify(EMBEDDING_MODELS);
  const defaultProfile = JSON.stringify(profileByRam("24gb"));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Local Knowledge Agent</title>
  <style>
    :root { color-scheme: light; --ink:#1f2723; --muted:#5d6963; --line:#dce3de; --fill:#f7f8f6; --accent:#3f7b6d; --accent-dark:#2f6357; }
    * { box-sizing:border-box; }
    body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--ink); background:#f4f5f2; }
    main { max-width:1120px; margin:0 auto; padding:28px 18px 44px; }
    header { margin-bottom:22px; }
    .eyebrow { font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:var(--accent-dark); }
    h1 { margin:6px 0 6px; font-size:clamp(30px, 6vw, 54px); line-height:1; letter-spacing:0; }
    p { color:var(--muted); line-height:1.45; }
    .grid { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(280px,.7fr); gap:16px; align-items:start; }
    section { background:white; border:1px solid var(--line); border-radius:8px; padding:18px; box-shadow:0 1px 2px rgba(20,30,25,.04); }
    h2 { margin:0 0 14px; font-size:18px; }
    label { display:block; font-size:13px; font-weight:700; margin:14px 0 6px; }
    input, select, textarea, button { width:100%; font:inherit; }
    input, select, textarea { border:1px solid var(--line); border-radius:7px; padding:10px 11px; background:#fff; color:var(--ink); }
    textarea { min-height:96px; resize:vertical; }
    button { border:0; border-radius:7px; padding:12px 14px; background:var(--accent); color:white; font-weight:800; cursor:pointer; }
    button:hover { background:var(--accent-dark); }
    button.secondary { background:#edf2ef; color:var(--ink); border:1px solid var(--line); }
    .drop { border:1px dashed #b8c4bd; border-radius:8px; background:#f8fbf9; padding:18px; }
    .row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .small { font-size:13px; color:var(--muted); }
    .stat { display:flex; justify-content:space-between; border-bottom:1px solid var(--line); padding:9px 0; gap:16px; }
    .stat:last-child { border-bottom:0; }
    .result { min-height:240px; border:1px solid var(--line); border-radius:8px; padding:14px; background:#fff; overflow:auto; }
    .results { display:grid; gap:10px; }
    .hit { border:1px solid var(--line); border-radius:8px; padding:12px; background:var(--fill); }
    details { margin-top:14px; }
    summary { cursor:pointer; font-weight:800; }
    pre { white-space:pre-wrap; word-break:break-word; }
    @media (max-width: 820px) { .grid, .row { grid-template-columns:1fr; } main { padding:20px 12px 32px; } }
  </style>
</head>
<body>
<main>
  <header>
    <div class="eyebrow">Local Knowledge Agent</div>
    <h1>Ingest files. Search local knowledge.</h1>
    <p>Files stay on this machine. The agent stores parsed chunks, vectors, SQLite rows, and a small graph under <code>data/store/</code>.</p>
  </header>
  <div class="grid">
    <div>
      <section>
        <h2>Source Files</h2>
        <div class="drop">
          <input id="files" type="file" multiple>
          <p class="small" id="fileCount">No files selected.</p>
        </div>
        <div class="row">
          <div>
            <label for="ram">Mac RAM</label>
            <select id="ram"></select>
          </div>
          <div>
            <label>Recommended</label>
            <div id="recommendation" class="small"></div>
          </div>
        </div>
        <label for="query">Retrieval Query</label>
        <input id="query" placeholder="Optional query to retrieve prior context">
        <button id="ingest" style="margin-top:14px">Ingest Files</button>
        <details>
          <summary>Advanced Settings</summary>
          <div class="row">
            <div><label for="chatModel">Chat Model</label><select id="chatModel"></select></div>
            <div><label for="embeddingModel">Embedding Model</label><select id="embeddingModel"></select></div>
          </div>
          <div class="row">
            <div><label for="temperature">Temperature</label><input id="temperature" type="number" step="0.05" min="0" max="2" value="0.1"></div>
            <div><label for="numCtx">Context Tokens</label><input id="numCtx" type="number"></div>
          </div>
          <label for="guidance">Prompt Guidance</label>
          <textarea id="guidance" placeholder="Optional instructions for output tone, emphasis, or sections."></textarea>
          <label><input id="preferOllama" type="checkbox" checked style="width:auto"> Use Ollama when available</label>
        </details>
      </section>
      <section style="margin-top:16px">
        <h2>Retrieval</h2>
        <div class="row">
          <input id="searchQuery" placeholder="Search sources...">
          <select id="mode">
            <option value="hybrid">Hybrid</option>
            <option value="semantic">Semantic</option>
            <option value="sql">SQL</option>
          </select>
        </div>
        <button id="search" class="secondary" style="margin-top:12px">Search</button>
        <div id="hits" class="results" style="margin-top:14px"></div>
      </section>
    </div>
    <aside>
      <section>
        <h2>Local Store</h2>
        <div id="stats"></div>
        <button id="init" class="secondary" style="margin-top:12px">Initialize Store</button>
        <button id="bundle" class="secondary" style="margin-top:10px">Download Manifest</button>
      </section>
      <section style="margin-top:16px">
        <h2>Rich Output</h2>
        <div id="output" class="result" contenteditable="true">Ingest files to generate editable output.</div>
      </section>
    </aside>
  </div>
</main>
<script>
const profiles = ${profiles};
const chatModels = ${chatModels};
const embeddingModels = ${embeddingModels};
const defaultProfile = ${defaultProfile};
const els = Object.fromEntries(["files","fileCount","ram","recommendation","query","ingest","chatModel","embeddingModel","temperature","numCtx","guidance","preferOllama","searchQuery","mode","search","hits","stats","init","bundle","output"].map((id) => [id, document.getElementById(id)]));

for (const profile of profiles) els.ram.add(new Option(profile.label, profile.id, profile.id === "24gb", profile.id === "24gb"));
for (const model of chatModels) els.chatModel.add(new Option(model.label + " - " + model.fit, model.id));
for (const model of embeddingModels) els.embeddingModel.add(new Option(model.label + " - " + model.fit, model.id));

function selectedProfile() { return profiles.find((item) => item.id === els.ram.value) || defaultProfile; }
function syncProfile() {
  const profile = selectedProfile();
  els.recommendation.textContent = profile.recommended + " - " + profile.note;
  els.chatModel.value = profile.chatModel;
  els.embeddingModel.value = profile.embeddingModel;
  els.numCtx.value = profile.numCtx;
}
els.ram.addEventListener("change", syncProfile);
syncProfile();

els.files.addEventListener("change", () => {
  els.fileCount.textContent = els.files.files.length ? Array.from(els.files.files).map((file) => file.name).join(", ") : "No files selected.";
});

els.init.addEventListener("click", async () => {
  await post("/api/init", {});
  await refreshStats();
});
els.bundle.addEventListener("click", () => { window.location.href = "/api/bundle?ram=" + encodeURIComponent(els.ram.value); });
els.ingest.addEventListener("click", ingest);
els.search.addEventListener("click", search);

async function ingest() {
  if (!els.files.files.length) return alert("Choose at least one file.");
  els.ingest.disabled = true;
  els.output.textContent = "Ingesting...";
  try {
    const files = [];
    for (const file of els.files.files) {
      files.push({ name: file.name, type: file.type, dataBase64: await fileToBase64(file) });
    }
    const result = await post("/api/ingest", {
      files,
      ramProfile: els.ram.value,
      retrievalQuery: els.query.value,
      guidance: els.guidance.value,
      chatModel: els.chatModel.value,
      embeddingModel: els.embeddingModel.value,
      temperature: Number(els.temperature.value),
      numCtx: Number(els.numCtx.value),
      preferOllama: els.preferOllama.checked,
    });
    if (!result.ok) throw new Error(result.error || "Ingest failed.");
    els.output.innerHTML = markdownToHtml(result.markdown || "");
    els.searchQuery.value = els.searchQuery.value || els.query.value || "";
    await refreshStats();
  } catch (error) {
    els.output.textContent = error.message;
  } finally {
    els.ingest.disabled = false;
  }
}

async function search() {
  const result = await post("/api/search", {
    query: els.searchQuery.value,
    mode: els.mode.value,
    embeddingModel: els.embeddingModel.value,
    preferOllama: els.preferOllama.checked,
  });
  els.hits.innerHTML = (result.results || []).map((hit) => '<div class="hit"><strong>' + escapeHtml(hit.sourceName || hit.meetingTitle || "source") + '</strong><p>' + escapeHtml(hit.excerpt || "") + '</p><span class="small">' + escapeHtml(hit.source || result.mode) + ' score ' + hit.score + '</span></div>').join("") || '<p class="small">No results.</p>';
  await refreshStats();
}

async function refreshStats() {
  const result = await fetch("/api/stats").then((res) => res.json());
  const store = result.store || {};
  els.stats.innerHTML = ["documents","chunks","entities","relations","runs"].map((key) => '<div class="stat"><span>' + key + '</span><strong>' + (store[key] || 0) + '</strong></div>').join("") + '<p class="small">' + escapeHtml(store.localDatabase?.path || "data/store/knowledge.db") + '</p>';
}

async function post(url, body) {
  const response = await fetch(url, { method:"POST", headers:{ "content-type":"application/json" }, body: JSON.stringify(body) });
  return response.json();
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function markdownToHtml(markdown) {
  return escapeHtml(markdown)
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^- (.*)$/gm, "<li>$1</li>")
    .replace(/\\n/g, "<br>");
}
function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[char]));
}
refreshStats();
</script>
</body>
</html>`;
}
