const $ = (id) => document.getElementById(id);

const state = {
  lastPlan: null,
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed: ${res.status}`);
  return data;
}

function pretty(value) {
  return JSON.stringify(value, null, 2);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function refreshVault() {
  $("vaultStatus").textContent = "Loading...";
  try {
    $("vaultStatus").textContent = pretty(await api("/api/vault/status"));
  } catch (err) {
    $("vaultStatus").textContent = err.message;
  }
}

async function loadModels() {
  const select = $("modelSelect");
  select.innerHTML = "<option value=''>Loading models...</option>";
  try {
    const data = await api("/api/models");
    if (!data.models.length) {
      select.innerHTML = "<option value=''>No Ollama models found</option>";
      return;
    }
    select.innerHTML = data.models
      .map((model) => `<option value="${escapeHtml(model.name)}">${escapeHtml(model.name)}${model.sizeGB ? ` - ${model.sizeGB} GB` : ""}</option>`)
      .join("");
    if (data.recommended) select.value = data.recommended;
  } catch (err) {
    select.innerHTML = `<option value="">${escapeHtml(err.message)}</option>`;
  }
}

function renderPlan(result) {
  const plan = result.plan;
  state.lastPlan = plan;
  $("planResult").innerHTML = [
    card("Summary", `<p>${escapeHtml(plan.summary)}</p><p class="meta">Document: ${escapeHtml(result.document?.filename || "")}${result.fallback ? " - deterministic/fallback mode" : ""}</p>`),
    card("Top Priorities", list(plan.topPriorities.map((item) => `${item.outcome} — ${item.why || ""}`))),
    card("Schedule", list(plan.scheduleBlocks.map((block) => `${block.start}-${block.end} ${block.title} (${block.mode})`))),
    card("Follow-ups", list(plan.followUps.map((item) => `${item.owner || "MISSING OWNER"}: ${item.action}${item.dueBy ? ` due ${item.dueBy}` : ""}`))),
    card("Risks", list(plan.risks.map((item) => `[${item.severity}] ${item.risk} — ${item.mitigation || ""}`))),
  ].join("");
}

function card(title, body) {
  return `<div class="result-card"><h3>${escapeHtml(title)}</h3>${body}</div>`;
}

function list(items) {
  if (!items.length) return "<p class='meta'>None</p>";
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

async function generatePlan() {
  $("planResult").innerHTML = "<div class='result-card'><h3>Running</h3><p class='meta'>Generating daily plan...</p></div>";
  try {
    const result = await api("/api/plan/daily", {
      method: "POST",
      body: JSON.stringify({
        date: $("planDate").value,
        goal: $("goal").value,
        notes: $("notes").value,
        scheduleText: $("scheduleText").value,
        model: $("modelSelect").value,
        useModel: $("useModel").checked,
      }),
    });
    renderPlan(result);
    await refreshApprovals();
    await refreshVault();
  } catch (err) {
    $("planResult").innerHTML = `<div class='result-card'><h3 class='error'>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function refreshApprovals() {
  const listEl = $("approvalList");
  listEl.innerHTML = "<p class='meta'>Loading...</p>";
  try {
    const data = await api("/api/approvals");
    const pending = data.approvals.filter((item) => item.status === "pending");
    if (!pending.length) {
      listEl.innerHTML = "<p class='meta'>No pending approvals.</p>";
      return;
    }
    listEl.innerHTML = pending.map((item) => `
      <div class="approval-card">
        <span class="pill">${escapeHtml(item.kind)}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.summary)}</p>
        <p class="meta">${escapeHtml(item.requiredPermission)} - ${escapeHtml(item.createdAt)}</p>
        <div class="actions">
          <button data-approval="${escapeHtml(item.id)}" data-decision="approved" type="button">Mark Approved</button>
          <button data-approval="${escapeHtml(item.id)}" data-decision="rejected" type="button">Reject</button>
        </div>
      </div>
    `).join("");
  } catch (err) {
    listEl.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
  }
}

async function resolveApproval(event) {
  const button = event.target.closest("[data-approval]");
  if (!button) return;
  await api("/api/approvals/resolve", {
    method: "POST",
    body: JSON.stringify({
      id: button.dataset.approval,
      decision: button.dataset.decision,
    }),
  });
  await refreshApprovals();
}

async function importCalendar() {
  try {
    const data = await api("/api/calendar/import", {
      method: "POST",
      body: JSON.stringify({ ics: $("scheduleText").value }),
    });
    $("calendarResult").textContent = pretty(data);
  } catch (err) {
    $("calendarResult").textContent = err.message;
  }
}

async function exportCalendar() {
  try {
    const data = await api("/api/calendar/export", {
      method: "POST",
      body: JSON.stringify({
        title: state.lastPlan?.title || "Chief of Staff Plan",
        date: $("planDate").value,
        blocks: state.lastPlan?.scheduleBlocks || [],
      }),
    });
    $("calendarResult").textContent = data.ics;
  } catch (err) {
    $("calendarResult").textContent = err.message;
  }
}

async function loadSample() {
  const res = await fetch("/sample-calendar.ics");
  $("scheduleText").value = await res.text();
}

function setToday() {
  $("planDate").value = new Date().toISOString().slice(0, 10);
}

$("initWorkspace").addEventListener("click", async () => {
  $("vaultStatus").textContent = pretty(await api("/api/vault/init", { method: "POST", body: "{}" }));
  await refreshApprovals();
});
$("generatePlan").addEventListener("click", generatePlan);
$("refreshApprovals").addEventListener("click", refreshApprovals);
$("approvalList").addEventListener("click", resolveApproval);
$("importCalendar").addEventListener("click", importCalendar);
$("exportCalendar").addEventListener("click", exportCalendar);
$("loadSample").addEventListener("click", loadSample);

setToday();
await refreshVault();
await loadModels();
await refreshApprovals();
