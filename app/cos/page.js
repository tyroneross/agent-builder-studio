"use client";

// Chief of Staff workbench.
//
// Wired to /api/cos/run (the cascade-aware endpoint). SSE event taxonomy:
//   warmup / warmup-ok / warmup-fail
//   cascade-attempt        — fired before each cascade step's provider call
//   node-start / node-chunk / node-end / node-error  — per-node lifecycle
//   lesson-loaded          — promoted lessons injected (full text + nodes)
//   run-summary            — penultimate event with the {perNode, totals} digest
//   complete               — final event with brief + transcript
//
// State machine per node row (see CascadeTimeline):
//   pending → trying (cascade-attempt) → ok (node-end) | failed (node-error)

import { useEffect, useMemo, useRef, useState } from "react";
import CascadeTimeline, { NODE_ORDER } from "./components/CascadeTimeline";
import CloudControls from "./components/CloudControls";
import TelemetryPanel from "./components/TelemetryPanel";

const EMPTY_NODE = { status: "pending" };

const initialNodes = () =>
  Object.fromEntries(NODE_ORDER.map((k) => [k, { ...EMPTY_NODE }]));

export default function CosPage() {
  // ---------- input state ----------
  const [schedule, setSchedule] = useState("");
  const [goals, setGoals] = useState("");
  const [sample, setSample] = useState(null); // last loaded sample for restore-button label
  const [running, setRunning] = useState(false);

  // ---------- cascade controls ----------
  const [allowCloud, setAllowCloud] = useState("on-failure");
  const [maxCloudTokens, setMaxCloudTokens] = useState(200000);
  const [envStatus, setEnvStatus] = useState(null);

  // ---------- run state ----------
  const [warmup, setWarmup] = useState(null); // null | "running" | "ok" | "fail"
  const [warmupTarget, setWarmupTarget] = useState(null);
  const [nodes, setNodes] = useState(initialNodes);
  const [lessons, setLessons] = useState(null); // {lessons: [...], nodes: [...]}
  const [summary, setSummary] = useState(null);
  const [brief, setBrief] = useState("");
  const [transcript, setTranscript] = useState(null);
  const [error, setError] = useState("");

  const abortRef = useRef(null);

  // ---------- bootstrap: env-status + sample schedule ----------
  useEffect(() => {
    fetch("/api/cos/env-status")
      .then((r) => r.json())
      .then(setEnvStatus)
      .catch(() => setEnvStatus({ groq: false, anthropic: false, openai: false }));

    // Try to load the bundled sample schedule for one-click input.
    fetch("/api/cos/sample")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.schedule) {
          setSample({ schedule: d.schedule, goal: d.goal ?? "" });
        }
      })
      .catch(() => {});
  }, []);

  function loadSample() {
    if (!sample) return;
    setSchedule(sample.schedule);
    if (sample.goal) setGoals(sample.goal);
  }

  function clearAll() {
    setSchedule("");
    setGoals("");
  }

  // ---------- run lifecycle ----------

  function resetRunState() {
    setError("");
    setBrief("");
    setTranscript(null);
    setSummary(null);
    setLessons(null);
    setWarmup(null);
    setWarmupTarget(null);
    setNodes(initialNodes());
  }

  async function start() {
    if (running) return;
    resetRunState();
    setRunning(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/cos/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          schedule,
          goals,
          allowCloud,
          maxCloudTokens,
        }),
        signal: ac.signal,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`server ${res.status}: ${t.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const block of events) {
          const line = block.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          let ev;
          try {
            ev = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          handleEvent(ev);
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") setError(err.message ?? String(err));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.abort();
  }

  function handleEvent(ev) {
    switch (ev.type) {
      case "warmup":
        setWarmup("running");
        setWarmupTarget(`${ev.provider}/${ev.model}`);
        break;
      case "warmup-ok":
        setWarmup("ok");
        break;
      case "warmup-fail":
        setWarmup("fail");
        break;
      case "warmup-skip":
        setWarmup("ok");
        break;
      case "cascade-attempt":
        setNodes((s) => ({
          ...s,
          [ev.node]: {
            ...(s[ev.node] ?? {}),
            status: "trying",
            currentLane: ev.lane,
            currentProvider: ev.provider,
            currentModel: ev.model,
            attempt: ev.attempt,
          },
        }));
        break;
      case "node-end":
        setNodes((s) => ({
          ...s,
          [ev.key]: {
            ...(s[ev.key] ?? {}),
            status: "ok",
            durationMs: ev.durationMs,
            lane: ev.lane,
            provider: ev.provider,
            model: ev.model,
            parseRetried: ev.parseRetried ?? false,
          },
        }));
        break;
      case "node-error":
        setNodes((s) => ({
          ...s,
          [ev.key]: {
            ...(s[ev.key] ?? {}),
            status: "failed",
            durationMs: ev.durationMs,
            error: ev.error,
            lane: s[ev.key]?.currentLane ?? null,
            provider: ev.provider,
            model: ev.model,
          },
        }));
        break;
      case "lesson-loaded":
        setLessons({ lessons: ev.lessons ?? [], nodes: ev.nodes ?? [] });
        break;
      case "run-summary":
        setSummary(ev.summary);
        break;
      case "complete":
        setBrief(ev.brief ?? "");
        setTranscript(ev.transcript ?? null);
        break;
      case "fatal":
        setError(ev.error ?? "fatal error");
        break;
      default:
        break;
    }
  }

  const canRun = useMemo(() => !running, [running]);
  const allLanesUnreachable =
    error && error.includes("unreachable") && envStatus && !envStatus.groq && !envStatus.anthropic && !envStatus.openai;

  return (
    <div className="cos-shell">
      <header className="cos-header">
        <h1>Chief of Staff</h1>
        <p>
          Local-first cascade. Falls back to Groq, Anthropic, then OpenAI when
          local lanes fail. Telemetry per node, role-scoped briefs, learning
          ledger injection.
        </p>
      </header>

      <CloudControls
        allowCloud={allowCloud}
        setAllowCloud={setAllowCloud}
        maxCloudTokens={maxCloudTokens}
        setMaxCloudTokens={setMaxCloudTokens}
        envStatus={envStatus}
        disabled={running}
      />

      <section className="cos-form">
        <header className="cos-form-head">
          <h2>Inputs</h2>
          <div className="cos-form-actions">
            {sample && (
              <button
                type="button"
                className="cos-secondary"
                onClick={loadSample}
                disabled={running}
              >
                Load sample
              </button>
            )}
            <button
              type="button"
              className="cos-secondary"
              onClick={clearAll}
              disabled={running}
            >
              Clear
            </button>
          </div>
        </header>

        <label className="cos-field">
          <span>Schedule (JSON)</span>
          <textarea
            rows={8}
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            disabled={running}
            placeholder='{"weekOf": "2026-05-12", "fixedEvents": [...], "flexibleEvents": [...]}'
            spellCheck={false}
          />
        </label>

        <label className="cos-field">
          <span>Goal (optional — defaults to a productivity goal)</span>
          <textarea
            rows={3}
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            disabled={running}
            placeholder="e.g. Become 100x more productive on high-leverage strengths."
          />
        </label>

        <div className="cos-actions">
          {!running ? (
            <button
              type="button"
              className={`cos-primary ${canRun ? "cos-primary-active" : ""}`}
              onClick={start}
              disabled={!canRun}
            >
              Run agent
            </button>
          ) : (
            <button type="button" className="cos-cancel" onClick={cancel}>
              Cancel
            </button>
          )}
          {warmup && (
            <span className={`cos-warmup cos-warmup-${warmup}`}>
              warmup: {warmup === "running" ? `loading ${warmupTarget}…` : warmup}
            </span>
          )}
        </div>

        {error && (
          <p className="cos-error">
            {error}
            {allLanesUnreachable && (
              <>
                {" "}
                <a href="#cloud-keys-help">Set up cloud keys</a>
              </>
            )}
          </p>
        )}
      </section>

      <CascadeTimeline nodes={nodes} />

      {summary && (
        <TelemetryPanel
          summary={summary}
          brief={brief}
          transcript={transcript}
          lessons={lessons?.lessons}
        />
      )}

      {brief && (
        <section className="cos-brief">
          <h2>Brief</h2>
          <pre>{brief}</pre>
        </section>
      )}

      <style jsx>{`
        .cos-shell {
          max-width: 960px;
          margin: 0 auto;
          padding: 32px 24px 80px;
          color: var(--ink);
        }
        .cos-header h1 {
          margin: 0;
          font-size: 28px;
          letter-spacing: -0.01em;
        }
        .cos-header p {
          margin: 6px 0 24px;
          color: var(--muted);
          font-size: 14px;
          line-height: 1.5;
        }
        .cos-form,
        .cos-brief {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px 18px;
          margin-bottom: 12px;
        }
        .cos-form-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 14px;
        }
        .cos-form-head h2 {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .cos-form-actions {
          display: flex;
          gap: 8px;
        }
        .cos-field {
          display: grid;
          gap: 6px;
          margin-bottom: 14px;
        }
        .cos-field span {
          color: var(--muted);
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .cos-field textarea {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 13px;
          line-height: 1.45;
          resize: vertical;
        }
        .cos-actions {
          display: flex;
          align-items: center;
          gap: 14px;
          margin-top: 8px;
        }
        .cos-primary {
          padding: 10px 18px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          border: 1px solid transparent;
          background: var(--surface-muted);
          color: var(--faint);
        }
        .cos-primary-active {
          background: var(--accent);
          color: #fff;
        }
        .cos-primary-active:hover {
          background: var(--accent-strong);
        }
        .cos-primary:disabled {
          cursor: not-allowed;
        }
        .cos-secondary {
          padding: 6px 12px;
          border-radius: 8px;
          font-weight: 500;
          font-size: 12px;
          cursor: pointer;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink);
        }
        .cos-secondary:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--accent-strong);
        }
        .cos-secondary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .cos-cancel {
          padding: 10px 18px;
          border-radius: 8px;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          background: var(--surface);
          color: var(--danger);
          border: 1px solid var(--danger);
        }
        .cos-warmup {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
        }
        .cos-warmup-running {
          color: var(--policy);
        }
        .cos-warmup-ok {
          color: var(--accent-strong);
        }
        .cos-warmup-fail {
          color: var(--danger);
        }
        .cos-error {
          color: var(--danger);
          font-size: 13px;
          line-height: 1.45;
          margin: 12px 0 0;
        }
        .cos-error a {
          color: inherit;
        }
        .cos-brief h2 {
          margin: 0 0 12px;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .cos-brief pre {
          margin: 0;
          white-space: pre-wrap;
          word-wrap: break-word;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 13px;
          line-height: 1.55;
          background: var(--bg);
          padding: 14px;
          border-radius: 8px;
          border: 1px solid var(--border);
        }
      `}</style>
    </div>
  );
}
