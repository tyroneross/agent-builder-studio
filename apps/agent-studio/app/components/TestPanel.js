"use client";

// TestPanel — slide-up panel anchored to the bottom of the canvas.
//
// Responsibilities:
//   - Pick an Ollama model (queried from /api/agent/models).
//   - Take a test query.
//   - POST the active project + query to /api/agent/run, parse the SSE
//     stream, and update per-node status (idle | running | ok | error) live.
//   - Show warnings (parallel mode, model fallback, missing working folder).
//   - Surface the final brief and the run folder path.
//   - Cancel button aborts the in-flight fetch via AbortController.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Pass 8: per-project flag tracking whether the test panel has seen a
// completed run. While unset, we surface an example query above the textarea
// so first-time users have something concrete to try.
function firstRunSeenKey(projectId) {
  return `agent-studio:firstRunSeen:${projectId}`;
}

const STATUS_LABEL = {
  idle: "idle",
  running: "running",
  ok: "ok",
  error: "error",
};

function statusColor(status) {
  if (status === "running") return "var(--accent)";
  if (status === "ok") return "var(--eval, #1f7a1f)";
  if (status === "error") return "var(--danger, #b00020)";
  return "var(--faint)";
}

function planPanelLevels(project) {
  const nodes = project?.canvas?.nodes ?? [];
  const edges = project?.canvas?.edges ?? [];
  if (nodes.length === 0) return { levels: [], hasOrdering: false, error: null };

  const incoming = new Map(nodes.map((n) => [n.id, new Set()]));
  for (const edge of edges) {
    if (!incoming.has(edge?.from) || !incoming.has(edge?.to)) continue;
    if (edge.from !== edge.to) incoming.get(edge.to).add(edge.from);
  }

  const producers = new Map();
  for (const node of nodes) {
    for (const tag of Array.isArray(node.outputs) ? node.outputs : []) {
      if (typeof tag !== "string" || !tag) continue;
      if (!producers.has(tag)) producers.set(tag, []);
      producers.get(tag).push(node.id);
    }
  }

  for (const node of nodes) {
    for (const tag of Array.isArray(node.inputs) ? node.inputs : []) {
      const producerIds = producers.get(tag) ?? [];
      for (const fromId of producerIds) {
        if (fromId !== node.id) incoming.get(node.id).add(fromId);
      }
    }
  }

  const hasOrdering = edges.length > 0 || nodes.some((n) => n.inputs?.length || n.outputs?.length);
  if (!hasOrdering) return { levels: [nodes.map((n) => n.id)], hasOrdering: false, error: null };

  const remaining = new Map(Array.from(incoming.entries()).map(([id, deps]) => [id, new Set(deps)]));
  const idsLeft = new Set(nodes.map((n) => n.id));
  const levels = [];
  while (idsLeft.size > 0) {
    const ready = [];
    for (const id of idsLeft) {
      if ((remaining.get(id)?.size ?? 0) === 0) ready.push(id);
    }
    if (ready.length === 0) {
      return { levels: [nodes.map((n) => n.id)], hasOrdering: true, error: "cycle detected" };
    }
    levels.push(ready);
    for (const id of ready) {
      idsLeft.delete(id);
      for (const deps of remaining.values()) deps.delete(id);
    }
  }
  return { levels, hasOrdering: true, error: null };
}

// Pass 18 — collect every subagent project id reachable from `project`,
// recursively, so the client can ship them all in one request body. We
// dedupe and stop at depth `subagentMaxDepth` to mirror the runtime's cap
// (passing extras is harmless but pointless).
function collectSubagentProjects(project, allProjects, depthCap = 8) {
  const seen = new Set();
  const out = {};
  function walk(p, depth) {
    if (!p || depth > depthCap) return;
    const nodes = Array.isArray(p?.canvas?.nodes) ? p.canvas.nodes : [];
    for (const n of nodes) {
      if (n.role !== "subagent") continue;
      const ref = n.subagentProjectId;
      if (!ref || seen.has(ref)) continue;
      seen.add(ref);
      const child = (allProjects || []).find((q) => q.id === ref);
      if (child) {
        out[ref] = child;
        walk(child, depth + 1);
      }
    }
  }
  walk(project, 0);
  return out;
}

