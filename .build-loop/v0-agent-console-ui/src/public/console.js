/**
 * Chief of Staff — Console UI
 * Wires the dashboard to the same API surface as app.js.
 * Mock data is clearly labelled with // [MOCK] comments.
 */

/* ── Helpers ── */
const $ = (id) => document.getElementById(id);
const now = () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const state = {
  lastPlan: null,
  artifacts: [],  // [MOCK] will be replaced by /api/vault/artifacts endpoint
  audit: [],
};

/* ── Agent Operating Contract ────────────────────────────────────────────── */
// [MOCK] Contract definition lives here until a /api/contract endpoint exists
const AGENT_CONTRACT = {
  id: "chief-of-staff",
  version: "0.1.0",
  runtime: "local-first",
  modelProvider: "Ollama",
  workspace: "cos-workspace/",
  trustBoundaries: [
    "localhost-only model calls",
    "workspace-scoped writes",
    "approval-gated sensitive actions",
    "delete blocked",
    "no cloud dependency",
  ],
  permissions: {
    readLocal: "read-local",
    draft: "draft",
    sensitiveWrites: "ask-first",
    systemActions: "system-approved",
    internetActions: "internet-approved",
    delete: "blocked",
  },
  inputs: ["workspace", "goal", "notes", "scheduleText", "model", "approvalQueue"],
  tools: ["daily-plan", "document-create", "calendar-import", "calendar-export", "approvals"],
  plannedIntegrations: ["memory", "tasks", "people", "slack", "gmail", "outlook", "apple-calendar"],
};

/* ── Capability definitions ───────────────────────────────────────────────── */
// [MOCK] Static capability map — will be partially replaced by readiness API
const CAPABILITIES = [
  {
    name: "Workspace",
    detail: "cos-workspace initialized",
    permission: "read-local",
    action: null,
    _source: "api", // resolved via /api/vault/status
  },
  {
    name: "Ollama",
    detail: "Checking for local models…",
    permission: "read-local",
    action: null,
    _source: "api", // resolved via /api/models
  },
  {
    name: "Daily plan",
    detail: "Deterministic fallback available",
    permission: "draft",
    action: "generate",
    _source: "static",
  },
  {
    name: "Calendar import",
    detail: ".ics only, no external adapter",
    permission: "read-local",
    action: "import",
    _source: "static",
  },
  {
    name: "Calendar export",
    detail: ".ics only, no external adapter",
    permission: "draft",
    action: "export",
    _source: "static",
  },
  {
    name: "Document creation",
    detail: "Creates new files in workspace only",
    permission: "draft",
    action: null,
    _source: "static",
  },
  {
    name: "Approval queue",
    detail: "Pause point before sensitive writes",
    permission: "ask-first",
    action: null,
    _source: "static",
  },
  {
    name: "Memory",
    detail: "Two-tier MemGPT-style — planned",
    permission: "blocked",
    action: null,
    _source: "planned",
  },
  {
    name: "Tasks / People",
    detail: "Structured records — planned",
    permission: "blocked",
    action: null,
    _source: "planned",
  },
  {
    name: "Slack",
    detail: "Internet-approved adapter — deferred",
    permission: "internet",
    action: null,
    _source: "planned",
  },
];

