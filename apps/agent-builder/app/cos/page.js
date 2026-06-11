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
import { CalendarCheck, Download, Upload } from "lucide-react";
import CascadeTimeline, { NODE_ORDER } from "./components/CascadeTimeline";
import CloudControls from "./components/CloudControls";
import TelemetryPanel from "./components/TelemetryPanel";
import { describeScheduleInput, normalizeScheduleInput } from "../../lib/cos-schedule-input.mjs";
import {
  buildApprovedCalendarIcs,
  calendarBlocksFromTranscript,
  calendarReviewStats,
} from "../../lib/cos-calendar-export.mjs";

const EMPTY_NODE = { status: "pending" };

const initialNodes = () =>
  Object.fromEntries(NODE_ORDER.map((k) => [k, { ...EMPTY_NODE }]));

export default function CosPage() {
  // ---------- input state ----------
  const [schedule, setSchedule] = useState("");
  const [scheduleMeta, setScheduleMeta] = useState(null);
  const [goals, setGoals] = useState("");
  const [actualFocus, setActualFocus] = useState("");
  const [followThrough, setFollowThrough] = useState("");
  const [feedbackNotes, setFeedbackNotes] = useState("");
  const [sample, setSample] = useState(null); // last loaded sample for restore-button label
  const [running, setRunning] = useState(false);
  const [showAbout, setShowAbout] = useState(true);
  const [showRawJson, setShowRawJson] = useState(false);

  // ---------- cascade controls ----------
  const [allowCloud, setAllowCloud] = useState("on-failure");
  const [envStatus, setEnvStatus] = useState(null);

  // ---------- run state ----------
  const [warmup, setWarmup] = useState(null); // null | "running" | "ok" | "fail"
  const [warmupTarget, setWarmupTarget] = useState(null);
  const [nodes, setNodes] = useState(initialNodes);
  const [lessons, setLessons] = useState(null); // {lessons: [...], nodes: [...]}
  const [summary, setSummary] = useState(null);
  const [brief, setBrief] = useState("");
  const [transcript, setTranscript] = useState(null);
  const [calendarDrafts, setCalendarDrafts] = useState([]);
  const [error, setError] = useState("");

  const abortRef = useRef(null);
  const fileInputRef = useRef(null);

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
    setScheduleMeta(normalizeScheduleInput(sample.schedule));
    if (sample.goal) setGoals(sample.goal);
  }

  function clearAll() {
    setSchedule("");
    setScheduleMeta(null);
    setGoals("");
    setActualFocus("");
    setFollowThrough("");
    setFeedbackNotes("");
  }

  // ---------- run lifecycle ----------

  function resetRunState() {
    setError("");
    setBrief("");
    setTranscript(null);
    setCalendarDrafts([]);
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
          feedback: buildFeedbackPayload(),
          allowCloud,
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

  const scheduleLooksLikeJson = /^\s*[\[{]/.test(schedule.trim());
  const schedulePreview = useMemo(
    () => (schedule.trim() ? normalizeScheduleInput(schedule) : null),
    [schedule],
  );
  const activeScheduleMeta = scheduleMeta ?? schedulePreview;
  const calendarStats = useMemo(() => calendarReviewStats(calendarDrafts), [calendarDrafts]);
  const approvedCalendarUrl = useMemo(() => {
    if (!calendarDrafts.length || calendarStats.approved === 0) return null;
    const weekOf = transcript?.nodes?.intake?.parsed?.weekOf;
    return blobUrl(buildApprovedCalendarIcs(calendarDrafts, { weekOf }), "text/calendar");
  }, [calendarDrafts, calendarStats.approved, transcript]);
  const canRun = useMemo(
    () => !running && (schedule.trim().length > 0 || goals.trim().length > 0 || sample != null),
    [running, schedule, goals, sample],
  );
  const allLanesUnreachable =
    error && error.includes("unreachable") && envStatus && !envStatus.groq && !envStatus.anthropic && !envStatus.openai;

  useEffect(() => {
    setCalendarDrafts(calendarBlocksFromTranscript(transcript));
  }, [transcript]);

  async function importScheduleFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const text = await file.text();
    const meta = normalizeScheduleInput(text, { fileName: file.name });
    setSchedule(meta.sourceType === "ics" ? meta.normalizedText : text);
    setScheduleMeta(meta);
  }

  function updateSchedule(value) {
    setSchedule(value);
    setScheduleMeta(null);
  }

  function buildFeedbackPayload() {
    const payload = {
      actualFocus,
      followThrough,
      notes: feedbackNotes,
    };
    return Object.fromEntries(Object.entries(payload).filter(([, value]) => String(value ?? "").trim()));
  }

  function updateCalendarDraft(id, key, value) {
    setCalendarDrafts((items) => items.map((item) => item.id === id ? { ...item, [key]: value } : item));
  }

  function toggleCalendarDraft(id) {
    setCalendarDrafts((items) => items.map((item) => item.id === id ? { ...item, approved: !item.approved } : item));
  }

  return (
    <div className="cos-shell">
      <header className="cos-header">
        <h1>Chief of Staff</h1>
        <p>
          Plans your week. Picks the three highest-leverage outcomes, builds a
          time-block schedule, drafts follow-ups, surfaces decisions, and
          flags risks.
        </p>
        <button
          type="button"
          className="cos-disclosure"
          onClick={() => setShowAbout((v) => !v)}
          aria-expanded={showAbout}
        >
          {showAbout ? "Hide" : "Show"} how it works
        </button>
      </header>

      {showAbout && (
        <section className="cos-about" aria-label="What this does and how to use it">
          <div className="cos-about-grid">
            <div>
              <h3>Workflow</h3>
              <ol>
                <li>Tell it your week — paste a calendar, list events in plain text, or load the sample.</li>
                <li>Optionally state a goal (e.g. &ldquo;ship the migration&rdquo;). Defaults to a productivity goal.</li>
                <li>Click <em>Run agent</em>. Watch the cascade panel below.</li>
                <li>Read the brief. Download the raw transcript, telemetry, or markdown brief.</li>
              </ol>
            </div>
            <div>
              <h3>What you get</h3>
              <ul>
                <li><strong>Top 3 outcomes</strong> — leverage-ranked, with rejected items called out.</li>
                <li><strong>Time blocks</strong> — 5–9 named blocks for the week with rationale.</li>
                <li><strong>Decisions to prep</strong> — options + recommendations.</li>
                <li><strong>Follow-ups</strong> — owner / action / due date per item.</li>
                <li><strong>Risk audit</strong> — missing owners, overload, unverified claims.</li>
              </ul>
            </div>
            <div>
              <h3>Cascade</h3>
              <p>
                Local first (Ollama: <code>qwen3:8b</code> for parse, <code>gemma4:26b</code> for
                synthesis). On local failure, falls back to Groq cloud. Anthropic + OpenAI lanes
                wired but stubbed — require keys to enable.
              </p>
            </div>
          </div>
          <div className="cos-about-status">
            <h3>What&rsquo;s wired</h3>
            <dl>
              <div><dt>MLX (local-primary)</dt><dd>OpenAI-compatible <code>mlx_lm.server</code> (default 127.0.0.1:8080) · head of the local cascade; skipped to Ollama when the server isn&rsquo;t running</dd></div>
              <div><dt>Ollama (local-fallback)</dt><dd>{envStatus ? "✓ live" : "checking…"}</dd></div>
              <div><dt>Groq (cloud-1)</dt><dd>{envStatus?.groq ? "✓ key detected · llama-3.3-70b for synthesis, llama-3.1-8b for parse" : "no key — set GROQ_API_KEY in shell"}</dd></div>
              <div><dt>Anthropic (cloud-2)</dt><dd>✓ implemented (/v1/messages with prefill + prompt-cache) · key-gated — set <code>ANTHROPIC_API_KEY</code> to enable the lane</dd></div>
              <div><dt>OpenAI (cloud-3)</dt><dd>✓ implemented (/v1/chat/completions, json_schema mode) · key-gated — set <code>OPENAI_API_KEY</code> to enable the lane</dd></div>
              <div><dt>Telemetry / downloads</dt><dd>✓ JSONL per run · brief.md · transcript.json</dd></div>
              <div><dt>Learning ledger</dt><dd>✓ promoted lessons from prior runs inject into triage + time-block</dd></div>
              <div><dt>Cascade events on SSE</dt><dd>✓ cascade-attempt · node-end · run-summary · lesson-loaded</dd></div>
              <div><dt>Local JSON DOE</dt><dd>✓ measured 2026-06-09 (evals/doe/): strict ONLY-JSON suffix +10pts pass rate on 3B locals; inlined schema −22pts. Re-run: npm run doe:local-json</dd></div>
            </dl>
          </div>
        </section>
      )}

      <CloudControls
        allowCloud={allowCloud}
        setAllowCloud={setAllowCloud}
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
            <input
              ref={fileInputRef}
              type="file"
              accept=".ics,text/calendar"
              hidden
              onChange={importScheduleFile}
            />
            <button
              type="button"
              className="cos-secondary cos-icon-text"
              onClick={() => fileInputRef.current?.click()}
              disabled={running}
            >
              <Upload size={14} />
              Import .ics
            </button>
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
          <span>Your week {scheduleLooksLikeJson ? "· (JSON detected)" : "· paste calendar or describe events"}</span>
          <textarea
            rows={8}
            value={schedule}
            onChange={(e) => updateSchedule(e.target.value)}
            disabled={running}
            placeholder={
              "Mon 9-11am: deep work on the migration\nMon 2pm: 1:1 with Sam\nTue 10-12: pitch dry run with team\nWed all day: heads-down\nThu 3-5pm: customer call\n\nOR paste a VCALENDAR export, import .ics, or load the sample."
            }
            spellCheck={false}
          />
          <div className="cos-field-meta">
            <button
              type="button"
              className="cos-disclosure-inline"
              onClick={() => setShowRawJson((v) => !v)}
              aria-expanded={showRawJson}
            >
              {showRawJson ? "▾ Hide JSON wire view" : "▸ Show JSON wire view"}
            </button>
            <span className="cos-field-hint">
              {activeScheduleMeta
                ? describeScheduleInput(activeScheduleMeta)
                : "Free text gets parsed by the intake step into structured JSON before planning."}
            </span>
          </div>
          {activeScheduleMeta?.warnings?.length > 0 && (
            <ul className="cos-inline-warnings">
              {activeScheduleMeta.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
        </label>

        {showRawJson && (
          <details className="cos-json-view" open>
            <summary>Schedule (JSON wire format) — edit here for precise control</summary>
            <textarea
              rows={10}
              value={schedule}
              onChange={(e) => updateSchedule(e.target.value)}
              disabled={running}
              placeholder='{"weekOf": "2026-05-12", "fixedEvents": [{"day":"Mon","start":"09:00","end":"11:00","title":"Deep work","kind":"deep"}], "flexibleEvents": []}'
              spellCheck={false}
              className="cos-json-textarea"
            />
            <p className="cos-field-hint">
              This is the same field as &ldquo;Your week&rdquo; above — edits flow both ways. Use this view when you have JSON from a tool or want to specify shape exactly.
            </p>
          </details>
        )}

        <label className="cos-field">
          <span>Goal (optional — defaults to a productivity goal)</span>
          <textarea
            rows={3}
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            disabled={running}
            placeholder="e.g. Ship the migration this week. Or: organize all the kid summer camps."
          />
        </label>

        <fieldset className="cos-feedback">
          <legend>Weekly feedback</legend>
          <label>
            <span>Actual focus</span>
            <input
              value={actualFocus}
              onChange={(e) => setActualFocus(e.target.value)}
              disabled={running}
              placeholder="e.g. 6 focused hours; Wednesday derailed by calls"
            />
          </label>
          <label>
            <span>Follow-through</span>
            <input
              value={followThrough}
              onChange={(e) => setFollowThrough(e.target.value)}
              disabled={running}
              placeholder="e.g. shipped migration review; missed partner follow-up"
            />
          </label>
          <label className="cos-feedback-wide">
            <span>Notes</span>
            <textarea
              rows={3}
              value={feedbackNotes}
              onChange={(e) => setFeedbackNotes(e.target.value)}
              disabled={running}
              placeholder="Plan changes to preserve, habits to avoid, or explicit lessons from last week."
            />
          </label>
        </fieldset>

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

      {calendarDrafts.length > 0 && (
        <section className="cos-calendar-review">
          <header className="cos-calendar-head">
            <div>
              <h2>Calendar review</h2>
              <p>{calendarStats.approved}/{calendarStats.total} approved</p>
            </div>
            {approvedCalendarUrl && (
              <a
                href={approvedCalendarUrl}
                download="chief-of-staff-approved-blocks.ics"
                className="cos-download-button"
              >
                <Download size={14} />
                Download .ics
              </a>
            )}
          </header>
          <div className="cos-calendar-list">
            {calendarDrafts.map((item) => (
              <div className={`cos-calendar-row ${item.approved ? "" : "is-rejected"}`} key={item.id}>
                <label className="cos-check">
                  <input
                    type="checkbox"
                    checked={item.approved}
                    onChange={() => toggleCalendarDraft(item.id)}
                  />
                  <CalendarCheck size={16} />
                </label>
                <input
                  aria-label="Day"
                  value={item.day}
                  onChange={(e) => updateCalendarDraft(item.id, "day", e.target.value)}
                />
                <input
                  aria-label="Start"
                  value={item.start}
                  onChange={(e) => updateCalendarDraft(item.id, "start", e.target.value)}
                />
                <input
                  aria-label="End"
                  value={item.end}
                  onChange={(e) => updateCalendarDraft(item.id, "end", e.target.value)}
                />
                <input
                  aria-label="Mode"
                  value={item.mode}
                  onChange={(e) => updateCalendarDraft(item.id, "mode", e.target.value)}
                />
                <input
                  aria-label="Why"
                  value={item.why}
                  onChange={(e) => updateCalendarDraft(item.id, "why", e.target.value)}
                />
              </div>
            ))}
          </div>
        </section>
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
          margin: 6px 0 8px;
          color: var(--muted);
          font-size: 14px;
          line-height: 1.5;
        }
        .cos-disclosure {
          background: none;
          border: none;
          padding: 4px 0;
          min-height: 24px;
          margin-bottom: 16px;
          color: var(--accent-strong);
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
        }
        .cos-disclosure:hover {
          text-decoration: underline;
        }
        .cos-about {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 18px 20px;
          margin-bottom: 12px;
          font-size: 13px;
          line-height: 1.55;
        }
        .cos-about-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 24px;
        }
        .cos-about h3 {
          margin: 0 0 8px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .cos-about ol,
        .cos-about ul {
          margin: 0;
          padding-left: 18px;
        }
        .cos-about li {
          margin-bottom: 4px;
        }
        .cos-about p {
          margin: 0;
        }
        .cos-about code {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          background: var(--surface-muted);
          padding: 1px 5px;
          border-radius: 3px;
        }
        .cos-about-status {
          margin-top: 18px;
          padding-top: 14px;
          border-top: 1px solid var(--border);
        }
        .cos-about-status dl {
          display: grid;
          grid-template-columns: max-content 1fr;
          gap: 4px 16px;
          margin: 0;
        }
        .cos-about-status dl > div {
          display: contents;
        }
        .cos-about-status dt {
          color: var(--ink);
          font-weight: 600;
          font-size: 12px;
          white-space: nowrap;
        }
        .cos-about-status dd {
          margin: 0;
          color: var(--muted);
          font-size: 12px;
        }
        .cos-field-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 4px;
        }
        .cos-disclosure-inline {
          min-height: 24px;
          padding: 4px 0;
          background: none;
          border: none;
          color: var(--accent-strong);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
        }
        .cos-disclosure-inline:hover {
          text-decoration: underline;
        }
        .cos-field-hint {
          color: var(--muted);
          font-size: 12px;
        }
        .cos-inline-warnings {
          margin: 2px 0 0;
          padding-left: 18px;
          color: var(--danger);
          font-size: 12px;
          line-height: 1.4;
        }
        .cos-json-view {
          margin: 0 0 14px;
          padding: 10px 12px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          font-size: 12px;
        }
        .cos-json-view summary {
          cursor: pointer;
          color: var(--muted);
          font-weight: 600;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          font-size: 11px;
          margin-bottom: 8px;
        }
        .cos-json-textarea {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          line-height: 1.45;
          width: 100%;
          margin-top: 6px;
          padding: 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--surface);
          resize: vertical;
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
          flex-wrap: wrap;
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
        .cos-icon-text {
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .cos-feedback {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin: 0 0 14px;
          padding: 12px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg);
        }
        .cos-feedback legend {
          padding: 0 6px;
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
        }
        .cos-feedback label {
          display: grid;
          gap: 6px;
        }
        .cos-feedback span {
          color: var(--muted);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .cos-feedback input,
        .cos-feedback textarea,
        .cos-calendar-row input {
          width: 100%;
          min-width: 0;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--surface);
          color: var(--ink);
        }
        .cos-feedback input {
          min-height: 36px;
          padding: 0 10px;
        }
        .cos-feedback textarea {
          padding: 9px 10px;
          resize: vertical;
        }
        .cos-feedback-wide {
          grid-column: 1 / -1;
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
        .cos-calendar-review {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px 18px;
          margin-bottom: 12px;
        }
        .cos-calendar-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }
        .cos-calendar-head h2 {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .cos-calendar-head p {
          margin: 3px 0 0;
          color: var(--muted);
          font-size: 12px;
        }
        .cos-download-button {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          min-height: 36px;
          padding: 0 12px;
          border-radius: 8px;
          background: var(--accent);
          color: #fff;
          font-size: 12px;
          font-weight: 700;
          text-decoration: none;
        }
        .cos-download-button:hover {
          background: var(--accent-strong);
        }
        .cos-calendar-list {
          display: grid;
          gap: 8px;
        }
        .cos-calendar-row {
          display: grid;
          grid-template-columns: 32px minmax(72px, 0.7fr) minmax(64px, 0.55fr) minmax(64px, 0.55fr) minmax(150px, 1.2fr) minmax(220px, 1.8fr);
          gap: 8px;
          align-items: center;
        }
        .cos-calendar-row.is-rejected {
          opacity: 0.52;
        }
        .cos-calendar-row input {
          min-height: 34px;
          padding: 0 8px;
          font-size: 12px;
        }
        .cos-check {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--accent-strong);
        }
        .cos-check input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }
        .cos-check svg {
          border: 1px solid var(--border);
          border-radius: 6px;
          width: 28px;
          height: 28px;
          padding: 5px;
          background: var(--accent-soft);
        }
        .cos-calendar-row.is-rejected .cos-check svg {
          background: var(--surface-muted);
          color: var(--faint);
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
        @media (max-width: 760px) {
          .cos-form-head,
          .cos-calendar-head {
            align-items: flex-start;
            flex-direction: column;
          }
          .cos-feedback {
            grid-template-columns: 1fr;
          }
          .cos-calendar-row {
            grid-template-columns: 32px 1fr 1fr;
          }
          .cos-calendar-row input[aria-label="Mode"],
          .cos-calendar-row input[aria-label="Why"] {
            grid-column: 2 / -1;
          }
        }
      `}</style>
    </div>
  );
}

function blobUrl(text, type) {
  if (typeof window === "undefined") return null;
  const blob = new Blob([text], { type });
  return URL.createObjectURL(blob);
}
