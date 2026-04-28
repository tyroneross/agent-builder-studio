"use client";

import { useState } from "react";
import WorkingFolderInput from "./WorkingFolderInput";
import UploadZone from "./UploadZone";
import { PERMITTED_PATH_PREFIXES, looksAbsolutePath } from "../lib/projects";

// Inline new-project form. Submits a fully-formed project payload via onCreate.
//
// Fields (per Pass 5 spec):
//   - name (required)
//   - workingFolder (required, gated by /api/fs/validate)
//   - goal (warn-if-empty, allow proceed)
//   - context (optional)
//   - outcome (optional)
//   - uploads (optional; uploaded as the user adds them, recorded onto the project at submit)
//
// Working-folder validation is duplicated here from WorkingFolderInput because
// the form needs to gate Submit on the same check. WorkingFolderInput exposes
// no callback for "is valid?", so we re-run a lightweight client-side check
// (looksAbsolutePath + permitted prefix) and rely on the server's authoritative
// answer when the user actually uploads a file. A later refactor could have
// WorkingFolderInput report status upward; for now keep it self-contained.
export default function NewProjectForm({ onCreate, onCancel }) {
  const [name, setName] = useState("");
  const [workingFolder, setWorkingFolder] = useState("");
  const [folderValidated, setFolderValidated] = useState(false);
  const [goal, setGoal] = useState("");
  const [context, setContext] = useState("");
  const [outcome, setOutcome] = useState("");
  const [uploads, setUploads] = useState([]);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Whether the working folder *might* be valid. We surface this for the
  // submit gate even before the server round-trips, so the user gets fast
  // feedback. WorkingFolderInput's own server check handles the authoritative
  // verdict.
  const folderLooksValid =
    looksAbsolutePath(workingFolder) &&
    PERMITTED_PATH_PREFIXES.some((prefix) => workingFolder.startsWith(prefix));

  // Gate submit on:
  //   - non-empty name
  //   - working folder that the server has marked writable+isDirectory.
  // We track that via folderValidated, set by an effect that mirrors what
  // WorkingFolderInput would report. To avoid a duplicate fetch, we listen to
  // each working-folder change and POST the validate endpoint ourselves.
  // Trade-off: two parallel validators, which is fine for this scale and
  // simpler than refactoring WorkingFolderInput's API.
  // (See effect below.)

  // Submit-disabled reason — used for the helper text under the button so the
  // user knows why it's not enabled.
  const submitBlockedReason = (() => {
    if (!name.trim()) return "name required";
    if (!workingFolder) return "working folder required";
    if (!folderLooksValid) return "working folder must be under /Users, /tmp, or /var/folders";
    if (!folderValidated) return "validating working folder…";
    return null;
  })();

  function handleWorkingFolderChange(value) {
    setWorkingFolder(value);
    setFolderValidated(false);
    if (!value) return;
    if (!looksAbsolutePath(value)) return;
    if (!PERMITTED_PATH_PREFIXES.some((prefix) => value.startsWith(prefix))) return;
    // Fire-and-forget validate; debounce by capturing the current value at
    // resolve time and discarding stale responses.
    const captured = value;
    setTimeout(async () => {
      try {
        const res = await fetch("/api/fs/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: captured }),
        });
        const data = await res.json();
        if (captured !== workingFolder && captured !== value) return; // stale
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

  function handleUploaded(record) {
    setUploads((arr) => [...arr, record]);
  }
  function handleUploadRemoved(savedPath) {
    setUploads((arr) => arr.filter((u) => u.savedPath !== savedPath));
  }

  function onSubmit(e) {
    e.preventDefault();
    setSubmitAttempted(true);
    if (submitBlockedReason) return;
    onCreate({
      name: name.trim(),
      workingFolder: workingFolder.trim(),
      goal: goal.trim(),
      context: context.trim(),
      outcome: outcome.trim(),
      uploads,
    });
  }

  const goalWarn = submitAttempted && !goal.trim();

  return (
    <form className="np-form" onSubmit={onSubmit} data-new-project-form>
      <div className="np-grid">
        <label className="np-field">
          <span className="np-label">Name</span>
          <input
            className="np-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My agent"
            data-new-project-name
            required
          />
        </label>

        <div className="np-field">
          <WorkingFolderInput
            value={workingFolder}
            onChange={handleWorkingFolderChange}
          />
        </div>

        <label className="np-field">
          <span className="np-label">
            Goal {goalWarn && <span className="np-warn">— consider adding one</span>}
          </span>
          <textarea
            className="np-input np-textarea"
            rows={3}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="One or two sentences describing what this agent is for."
            data-new-project-goal
          />
        </label>

        <label className="np-field">
          <span className="np-label">Context</span>
          <textarea
            className="np-input np-textarea np-textarea-tall"
            rows={6}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Background information, prior decisions, links, or constraints."
            data-new-project-context
          />
        </label>

        <label className="np-field">
          <span className="np-label">Desired outcome</span>
          <textarea
            className="np-input np-textarea"
            rows={3}
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            placeholder="What does success look like? How will you know this agent worked?"
            data-new-project-outcome
          />
        </label>

        <div className="np-field">
          <UploadZone
            workingFolder={folderValidated ? workingFolder : ""}
            uploads={uploads}
            onUploaded={handleUploaded}
            onRemoved={handleUploadRemoved}
            disabled={!folderValidated}
          />
        </div>
      </div>

      <div className="np-actions">
        <button
          type="submit"
          className="tool-btn np-submit"
          disabled={!!submitBlockedReason}
          data-new-project-submit
        >
          create project
        </button>
        {onCancel && (
          <button type="button" className="tool-btn" onClick={onCancel} data-new-project-cancel>
            cancel
          </button>
        )}
        <span className="np-blocked">{submitBlockedReason || "ready"}</span>
      </div>

      <style jsx>{`
        .np-form {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .np-grid {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .np-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .np-label {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .np-warn {
          color: var(--policy);
          text-transform: none;
          letter-spacing: 0;
          font-size: 11px;
        }
        .np-input {
          width: 100%;
          padding: 8px 10px;
          font-family: inherit;
          font-size: 13px;
          color: var(--ink);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          outline: none;
          transition: border-color 100ms ease, box-shadow 100ms ease;
        }
        .np-input:hover {
          border-color: var(--border-strong);
        }
        .np-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .np-textarea {
          resize: vertical;
          min-height: 64px;
          line-height: 1.4;
          font-family: inherit;
        }
        .np-textarea-tall {
          min-height: 120px;
        }
        .np-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .np-submit {
          font-weight: 600;
        }
        .np-submit:not(:disabled) {
          background: var(--accent-soft);
          border-color: var(--accent);
          color: var(--accent-strong);
        }
        .np-blocked {
          font-size: 12px;
          color: var(--muted);
        }
      `}</style>
    </form>
  );
}