/* ── API ──────────────────────────────────────────────────────────────────── */
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed: ${res.status}`);
  return data;
}

function escHtml(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── Status bar ───────────────────────────────────────────────────────────── */
function setIndicator(sbId, state, label) {
  const el = $(sbId);
  if (!el) return;
  const dot = el.querySelector(".indicator__dot");
  if (dot) dot.dataset.state = state;
  const text = el.querySelector(".indicator__text");
  if (text && label) text.textContent = label;
}

function updateApprovalBadge(count) {
  const badge = $("sb-approval-count");
  if (!badge) return;
  badge.textContent = count;
  badge.dataset.count = count > 0 ? "n" : "0";
}

/* ── Contract timestamp ───────────────────────────────────────────────────── */
function stampContract() {
  const el = $("contract-checked");
  if (el) el.textContent = new Date().toLocaleTimeString();
}

/* ── Readiness table ──────────────────────────────────────────────────────── */
const STATUS_CHIP = {
  "Ready":            "chip chip--ok",
  "Needs setup":      "chip chip--warn",
  "Planned":          "chip chip--planned",
  "Approval required":"chip chip--warn",
  "Blocked":          "chip chip--block",
};

const PERM_CHIP = {
  "read-local": "perm-chip perm--read",
  "draft":      "perm-chip perm--draft",
  "ask-first":  "perm-chip perm--ask",
  "system-approved": "perm-chip perm--system",
  "internet-approved": "perm-chip perm--internet",
  "internet":   "perm-chip perm--internet",
  "blocked":    "perm-chip perm--block",
};

const PERM_LABEL = {
  "read-local":  "Read local",
  "draft":       "Draft",
  "ask-first":   "Ask first",
  "system-approved": "System",
  "internet-approved": "Internet",
  "internet":    "Internet",
  "blocked":     "Blocked",
};

function deriveCapabilityRows(apiReadiness) {
  // Merge live API readiness data into the static capability map
  const liveMap = {};
  if (apiReadiness) {
    for (const r of apiReadiness) liveMap[r.name] = r;
  }

  return CAPABILITIES.map((cap) => {
    const live = liveMap[cap.name];
    let status, detail;

    if (cap._source === "planned") {
      status = "Planned";
      detail = cap.detail;
    } else if (live) {
      status = live.status;
      detail = live.detail;
    } else {
      // Default inference from permission
      if (cap.permission === "blocked") status = "Blocked";
      else status = "Ready";
      detail = cap.detail;
    }

    const actionBtn = cap.action
      ? `<button class="btn btn--sm btn--ghost" data-capability-action="${escHtml(cap.action)}" type="button">
           ${cap.action === "generate" ? "Generate" : cap.action === "import" ? "Import .ics" : "Export .ics"}
         </button>`
      : "—";

    const chipClass = STATUS_CHIP[status] || "chip chip--neutral";
    const permClass = PERM_CHIP[cap.permission] || "perm-chip perm--system";
    const permLabel = PERM_LABEL[cap.permission] || cap.permission;

    return `
      <tr>
        <td class="capability-name">${escHtml(cap.name)}</td>
        <td><span class="${chipClass}">${escHtml(status)}</span></td>
        <td class="capability-detail">${escHtml(detail)}</td>
        <td><span class="${permClass}">${escHtml(permLabel)}</span></td>
        <td>${actionBtn}</td>
      </tr>`;
  });
}

async function refreshReadiness() {
  // [MOCK] /api/vault/status is real, but the readiness[] shape is adapted
  let apiReadiness = null;
  try {
    const vaultData = await api("/api/vault/status");
    apiReadiness = [
      {
        name: "Workspace",
        status: vaultData?.initialized ? "Ready" : "Needs setup",
        detail: vaultData?.initialized ? "cos-workspace initialized" : "Not initialized — run Initialize Workspace",
      },
    ];
    setIndicator("sb-workspace", vaultData?.initialized ? "ok" : "warn", "Workspace");
    pushAudit("Vault status refreshed");
  } catch {
    setIndicator("sb-workspace", "error", "Workspace");
    apiReadiness = [{ name: "Workspace", status: "Needs setup", detail: "Could not reach /api/vault/status" }];
  }

  // Ollama readiness via /api/models
  try {
    const modelData = await api("/api/models");
    const hasModels = modelData?.models?.length > 0;
    if (hasModels) {
      apiReadiness.push({ name: "Ollama", status: "Ready", detail: `${modelData.models.length} model(s) available` });
      setIndicator("sb-model", "ok", modelData.recommended || modelData.models[0]?.name || "Model");
      $("model-recommended").textContent = modelData.recommended || modelData.models[0]?.name || "—";
    } else {
      apiReadiness.push({ name: "Ollama", status: "Needs setup", detail: "No local models found — run: ollama pull <model>" });
      setIndicator("sb-model", "warn", "No model");
      $("model-recommended").textContent = "none found";
    }
  } catch {
    apiReadiness.push({ name: "Ollama", status: "Needs setup", detail: "Ollama not reachable on localhost" });
    setIndicator("sb-model", "error", "Ollama offline");
  }

  const tbody = $("readiness-tbody");
  tbody.innerHTML = deriveCapabilityRows(apiReadiness).join("");
  stampContract();
}

/* ── Model selector ───────────────────────────────────────────────────────── */
async function loadModels() {
  const select = $("modelSelect");
  select.innerHTML = "<option value=''>Loading models…</option>";
  try {
    const data = await api("/api/models");
    if (!data.models.length) {
      select.innerHTML = "<option value=''>No Ollama models found</option>";
      return;
    }
    select.innerHTML = data.models
      .map((m) => `<option value="${escHtml(m.name)}">${escHtml(m.name)}${m.sizeGB ? ` — ${m.sizeGB} GB` : ""}</option>`)
      .join("");
    if (data.recommended) select.value = data.recommended;
  } catch (err) {
    select.innerHTML = `<option value="">${escHtml(err.message)}</option>`;
  }
}

/* ── Plan run info ────────────────────────────────────────────────────────── */
function renderRunInfo(mode, ritual, artifact) {
  const modeEl = $("run-mode");
  const ritualEl = $("run-ritual");
  const artifactEl = $("run-artifact");

  if (modeEl) modeEl.textContent = mode || "—";
  if (ritualEl) ritualEl.textContent = ritual || "—";
  if (artifactEl) {
    artifactEl.textContent = artifact || "—";
    artifactEl.href = artifact ? `#artifact-${escHtml(artifact)}` : "#";
  }
}

