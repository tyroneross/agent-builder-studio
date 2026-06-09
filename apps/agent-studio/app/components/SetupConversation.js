"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import WorkingFolderInput from "./WorkingFolderInput";
import {
  PERMITTED_PATH_PREFIXES,
  defaultWorkingFolder,
  looksAbsolutePath,
  slugifyProjectName,
} from "../lib/projects";
import { canvasFromPattern } from "../lib/agent-patterns";
import { PATTERNS } from "../lib/agent-patterns";

// SetupConversation — Pass 12 conversational new-project flow.
//
// One LLM round-trip + 1-3 inline clarifying questions + summary review.
// Replaces NewProjectForm as the default landing-page entry. The manual form
// remains available behind a "Fill the form myself" link.
//
// Flow:
//   step="goal"     — single textarea + Start button
//   step="loading"  — spinner while /api/setup/suggest runs
//   step="error"    — Ollama unreachable / parse failure; offers manual form
//   step="chat"     — questions rendered as bubbles, one at a time
//   step="summary"  — editable name + folder + Create button
//
// Calm Precision rules applied:
//   - One primary action per surface (Start, then per-question, then Create).
//   - Status comes from text color/weight; chat bubbles use bg tone only.
//   - Single border on the chat container; bubbles have no individual borders.
//   - Action buttons have distinct enabled/disabled states (muted vs accent).
//   - Progressive disclosure: one question at a time.
//
// Props:
//   onCreate({name, workingFolder, goal, context, outcome, uploads, canvas, seedPatternId})
//     — same shape as NewProjectForm.onCreate so the parent's handleCreate is
//       reused unchanged.
//   onSwitchToManual({goal})
//     — escape hatch; parent swaps in NewProjectForm. Goal carries over so
//       the user doesn't have to retype.
//   preferredPattern  — string id, soft hint passed to /api/setup/suggest.
//   initialGoal       — optional pre-filled goal text (e.g. when wizard
//                       re-targets to this component after pattern click; we
//                       keep the textarea EMPTY but show a placeholder via
//                       initialGoalPlaceholder; this prop is for resuming
//                       state when toggling between conversation/manual).
//   initialGoalPlaceholder — optional placeholder copy.
export default function SetupConversation({
  onCreate,
  onSwitchToManual,
  preferredPattern = null,
  initialGoal = "",
  initialGoalPlaceholder = null,
}) {
  const [step, setStep] = useState("goal");
  const [goal, setGoal] = useState(initialGoal);
  const [errorReason, setErrorReason] = useState(null);

  // Result of /api/setup/suggest, with user's answers tracked alongside.
  const [suggestion, setSuggestion] = useState(null);
  const [answers, setAnswers] = useState({}); // { [questionId]: { value, skipped } }
  const [questionIdx, setQuestionIdx] = useState(0);
  const [currentDraft, setCurrentDraft] = useState("");

  // Summary-step editable fields. Seeded from suggestion + answers.
  const [name, setName] = useState("");
  const [workingFolder, setWorkingFolder] = useState("");
  const [folderValidated, setFolderValidated] = useState(false);
  const folderTouchedRef = useRef(false);
  const goalTextareaRef = useRef(null);

  useEffect(() => {
    if (step === "goal") {
      goalTextareaRef.current?.focus();
    }
  }, [step]);

  // When the summary step opens, prefill the working folder using the
  // home-relative default. Same scheme as NewProjectForm so naive users land
  // on the same suggested path either way.
  useEffect(() => {
    if (step !== "summary") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/fs/home");
        const data = await res.json();
        if (cancelled || !data?.home) return;
        if (folderTouchedRef.current) return;
        const candidate = defaultWorkingFolder({
          name: name || suggestion?.name || "project",
          home: data.home,
        });
        setWorkingFolder(candidate);
        kickValidate(candidate);
      } catch {
        /* leave empty if /api/fs/home unreachable */
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Re-roll default folder when name changes — only if user hasn't touched it.
  useEffect(() => {
    if (folderTouchedRef.current) return;
    if (!workingFolder) return;
    const m = workingFolder.match(/^(.*\/agent-studio\/)([^/]*)\/?$/);
    if (!m) return;
    const next = `${m[1]}${slugifyProjectName(name || suggestion?.name || "project")}/`;
    if (next !== workingFolder) {
      setWorkingFolder(next);
      kickValidate(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  function kickValidate(value) {
    setFolderValidated(false);
    if (!value) return;
    if (!looksAbsolutePath(value)) return;
    if (!PERMITTED_PATH_PREFIXES.some((p) => value.startsWith(p))) return;
    const captured = value;
    setTimeout(async () => {
      try {
        const res = await fetch("/api/fs/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: captured, create: true }),
        });
        const data = await res.json();
        if (data && data.ok && data.exists && data.isDirectory && data.writable) {
          setFolderValidated(true);
        } else {
          setFolderValidated(false);
        }
      } catch {
        setFolderValidated(false);
      }
    }, 350);
  }

  function handleWorkingFolderChange(value) {
    folderTouchedRef.current = true;
    setWorkingFolder(value);
    kickValidate(value);
  }

  // ── Step A: goal entry ──────────────────────────────────────────────────
  async function handleStart() {
    const trimmed = goal.trim();
    if (!trimmed) return;
    setStep("loading");
    setErrorReason(null);

    try {
      const res = await fetch("/api/setup/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal: trimmed,
          preferredPattern: preferredPattern || undefined,
        }),
      });
      const body = await res.json();
      if (!body || body.ok !== true) {
        setErrorReason(body?.reason || "could not reach the local model");
        setStep("error");
        return;
      }
      setSuggestion(body);
      setName(body.name || "");
      setAnswers({});
      setQuestionIdx(0);
      setCurrentDraft("");
      // If the model returned zero questions (defensive — shouldn't happen
      // because the route enforces ≥1), skip straight to summary.
      if (Array.isArray(body.questions) && body.questions.length > 0) {
        setStep("chat");
      } else {
        setStep("summary");
      }
    } catch (err) {
      setErrorReason(err?.message || "network error");
      setStep("error");
    }
  }

  // ── Step C: question chat ───────────────────────────────────────────────
  function handleAnswer({ skip = false } = {}) {
    if (!suggestion) return;
    const q = suggestion.questions[questionIdx];
    if (!q) return;
    const value = skip ? "" : currentDraft.trim();
    if (!skip && !value) return;

    const nextAnswers = {
      ...answers,
      [q.id]: { value, skipped: !!skip, prompt: q.prompt, type: q.type },
    };
    setAnswers(nextAnswers);
    setCurrentDraft("");

    const nextIdx = questionIdx + 1;
    if (nextIdx >= suggestion.questions.length) {
      setStep("summary");
    } else {
      setQuestionIdx(nextIdx);
    }
  }

  // Heuristic field routing. We accept any model id but bias toward known
  // conventions (context/background/prior_decisions vs outcome/done/success).
  // Anything that doesn't match either bucket gets appended to context with
  // its prompt as a header so it's not lost.
  const summaryFields = useMemo(() => {
    if (!suggestion) return { context: "", outcome: "" };
    const contextChunks = [];
    const outcomeChunks = [];
    for (const q of suggestion.questions) {
      const a = answers[q.id];
      if (!a || a.skipped || !a.value) continue;
      const id = (q.id || "").toLowerCase();
      const isOutcome = /outcome|done|success|finish|complete/.test(id);
      const isContext = /context|background|prior|decision|constraint|history/.test(id);
      if (isOutcome) {
        outcomeChunks.push(a.value);
      } else if (isContext) {
        contextChunks.push(a.value);
      } else {
        // Unknown field: keep it under context with its prompt as a header.
        contextChunks.push(`${q.prompt}\n${a.value}`);
      }
    }
    return {
      context: contextChunks.join("\n\n"),
      outcome: outcomeChunks.join("\n\n"),
    };
  }, [suggestion, answers]);

  // ── Step D: summary submit ──────────────────────────────────────────────
  const folderLooksValid =
    looksAbsolutePath(workingFolder) &&
    PERMITTED_PATH_PREFIXES.some((p) => workingFolder.startsWith(p));

  const submitBlockedReason = (() => {
    if (!name.trim()) return "name required";
    if (!workingFolder) return "working folder required";
    if (!folderLooksValid) return "working folder must be under /Users, /tmp, or /var/folders";
    if (!folderValidated) return "validating working folder…";
    return null;
  })();

  function handleCreate() {
    if (submitBlockedReason || !suggestion) return;
    const patternMeta = PATTERNS.find((p) => p.id === suggestion.pattern);
    const canvas = patternMeta ? canvasFromPattern(patternMeta) : undefined;
    onCreate?.({
      name: name.trim(),
      workingFolder: workingFolder.trim(),
      goal: goal.trim(),
      context: summaryFields.context,
      outcome: summaryFields.outcome,
      uploads: [],
      canvas,
      seedPatternId: suggestion.pattern,
    });
  }

  function handleBackToChat() {
    if (!suggestion?.questions?.length) {
      setStep("goal");
      return;
    }
    // Step back into the last question so the user can revise an answer.
    setQuestionIdx(Math.max(0, suggestion.questions.length - 1));
    setStep("chat");
  }

  function handleChangePattern() {
    // Light-touch "change" — bounce back to goal. The user can re-Start with
    // a different preferredPattern via the picker on the landing page, or
    // just re-enter the conversation.
    setStep("goal");
    setSuggestion(null);
  }

  function handleSwitchManual() {
    onSwitchToManual?.({ goal });
  }

  const overrideNote = suggestion?.patternOverridden
    ? `Suggested ${suggestion.pattern.replace(/-/g, " ")} over ${(preferredPattern || "")
        .replace(/-/g, " ")} based on the goal.`
    : null;

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="sc" data-setup-conversation data-step={step}>
      {step === "goal" && (
        <div className="sc-card sc-goal" data-setup-step="goal">
          <h2 className="sc-title" id="sc-goal-title">
            What do you want this agent to do?
          </h2>
          <textarea
            ref={goalTextareaRef}
            className="sc-textarea sc-goal-textarea"
            rows={5}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={
              initialGoalPlaceholder ||
              "Describe the job in your own words. One or two sentences is enough."
            }
            aria-labelledby="sc-goal-title"
            data-setup-goal-input
          />
          <div className="sc-actions">
            <button
              type="button"
              className="sc-btn sc-btn-primary"
              onClick={handleStart}
              disabled={!goal.trim()}
              data-setup-start
            >
              Start
            </button>
          </div>
          <div className="sc-footer">
            <button
              type="button"
              className="sc-link"
              onClick={handleSwitchManual}
              data-setup-switch-manual
            >
              Fill the form myself
            </button>
          </div>
        </div>
      )}

      {step === "loading" && (
        <div className="sc-card sc-loading" data-setup-step="loading">
          <div className="sc-spinner" aria-hidden="true" />
          <p className="sc-muted">Thinking through your goal…</p>
        </div>
      )}

      {step === "error" && (
        <div className="sc-card sc-error" data-setup-step="error">
          <h2 className="sc-title">Couldn&apos;t reach the local model.</h2>
          <p className="sc-muted">
            {errorReason ? `Reason: ${errorReason}.` : null} You can fill the form manually instead.
          </p>
          <div className="sc-actions">
            <button
              type="button"
              className="sc-btn sc-btn-primary"
              onClick={handleSwitchManual}
              data-setup-switch-manual
            >
              Open the manual form
            </button>
            <button
              type="button"
              className="sc-btn"
              onClick={() => {
                setErrorReason(null);
                setStep("goal");
              }}
              data-setup-retry
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {step === "chat" && suggestion && (
        <div className="sc-card sc-chat" data-setup-step="chat">
          <div className="sc-chat-header">
            <span className="sc-eyebrow">Conversation</span>
            <span className="sc-progress" data-setup-progress>
              {questionIdx + 1} of {suggestion.questions.length}
            </span>
          </div>

          {overrideNote && (
            <p className="sc-note" data-setup-override-note>{overrideNote}</p>
          )}

          <div className="sc-bubbles" data-setup-bubbles>
            <div className="sc-bubble sc-bubble-llm" data-setup-bubble="summary">
              <span className="sc-bubble-meta">Setup</span>
              <p className="sc-bubble-text">{suggestion.summary}</p>
            </div>

            {/* Render answered + skipped questions before the active one. */}
            {suggestion.questions.slice(0, questionIdx).map((q, i) => {
              const a = answers[q.id];
              if (!a) return null;
              return (
                <div key={q.id} className="sc-exchange" data-setup-exchange={q.id}>
                  <div className="sc-bubble sc-bubble-llm">
                    <span className="sc-bubble-meta">Setup</span>
                    <p className="sc-bubble-text">{q.prompt}</p>
                  </div>
                  <div
                    className={`sc-bubble sc-bubble-user${a.skipped ? " sc-bubble-skipped" : ""}`}
                  >
                    <span className="sc-bubble-meta">You</span>
                    <p className="sc-bubble-text">
                      {a.skipped ? "(skipped)" : a.value}
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Active question. */}
            {(() => {
              const q = suggestion.questions[questionIdx];
              if (!q) return null;
              return (
                <div className="sc-exchange sc-exchange-active" data-setup-active-question={q.id}>
                  <div className="sc-bubble sc-bubble-llm">
                    <span className="sc-bubble-meta">Setup</span>
                    <p className="sc-bubble-text">{q.prompt}</p>
                  </div>
                  <div className="sc-answer">
                    {q.type === "longtext" ? (
                      <textarea
                        className="sc-textarea sc-answer-input"
                        rows={4}
                        value={currentDraft}
                        onChange={(e) => setCurrentDraft(e.target.value)}
                        placeholder="Your answer…"
                        autoFocus
                        data-setup-answer-input
                      />
                    ) : (
                      <input
                        className="sc-input sc-answer-input"
                        type="text"
                        value={currentDraft}
                        onChange={(e) => setCurrentDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && currentDraft.trim()) {
                            e.preventDefault();
                            handleAnswer();
                          }
                        }}
                        placeholder="Your answer…"
                        autoFocus
                        data-setup-answer-input
                      />
                    )}
                    <div className="sc-actions sc-answer-actions">
                      <button
                        type="button"
                        className="sc-btn sc-btn-primary"
                        onClick={() => handleAnswer()}
                        disabled={!currentDraft.trim()}
                        data-setup-answer-submit
                      >
                        Next
                      </button>
                      {q.optional && (
                        <button
                          type="button"
                          className="sc-link"
                          onClick={() => handleAnswer({ skip: true })}
                          data-setup-answer-skip
                        >
                          Skip
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          <div className="sc-footer">
            <button
              type="button"
              className="sc-link"
              onClick={handleSwitchManual}
              data-setup-switch-manual
            >
              Fill the form myself instead
            </button>
          </div>
        </div>
      )}

      {step === "summary" && suggestion && (
        <div className="sc-card sc-summary" data-setup-step="summary">
          <div className="sc-summary-head">
            <h2 className="sc-title">Ready to create</h2>
            <p className="sc-muted">Edit anything below, then create the project.</p>
          </div>

          <div className="sc-summary-grid">
            <label className="sc-field" data-setup-summary-field="name">
              <span className="sc-label">Name</span>
              <input
                className="sc-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="agent-name"
                data-setup-summary-name
              />
            </label>

            <div className="sc-field" data-setup-summary-field="pattern">
              <span className="sc-label">Pattern</span>
              <div className="sc-pattern-row">
                <span className="sc-pattern-name" data-setup-summary-pattern>
                  {suggestion.pattern}
                </span>
                <button
                  type="button"
                  className="sc-link"
                  onClick={handleChangePattern}
                  data-setup-change-pattern
                >
                  change
                </button>
              </div>
            </div>

            <div className="sc-field" data-setup-summary-field="folder">
              <WorkingFolderInput
                value={workingFolder}
                onChange={handleWorkingFolderChange}
              />
            </div>

            {summaryFields.context && (
              <div className="sc-field" data-setup-summary-field="context">
                <span className="sc-label">Context</span>
                <p className="sc-readonly">{summaryFields.context}</p>
              </div>
            )}

            {summaryFields.outcome && (
              <div className="sc-field" data-setup-summary-field="outcome">
                <span className="sc-label">Outcome</span>
                <p className="sc-readonly">{summaryFields.outcome}</p>
              </div>
            )}

            <div className="sc-field" data-setup-summary-field="goal">
              <span className="sc-label">Goal</span>
              <p className="sc-readonly">{goal}</p>
            </div>
          </div>

          <div className="sc-actions">
            <button
              type="button"
              className="sc-btn sc-btn-primary"
              onClick={handleCreate}
              disabled={!!submitBlockedReason}
              data-setup-create
            >
              Create project
            </button>
            <button
              type="button"
              className="sc-btn"
              onClick={handleBackToChat}
              data-setup-back
            >
              Back
            </button>
            <span className="sc-blocked">{submitBlockedReason || "ready"}</span>
          </div>
        </div>
      )}

      <style jsx>{`
        .sc {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .sc-card {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .sc-title {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          color: var(--ink);
          line-height: 1.3;
        }
        .sc-eyebrow {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .sc-muted {
          margin: 0;
          font-size: 13px;
          color: var(--muted);
          line-height: 1.5;
        }
        .sc-note {
          margin: 0;
          font-size: 12px;
          color: var(--muted);
          padding: 8px 10px;
          background: var(--surface);
          border-left: 2px solid var(--accent);
          border-radius: 4px;
        }
        .sc-textarea,
        .sc-input {
          width: 100%;
          padding: 10px 12px;
          font-family: inherit;
          font-size: 14px;
          color: var(--ink);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          outline: none;
          transition: border-color 100ms ease, box-shadow 100ms ease;
        }
        .sc-textarea {
          resize: vertical;
          line-height: 1.5;
        }
        .sc-textarea:hover,
        .sc-input:hover {
          border-color: var(--border-strong);
        }
        .sc-textarea:focus,
        .sc-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .sc-goal-textarea {
          font-size: 15px;
          min-height: 120px;
        }
        .sc-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .sc-answer-actions {
          margin-top: 4px;
        }
        .sc-btn {
          font-family: inherit;
          font-size: 13px;
          height: 36px;
          padding: 0 16px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink);
          cursor: pointer;
          transition: border-color 100ms ease, color 100ms ease, background 100ms ease;
        }
        .sc-btn:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--accent-strong);
        }
        .sc-btn:disabled {
          color: var(--faint);
          cursor: not-allowed;
        }
        .sc-btn-primary {
          font-weight: 600;
        }
        .sc-btn-primary:not(:disabled) {
          background: var(--accent);
          border-color: var(--accent);
          color: #ffffff;
        }
        .sc-btn-primary:not(:disabled):hover {
          background: var(--accent-strong);
          border-color: var(--accent-strong);
        }
        .sc-btn-primary:disabled {
          background: var(--surface);
          border-color: var(--border);
          color: var(--faint);
        }
        .sc-link {
          background: transparent;
          border: 0;
          font-family: inherit;
          font-size: 12px;
          color: var(--muted);
          cursor: pointer;
          padding: 6px 4px;
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .sc-link:hover {
          color: var(--ink);
        }
        .sc-footer {
          display: flex;
          justify-content: flex-end;
          margin-top: 4px;
        }
        .sc-blocked {
          font-size: 12px;
          color: var(--muted);
        }
        .sc-spinner {
          width: 18px;
          height: 18px;
          border: 2px solid var(--border);
          border-top-color: var(--accent);
          border-radius: 50%;
          animation: sc-spin 700ms linear infinite;
        }
        @keyframes sc-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .sc-loading {
          flex-direction: row;
          align-items: center;
          gap: 12px;
        }
        .sc-chat-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .sc-progress {
          font-size: 11px;
          color: var(--muted);
          font-variant-numeric: tabular-nums;
        }
        .sc-bubbles {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 14px;
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--bg, transparent);
        }
        .sc-exchange {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .sc-exchange-active {
          gap: 10px;
        }
        .sc-bubble {
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 10px 12px;
          border-radius: 8px;
          max-width: 90%;
        }
        .sc-bubble-llm {
          align-self: flex-start;
          background: var(--surface);
          color: var(--ink);
        }
        .sc-bubble-user {
          align-self: flex-end;
          background: var(--accent-soft);
          color: var(--ink);
        }
        .sc-bubble-skipped .sc-bubble-text {
          color: var(--muted);
          font-style: italic;
        }
        .sc-bubble-meta {
          font-size: 10px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .sc-bubble-text {
          margin: 0;
          font-size: 13px;
          line-height: 1.5;
          white-space: pre-wrap;
        }
        .sc-answer {
          align-self: stretch;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .sc-summary-head {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .sc-summary-grid {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .sc-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .sc-label {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .sc-pattern-row {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .sc-pattern-name {
          font-size: 14px;
          color: var(--ink);
          font-weight: 500;
        }
        .sc-readonly {
          margin: 0;
          font-size: 13px;
          color: var(--ink);
          line-height: 1.5;
          padding: 8px 10px;
          background: var(--surface);
          border-radius: 6px;
          white-space: pre-wrap;
        }
      `}</style>
    </div>
  );
}