export default function TestPanel({ project, isOpen, onToggle, locked = false, onTranscriptComplete, allProjects = [] }) {
  const [models, setModels] = useState([]);
  const [modelOptions, setModelOptions] = useState([]);
  const [modelsError, setModelsError] = useState(null);
  const [selectedModel, setSelectedModel] = useState("");
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const [statusById, setStatusById] = useState({});
  const [brief, setBrief] = useState("");
  const [runDir, setRunDir] = useState(null);
  const [error, setError] = useState(null);
  const [runStatus, setRunStatus] = useState(null);
  const [runModel, setRunModel] = useState(null);
  // Pass 15 — step mode + per-run controller. `runId` is set after the
  // server emits `run-started`; clears on `complete`. `pausedAtLevel` is
  // the most recent `level-start` event's level so the Next button label
  // can show "Next level (after L<n>)".
  const [runId, setRunId] = useState(null);
  const [pausedAtLevel, setPausedAtLevel] = useState(null);
  // Pass 8: first-run-seen flag, hydrated from localStorage on project change.
  // Determines whether to show the example-query hint above the textarea.
  const [firstRunSeen, setFirstRunSeen] = useState(true);
  const abortRef = useRef(null);
  const runModelRef = useRef(null);
  const selectedModelRef = useRef("");
  // Pass 11: track whether THIS project has been auto-opened already in this
  // mount. Without this, every isOpen flip would re-trigger the auto-open
  // effect and we'd fight the user's explicit close.
  const autoOpenedForProjectRef = useRef(null);
  // Pass 11: track whether the current open run has been pre-filled. We seed
  // the query exactly once per first-run open so user edits aren't clobbered.
  const prefilledForProjectRef = useRef(null);

  useEffect(() => {
    selectedModelRef.current = selectedModel;
  }, [selectedModel]);

  // Hydrate first-run flag whenever the active project changes. Default to
  // "seen" for SSR to avoid hint flicker before localStorage is available.
  useEffect(() => {
    if (!project?.id) {
      setFirstRunSeen(true);
      return;
    }
    try {
      if (typeof window === "undefined") {
        setFirstRunSeen(true);
        return;
      }
      const seen = window.localStorage.getItem(firstRunSeenKey(project.id)) === "1";
      setFirstRunSeen(seen);
      // Reset per-project gates so a project switch can re-trigger auto-open
      // and pre-fill (subject to firstRunSeen still being false).
      autoOpenedForProjectRef.current = null;
      prefilledForProjectRef.current = null;
    } catch {
      setFirstRunSeen(true);
    }
  }, [project?.id]);

  // Pass 11: auto-open the panel on the very first visit to a project the
  // user hasn't run yet. Surfacing the panel collapsed-by-default left
  // first-time users staring at a graph with no obvious action; opening it
  // shows the model picker, the example-query hint, and the Run button at
  // once. We only do this once per project per mount: any explicit close
  // sets firstRunSeen, which short-circuits this effect on next render.
  useEffect(() => {
    if (!project?.id) return;
    if (firstRunSeen) return;
    if (isOpen) return;
    if (autoOpenedForProjectRef.current === project.id) return;
    autoOpenedForProjectRef.current = project.id;
    onToggle?.();
  }, [project?.id, firstRunSeen, isOpen, onToggle]);

  // Pass 11: pre-fill the textarea with a sensible example the first time
  // this project's panel opens. Use the project goal when present, otherwise
  // fall back to a graph-flavoured starter. We only seed if the textarea is
  // empty; we never overwrite a user edit.
  useEffect(() => {
    if (!project?.id) return;
    if (!isOpen) return;
    if (firstRunSeen) return;
    if (prefilledForProjectRef.current === project.id) return;
    prefilledForProjectRef.current = project.id;
    setQuery((current) => {
      if (current && current.trim().length > 0) return current;
      const goal = typeof project.goal === "string" ? project.goal.trim() : "";
      return goal || "What is the riskiest dependency in this graph?";
    });
  }, [project?.id, project?.goal, isOpen, firstRunSeen]);

  // Fetch model list once on mount and again every time the panel opens.
  // Keep this side-effect-free of project state so model availability stays
  // independent of project switching.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/agent/models");
        const body = await res.json();
        if (cancelled) return;
        if (body?.ok && Array.isArray(body.models)) {
          const options = Array.isArray(body.modelOptions)
            ? body.modelOptions.filter((m) => m?.available && typeof m.id === "string")
            : body.models.map((m) => ({ id: m, label: m, provider: "ollama", source: "local", available: true }));
          const ids = options.map((m) => m.id);
          setModelOptions(options);
          setModels(ids);
          setModelsError(null);
          if (ids.length > 0) {
            // Default: keep the user's pick if still installed; otherwise
            // prefer a known-solid instruct family over whatever happens to
            // sort first (tinyllama makes a poor first-run demo).
            const preferred =
              [/^llama3/i, /^qwen3/i, /^gemma/i]
                .map((re) => ids.find((m) => re.test(m)))
                .find(Boolean) ?? ids[0];
            setSelectedModel((prev) => (prev && ids.includes(prev) ? prev : preferred));
          }
        } else {
          setModels([]);
          setModelOptions([]);
          setModelsError(body?.error || "could not list models");
        }
      } catch (err) {
        if (cancelled) return;
        setModels([]);
        setModelOptions([]);
        setModelsError(err?.message || "could not reach /api/agent/models");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const levelPlan = useMemo(() => planPanelLevels(project), [project]);

  const nodeRows = useMemo(() => {
    if (!project?.canvas?.nodes) return [];
    const levelById = new Map();
    for (let i = 0; i < levelPlan.levels.length; i++) {
      for (const id of levelPlan.levels[i]) levelById.set(id, i);
    }
    return project.canvas.nodes.map((n) => ({
      id: n.id,
      title: n.title,
      role: n.role,
      level: levelById.get(n.id) ?? 0,
      status: statusById[n.id]?.status ?? "idle",
      durationMs: statusById[n.id]?.durationMs ?? null,
      bytes: statusById[n.id]?.bytes ?? null,
      error: statusById[n.id]?.error ?? null,
      mocked: statusById[n.id]?.mocked === true,
      model: statusById[n.id]?.model ?? null,
    }));
  }, [levelPlan, project, statusById]);

  const stageGroups = useMemo(() => {
    const rowsById = new Map(nodeRows.map((row) => [row.id, row]));
    return levelPlan.levels
      .map((ids, index) => ({
        index,
        rows: ids.map((id) => rowsById.get(id)).filter(Boolean),
      }))
      .filter((group) => group.rows.length > 0);
  }, [levelPlan, nodeRows]);

  const runBlockedReason = useMemo(() => {
    if (locked) return "project is completed";
    if (!project) return "no active project";
    if (modelsError) return modelsError;
    if (models.length === 0) return "no chat models are available";
    if (!selectedModel) return "select a model";
    return null;
  }, [locked, models.length, modelsError, project, selectedModel]);

  function resetRunState() {
    setWarnings([]);
    setStatusById({});
    setBrief("");
    setRunDir(null);
    setError(null);
    setRunStatus(null);
    setRunModel(null);
    runModelRef.current = null;
  }

  const handleEvent = useCallback((evt) => {
    if (!evt || typeof evt !== "object") return;
    if (evt.type === "run-started") {
      // Pass 15 — server registered a step controller; capture runId so
      // advance / skip / cancel can target it.
      setRunId(evt.runId || null);
      setRunStatus("Run started.");
      return;
    }
    if (evt.type === "warmup-ok") {
      const model = evt.model || selectedModelRef.current || null;
      runModelRef.current = model;
      setRunModel(model);
      setRunStatus(model ? `Using ${model}.` : "Model ready.");
      return;
    }
    if (evt.type === "level-start") {
      setPausedAtLevel(typeof evt.level === "number" ? evt.level : null);
      setRunStatus(typeof evt.level === "number" ? `Paused at level ${evt.level}.` : "Step run paused.");
      return;
    }
    if (evt.type === "warning") {
      setWarnings((arr) => [...arr, evt.text]);
      return;
    }
    if (evt.type === "warmup-fail") {
      setError(evt.error || "warmup failed");
      setRunStatus("Warmup failed.");
      return;
    }
    if (evt.type === "node-start") {
      const model = evt.model || runModelRef.current || selectedModelRef.current || null;
      setStatusById((m) => ({ ...m, [evt.id]: { status: "running", bytes: 0, model } }));
      setRunStatus(`Running ${evt.id || "node"}...`);
      return;
    }
    if (evt.type === "node-chunk") {
      setStatusById((m) => ({
        ...m,
        [evt.id]: { ...(m[evt.id] || { status: "running" }), bytes: evt.bytes },
      }));
      return;
    }
    if (evt.type === "node-end") {
      setStatusById((m) => ({
        ...m,
        [evt.id]: {
          ...(m[evt.id] || {}),
          status: "ok",
          durationMs: evt.durationMs,
          bytes: evt.bytes,
          model: evt.model || m[evt.id]?.model || runModelRef.current || selectedModelRef.current || null,
          mocked: evt.mocked === true,
        },
      }));
      setRunStatus(`Completed ${evt.id || "node"}.`);
      return;
    }
    if (evt.type === "node-error") {
      if (!evt.id) {
        setError(evt.error || "run error");
        setRunStatus("Run error.");
        return;
      }
      setStatusById((m) => ({
        ...m,
        [evt.id]: {
          ...(m[evt.id] || {}),
          status: "error",
          error: evt.error,
          model: evt.model || m[evt.id]?.model || runModelRef.current || selectedModelRef.current || null,
        },
      }));
      return;
    }
    if (evt.type === "complete") {
      setBrief(evt.brief || "");
      setRunDir(evt.runDir || null);
      setRunId(null);
      setPausedAtLevel(null);
      setRunStatus("Run complete.");
      // Pass 15 — surface the full transcript so the canvas page can mount
      // the inspector against it. Includes per-node systemPrompt /
      // userMessage / parsed / output / mocked.
      if (evt.transcript) {
        onTranscriptComplete?.(evt.transcript);
      }
      // Pass 8: persist first-run-seen as soon as the run completes. We hold
      // the project id at call time via `project?.id`. If the user navigates
      // mid-run we still record against the project that owned the run.
      if (project?.id) {
        try {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(firstRunSeenKey(project.id), "1");
          }
        } catch {
          // ignore
        }
        setFirstRunSeen(true);
      }
      return;
    }
  }, [project?.id, onTranscriptComplete]);

  // Parse SSE text stream incrementally. We buffer between reads and split on
  // blank lines (the SSE event terminator). Each event payload is a single
  // `data: <json>` line in our protocol.
  async function consumeSSE(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const line = frame
          .split("\n")
          .find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          handleEvent(JSON.parse(payload));
        } catch {
          /* malformed frame — skip */
        }
      }
    }
  }

  // Pass 11: persist firstRunSeen the moment the user commits to running. We
  // also already persist on `complete` (Pass 8 behavior); doing both means a
  // run that fails halfway still counts as "user has tried this project" and
  // suppresses the auto-open the next time they navigate back.
  function markFirstRunSeen() {
    if (!project?.id) return;
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(firstRunSeenKey(project.id), "1");
      }
    } catch {
      /* ignore */
    }
    setFirstRunSeen(true);
  }

  // Pass 11: wrap the toggle so an explicit user-driven close marks the
  // first-run flag. We never set the flag on open (the auto-open effect
  // does that path); only on close, which is the user opting out.
  function handleToggleClick() {
    if (isOpen) {
      // User is closing the panel — record intent.
      markFirstRunSeen();
    }
    onToggle?.();
  }

  async function startRun(step = false) {
    if (!project) return;
    if (running) return;
    if (runBlockedReason) {
      setError(runBlockedReason);
      setRunStatus("Run blocked.");
      return;
    }
    markFirstRunSeen();
    resetRunState();
    setRunning(true);
    setRunStatus(step ? "Starting step run..." : "Starting run...");
    setRunId(null);
    setPausedAtLevel(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      // Pass 18 — gather subagent projects reachable from this project so
      // the runtime can resolve every nested ref without phoning home.
      const subagentProjects = collectSubagentProjects(project, allProjects);
      const res = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project,
          query,
          model: selectedModel || undefined,
          step,
          subagentProjects,
        }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const detail = await res.text().catch(() => "");
        throw new Error(`run failed: ${res.status}${detail ? ` ${detail}` : ""}`);
      }
      await consumeSSE(res);
    } catch (err) {
      if (err?.name === "AbortError") {
        setError("run cancelled");
        setRunStatus("Run cancelled.");
      } else {
        setError(err?.message || "run failed");
        setRunStatus("Run failed.");
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  // Pass 15 — fire a control action against the active step controller. No
  // local state mutation; the SSE stream emits the next `level-start` /
  // `complete` events that drive UI transitions.
  async function controlRun(action) {
    if (!runId) return;
    try {
      await fetch("/api/agent/run/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId, action }),
      });
    } catch (err) {
      // Surfaced via warning; the run will still complete or hang on the
      // next level. The Cancel-fetch handler is the hard stop.
      setWarnings((w) => [...w, `control ${action}: ${err?.message || "failed"}`]);
    }
  }

  function cancelRun() {
    // Pass 15 — when stepping, ask the controller to cancel cleanly first
    // so the runtime emits a clean "cancelled" event and the SSE loop
    // doesn't tear. Fall back to abort if no runId.
    if (runId) {
      controlRun("cancel");
    }
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }

  function modelLabel(id) {
    if (!id) return "not run yet";
    const option = modelOptions.find((m) => m.id === id);
    if (!option) return id;
    return `${option.label || option.id} (${option.source || option.provider || "available"})`;
  }

  function nodeModelMessage(row) {
    if (row.mocked) return `${row.title}: mocked output, no model call`;
    const model = row.model || runModel || selectedModel || null;
    return `${row.title}: ${modelLabel(model)}`;
  }

  return (
    <div className={`test-panel ${isOpen ? "is-open" : ""}`} data-test-panel>
      <button
        type="button"
        className="test-panel-handle"
        onClick={handleToggleClick}
        data-test-panel-toggle
        aria-expanded={isOpen}
      >
        {isOpen ? "▼ test panel" : "▲ test panel"}
      </button>

      {isOpen && (
        <div className="test-panel-body">
          {!firstRunSeen && (
            <p className="tp-first-run-hint" data-test-panel-first-run-hint>
              Try: &ldquo;What&rsquo;s the riskiest dependency in this graph?&rdquo;
            </p>
          )}
          <div className="test-panel-controls">
            <label className="tp-field">
              <span className="tp-label">Model</span>
              <select
                className="tp-input tp-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={running || models.length === 0}
                data-test-panel-model
              >
                {models.length === 0 && (
                  <option value="">{modelsError ? "ollama unreachable" : "no models pulled"}</option>
                )}
                {modelOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label || m.id} · {m.source || m.provider || "available"}
                  </option>
                ))}
              </select>
            </label>

            <label className="tp-field tp-field-grow">
              <span className="tp-label">Test query</span>
              <textarea
                className="tp-input tp-textarea"
                rows={2}
                value={query}
                placeholder="Try a query against this graph. e.g. 'Plan the Q3 launch.'"
                onChange={(e) => setQuery(e.target.value)}
                disabled={running}
                data-test-panel-query
              />
            </label>

            <div className="tp-actions">
              {!running ? (
                <>
                  <button
                    type="button"
                    className="tool-btn tp-run"
                    onClick={() => startRun(false)}
                    disabled={!!runBlockedReason}
                    title={runBlockedReason || "Run the graph"}
                    data-test-panel-run
                  >
                    Run
                  </button>
                  <button
                    type="button"
                    className="tool-btn"
                    onClick={() => startRun(true)}
                    disabled={!!runBlockedReason}
                    title={runBlockedReason || "Step through the chain one DAG level at a time"}
                    data-test-panel-step-run
                  >
                    Step run
                  </button>
                </>
              ) : (
                <>
                  {runId && (
                    <>
                      <button
                        type="button"
                        className="tool-btn"
                        onClick={() => controlRun("advance")}
                        title="Advance to the next DAG level"
                        data-test-panel-next-level
                      >
                        Next level{pausedAtLevel != null ? ` (after L${pausedAtLevel})` : ""}
                      </button>
                      <button
                        type="button"
                        className="tool-btn"
                        onClick={() => controlRun("skip-to-end")}
                        title="Run the rest of the chain without further pauses"
                        data-test-panel-skip-to-end
                      >
                        Skip to end
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="tool-btn tp-cancel"
                    onClick={cancelRun}
                    data-test-panel-cancel
                  >
                    Cancel
                  </button>
                </>
              )}
            </div>
          </div>

          {(runStatus || runBlockedReason) && (
            <div
              className={`tp-run-status${runBlockedReason && !running ? " is-blocked" : ""}`}
              role="status"
              data-test-panel-run-status
            >
              {running ? runStatus || "Run in progress..." : runStatus || `Cannot run: ${runBlockedReason}.`}
            </div>
          )}

          {warnings.length > 0 && (
            <ul className="tp-warnings" data-test-panel-warnings>
              {warnings.map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}

          {error && (
            <div className="tp-error" data-test-panel-error>
              {error}
            </div>
          )}

          <div className="tp-stages" data-test-panel-stages>
            {levelPlan.error && <div className="tp-stage-error">{levelPlan.error}; showing all nodes together.</div>}
            {stageGroups.map((stage) => (
              <section key={stage.index} className="tp-stage" data-test-panel-stage={stage.index}>
                <div className="tp-stage-header">
                  <span>Step {stage.index + 1}</span>
                  <span>{stage.rows.length} node{stage.rows.length === 1 ? "" : "s"}</span>
                </div>
                <ul className="tp-nodes" data-test-panel-nodes>
                  {stage.rows.map((n) => (
                    <li key={n.id} className="tp-node-row" data-node-id={n.id} data-status={n.status}>
                      <span className="tp-node-status" style={{ color: statusColor(n.status) }}>
                        ●
                      </span>
                      <span className="tp-node-title">{n.title}</span>
                      <span className="tp-node-role">{n.role}</span>
                      <span className="tp-node-meta">
                        {n.status === "running" && n.bytes ? `${n.bytes}b...` : null}
                        {n.status === "ok" && n.durationMs != null
                          ? `${n.durationMs}ms · ${n.bytes ?? 0}b`
                          : null}
                        {n.status === "error" ? n.error : null}
                        {n.status === "idle" ? STATUS_LABEL.idle : null}
                      </span>
                      <button
                        type="button"
                        className="tp-info-btn"
                        title={nodeModelMessage(n)}
                        aria-label={`Show model for ${n.title}`}
                        onClick={() => alert(nodeModelMessage(n))}
                      >
                        i
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {(brief || runDir) && (
            <div className="tp-result" data-test-panel-result>
              <div className="tp-result-header">
                <span className="studio-eyebrow">Brief</span>
                {runDir && (
                  <button
                    type="button"
                    className="tool-btn tp-runfolder"
                    onClick={() => alert(`Run folder:\n${runDir}`)}
                    title={runDir}
                    data-test-panel-runfolder
                  >
                    Open run folder
                  </button>
                )}
              </div>
              {brief && <pre className="tp-brief" data-test-panel-brief>{brief}</pre>}
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        .test-panel {
          position: relative;
          width: 100%;
          flex: 0 0 auto;
          background: var(--surface);
          border-top: 1px solid var(--border);
          z-index: 6;
          max-height: min(42vh, 340px);
          display: flex;
          flex-direction: column;
        }
        .test-panel-handle {
          align-self: center;
          margin-top: -14px;
          padding: 4px 14px;
          font-size: 11px;
          font-family: inherit;
          color: var(--muted);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 999px;
          cursor: pointer;
          letter-spacing: 0.04em;
        }
        .test-panel-handle:hover {
          color: var(--accent-strong);
          border-color: var(--accent);
        }
        .test-panel-body {
          padding: 12px 18px 14px;
          overflow-y: auto;
          min-height: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .tp-first-run-hint {
          margin: 0;
          padding: 6px 10px;
          font-size: 12px;
          color: var(--muted);
          background: var(--accent-soft);
          border: 1px solid var(--border);
          border-radius: 8px;
        }
        .test-panel-controls {
          display: flex;
          gap: 12px;
          align-items: flex-end;
          flex-wrap: wrap;
        }
        .tp-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 180px;
        }
        .tp-field-grow {
          flex: 1 1 320px;
        }
        .tp-label {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .tp-input {
          padding: 8px 10px;
          font-family: inherit;
          font-size: 13px;
          color: var(--ink);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          outline: none;
        }
        .tp-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .tp-textarea {
          resize: vertical;
          line-height: 1.4;
          min-height: 44px;
        }
        .tp-select {
          cursor: pointer;
        }
        .tp-actions {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .tp-run {
          color: var(--accent-strong);
          border-color: var(--accent);
        }
        .tp-cancel {
          color: var(--danger, #b00020);
          border-color: var(--danger, #b00020);
        }
        .tp-run-status {
          padding: 7px 10px;
          background: var(--surface-muted, #f4f3ee);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--muted);
          font-size: 12px;
        }
        .tp-run-status.is-blocked {
          background: var(--policy-soft, #fff7e0);
          color: var(--ink);
        }
        .tp-warnings {
          margin: 0;
          padding: 8px 10px;
          list-style: none;
          background: var(--policy-soft, #fff7e0);
          border: 1px solid var(--border);
          border-radius: 8px;
          font-size: 12px;
          color: var(--ink);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .tp-error {
          padding: 8px 10px;
          background: var(--danger-soft, #fde7ea);
          border: 1px solid var(--danger, #b00020);
          border-radius: 8px;
          font-size: 12px;
          color: var(--danger, #b00020);
        }
        .tp-stages {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .tp-stage {
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
          background: var(--surface);
        }
        .tp-stage-header {
          min-height: 28px;
          padding: 6px 10px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          background: var(--surface-muted, #f4f3ee);
          border-bottom: 1px solid var(--border);
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .tp-stage-error {
          padding: 7px 10px;
          border: 1px solid var(--danger, #b00020);
          border-radius: 8px;
          color: var(--danger, #b00020);
          background: var(--danger-soft, #fde7ea);
          font-size: 12px;
        }
        .tp-nodes {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }
        .tp-node-row {
          display: grid;
          grid-template-columns: 18px minmax(0, 1fr) 90px minmax(96px, 1fr) 28px;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          font-size: 12px;
          background: var(--surface);
        }
        .tp-node-row + .tp-node-row {
          border-top: 1px solid var(--border);
        }
        .tp-node-status {
          font-size: 14px;
          line-height: 1;
        }
        .tp-node-title {
          font-weight: 500;
          color: var(--ink);
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tp-node-role {
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .tp-node-meta {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 11px;
          color: var(--muted);
          text-align: right;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tp-info-btn {
          width: 24px;
          height: 24px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--border);
          border-radius: 999px;
          background: var(--surface);
          color: var(--muted);
          font: inherit;
          font-size: 11px;
          cursor: pointer;
        }
        .tp-info-btn:hover {
          border-color: var(--accent);
          color: var(--accent-strong);
        }
        @media (max-width: 760px) {
          .test-panel-body {
            padding: 10px 12px 12px;
          }
          .tp-field {
            min-width: 100%;
          }
          .tp-node-row {
            grid-template-columns: 18px minmax(0, 1fr) 64px 28px;
          }
          .tp-node-meta {
            grid-column: 2 / 5;
            text-align: left;
          }
        }
        .tp-result {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .tp-result-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .tp-brief {
          margin: 0;
          padding: 10px 12px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          font-size: 12px;
          line-height: 1.5;
          white-space: pre-wrap;
          max-height: 240px;
          overflow: auto;
        }
      `}</style>
    </div>
  );
}