function renderSteps(steps) {
  const container = $("plan-steps");
  if (!container || !steps?.length) return;
  container.innerHTML = steps.map((s) => `
    <div class="step step--${escHtml(s.status)}" role="listitem" aria-label="${escHtml(s.label)}: ${escHtml(s.status)}">
      <span class="step__dot" aria-hidden="true"></span>
      ${escHtml(s.label)}
    </div>`).join("");
}

/* ── Daily plan ───────────────────────────────────────────────────────────── */
function renderPlanCards(result) {
  const plan = result.plan;
  state.lastPlan = plan;

  const fallbackNote = result.fallback
    ? `<span class="chip chip--neutral" style="margin-left:6px">deterministic/fallback</span>`
    : "";

  const docPath = result.document?.filename || "";

  const sections = [
    {
      title: "Summary",
      body: `<p>${escHtml(plan.summary)}</p>
             <p class="meta" style="margin-top:6px">
               ${docPath ? `Document: <span class="artifact-link">${escHtml(docPath)}</span>` : ""}
               ${fallbackNote}
             </p>`,
    },
    {
      title: "Top Priorities",
      body: listHtml(plan.topPriorities?.map((i) => `${i.outcome}${i.why ? ` — ${i.why}` : ""}`) || []),
    },
    {
      title: "Schedule",
      body: listHtml(plan.scheduleBlocks?.map((b) => `${b.start}–${b.end}  ${b.title} (${b.mode})`) || []),
    },
    {
      title: "Follow-ups",
      body: listHtml(plan.followUps?.map((i) => `${i.owner || "MISSING OWNER"}: ${i.action}${i.dueBy ? ` due ${i.dueBy}` : ""}`) || []),
    },
    {
      title: "Risks",
      body: listHtml(plan.risks?.map((i) => `[${i.severity}] ${i.risk}${i.mitigation ? ` — ${i.mitigation}` : ""}`) || []),
    },
  ];

  $("planResult").innerHTML = sections.map(({ title, body }) =>
    `<div class="result-card"><h3>${escHtml(title)}</h3>${body}</div>`
  ).join("");

  // Render run info
  renderRunInfo(result.fallback ? "deterministic" : "model-assisted", "daily-plan", docPath);
  renderSteps([
    { label: "Read inputs",   status: "completed" },
    { label: "Generate plan", status: "completed" },
    { label: "Queue approvals", status: result.approvals?.length ? "pending" : "completed" },
  ]);

  if (docPath) addArtifact(docPath, "daily-plan");
  pushAudit("Daily plan generated");
}

function listHtml(items) {
  if (!items.length) return `<p class="empty-hint">None</p>`;
  return `<ul>${items.map((i) => `<li>${escHtml(i)}</li>`).join("")}</ul>`;
}

async function generatePlan() {
  $("planResult").innerHTML = `<div class="result-card"><h3>Running</h3><p class="meta">Generating daily plan…</p></div>`;
  renderRunInfo("…", "daily-plan", "…");
  renderSteps([
    { label: "Read inputs",     status: "pending" },
    { label: "Generate plan",   status: "pending" },
    { label: "Queue approvals", status: "pending" },
  ]);
  try {
    const result = await api("/api/plan/daily", {
      method: "POST",
      body: JSON.stringify({
        date:         $("planDate")?.value,
        goal:         $("goal")?.value,
        notes:        $("notes")?.value,
        scheduleText: $("scheduleText")?.value,
        model:        $("modelSelect")?.value,
        useModel:     $("useModel")?.checked,
      }),
    });
    renderPlanCards(result);
    await refreshApprovals();
    await refreshReadiness();
  } catch (err) {
    $("planResult").innerHTML = `<div class="result-card"><h3 class="error">Error</h3><p>${escHtml(err.message)}</p></div>`;
    renderRunInfo("error", "daily-plan", "—");
  }
}

/* ── Approvals ────────────────────────────────────────────────────────────── */
async function refreshApprovals() {
  const listEl = $("approvalList");
  listEl.innerHTML = "<p class='empty-hint'>Loading…</p>";
  try {
    const data = await api("/api/approvals");
    const pending = data.approvals.filter((item) => item.status === "pending");
    updateApprovalBadge(pending.length);
    if (!pending.length) {
      listEl.innerHTML = "<p class='empty-hint'>No pending approvals.</p>";
      return;
    }
    listEl.innerHTML = pending.map((item) => `
      <div class="approval-card">
        <div class="approval-card__header">
          <span class="chip chip--warn">${escHtml(item.kind)}</span>
          <h3 class="approval-card__title">${escHtml(item.title)}</h3>
        </div>
        ${item.summary ? `<p class="approval-card__meta">${escHtml(item.summary)}</p>` : ""}
        <p class="approval-card__meta">
          Permission required: <strong>${escHtml(item.requiredPermission)}</strong>
          ${item.createdAt ? ` · ${escHtml(item.createdAt)}` : ""}
        </p>
        <div class="approval-card__actions">
          <button
            class="btn btn--sm btn--approve"
            data-approval="${escHtml(item.id)}"
            data-decision="approved"
            type="button"
            aria-label="Approve: ${escHtml(item.title)}">
            Approve
          </button>
          <button
            class="btn btn--sm btn--reject"
            data-approval="${escHtml(item.id)}"
            data-decision="rejected"
            type="button"
            aria-label="Reject: ${escHtml(item.title)}">
            Reject
          </button>
        </div>
      </div>
    `).join("");
  } catch (err) {
    listEl.innerHTML = `<p class="error">${escHtml(err.message)}</p>`;
    updateApprovalBadge(0);
  }
}

async function resolveApproval(event) {
  const button = event.target.closest("[data-approval]");
  if (!button) return;
  button.disabled = true;
  try {
    await api("/api/approvals/resolve", {
      method: "POST",
      body: JSON.stringify({ id: button.dataset.approval, decision: button.dataset.decision }),
    });
    pushAudit(`Approval ${button.dataset.decision}: ${button.dataset.approval}`);
    await refreshApprovals();
  } catch (err) {
    button.disabled = false;
    alert(`Could not resolve approval: ${err.message}`);
  }
}

/* ── Calendar ─────────────────────────────────────────────────────────────── */
async function importCalendar(icsText) {
  try {
    const data = await api("/api/calendar/import", {
      method: "POST",
      body: JSON.stringify({ ics: icsText }),
    });
    openCalendarModal("Import result", JSON.stringify(data, null, 2));
    pushAudit("Calendar imported (.ics)");
  } catch (err) {
    openCalendarModal("Import error", err.message);
  }
}

async function exportCalendar() {
  try {
    const data = await api("/api/calendar/export", {
      method: "POST",
      body: JSON.stringify({
        title: state.lastPlan?.title || "Chief of Staff Plan",
        date:  $("planDate")?.value,
        blocks: state.lastPlan?.scheduleBlocks || [],
      }),
    });
    openCalendarModal("Exported .ics", data.ics);
    addArtifact(`exported-calendar-${$("planDate")?.value || "today"}.ics`, "calendar-export");
    pushAudit("Calendar exported (.ics)");
  } catch (err) {
    openCalendarModal("Export error", err.message);
  }
}

function openCalendarModal(title, content) {
  $("calendar-modal-title").textContent = title;
  $("calendarResult").textContent = content;
  $("calendar-modal").showModal();
}

/* ── .ics file picker ─────────────────────────────────────────────────────── */
$("icsFileInput").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  $("scheduleText").value = text;
  await importCalendar(text);
  e.target.value = "";
});

/* ── Contract modal ───────────────────────────────────────────────────────── */
function openContractModal() {
  $("contract-json-pre").textContent = JSON.stringify(AGENT_CONTRACT, null, 2);
  $("contract-modal").showModal();
}

/* ── Artifacts + Audit ────────────────────────────────────────────────────── */
function addArtifact(path, kind) {
  if (state.artifacts.find((a) => a.path === path)) return;
  state.artifacts.unshift({ path, kind, ts: now() });
  renderArtifacts();
}

function renderArtifacts() {
  const ul = $("artifact-list");
  if (!state.artifacts.length) {
    ul.innerHTML = `<li class="empty-hint" style="list-style:none">No artifacts yet.</li>`;
    return;
  }
  ul.innerHTML = state.artifacts
    .slice(0, 12)
    .map((a) => `
      <li class="artifact-item">
        <span class="artifact-item__icon" aria-hidden="true">
          ${a.kind === "calendar-export" ? "📅" : "📄"}
        </span>
        <div>
          <div class="artifact-item__path">${escHtml(a.path)}</div>
          <div class="artifact-item__meta">${escHtml(a.ts)}</div>
        </div>
      </li>`)
    .join("");
}

function pushAudit(label) {
  state.audit.unshift({ label, ts: now() });
  renderAudit();
}

function renderAudit() {
  const ol = $("audit-list");
  if (!state.audit.length) {
    ol.innerHTML = `<li class="empty-hint" style="list-style:none">No actions yet.</li>`;
    return;
  }
  ol.innerHTML = state.audit
    .slice(0, 20)
    .map((e) => `
      <li class="audit-item">
        <span class="audit-item__label">${escHtml(e.label)}</span>
        <span class="audit-item__time">${escHtml(e.ts)}</span>
      </li>`)
    .join("");
}

/* ── Sample calendar ──────────────────────────────────────────────────────── */
async function loadSample() {
  const res = await fetch("/sample-calendar.ics");
  const text = await res.text();
  const ta = $("scheduleText");
  if (ta) ta.value = text;
  pushAudit("Sample .ics loaded");
}

/* ── Init ─────────────────────────────────────────────────────────────────── */
function setToday() {
  const el = $("planDate");
  if (el) el.value = new Date().toISOString().slice(0, 10);
}

/* ── Wire events ──────────────────────────────────────────────────────────── */
$("btn-init-workspace").addEventListener("click", async () => {
  try {
    await api("/api/vault/init", { method: "POST", body: "{}" });
    pushAudit("Workspace initialized");
    await refreshReadiness();
    await refreshApprovals();
  } catch (err) {
    alert(`Init failed: ${err.message}`);
  }
});

$("btn-refresh-all").addEventListener("click", async () => {
  await refreshReadiness();
  await loadModels();
  await refreshApprovals();
  pushAudit("Full refresh");
});

$("btn-refresh-readiness").addEventListener("click", async () => {
  await refreshReadiness();
  await loadModels();
});

$("generatePlan").addEventListener("click", generatePlan);
$("refreshApprovals").addEventListener("click", refreshApprovals);
$("approvalList").addEventListener("click", resolveApproval);
$("loadSample").addEventListener("click", loadSample);

$("btn-import-ics").addEventListener("click", () => {
  $("icsFileInput").click();
});

$("btn-export-ics").addEventListener("click", exportCalendar);

$("btn-inspect-contract").addEventListener("click", openContractModal);
$("modal-close").addEventListener("click", () => $("contract-modal").close());
$("cal-modal-close").addEventListener("click", () => $("calendar-modal").close());

// Close modals on backdrop click
["contract-modal", "calendar-modal"].forEach((id) => {
  $(id).addEventListener("click", (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const outside = e.clientX < rect.left || e.clientX > rect.right ||
                    e.clientY < rect.top  || e.clientY > rect.bottom;
    if (outside) e.currentTarget.close();
  });
});

// Capability table action buttons (delegated)
$("readiness-tbody").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-capability-action]");
  if (!btn) return;
  const action = btn.dataset.capabilityAction;
  if (action === "generate") generatePlan();
  else if (action === "import") $("icsFileInput").click();
  else if (action === "export") exportCalendar();
});

// Deterministic mode toggle syncs to useModel
$("deterministicMode").addEventListener("change", (e) => {
  $("useModel").checked = !e.target.checked;
});
$("useModel").addEventListener("change", (e) => {
  $("deterministicMode").checked = !e.target.checked;
});

/* ── Boot ── */
setToday();
renderArtifacts();
renderAudit();

// [MOCK] Seed the run info bar with the mock action plan shape until a plan is generated
renderRunInfo("deterministic", "daily-plan", "documents/daily-plan-2026-05-01.md");
renderSteps([
  { label: "Read inputs",     status: "completed" },
  { label: "Generate plan",   status: "completed" },
  { label: "Queue approvals", status: "pending"   },
]);

// [MOCK] Seed artifacts panel
addArtifact("documents/daily-plan-2026-05-01.md", "daily-plan");

await refreshReadiness();
await loadModels();
await refreshApprovals();
