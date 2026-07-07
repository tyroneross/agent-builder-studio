"use client";

// Register a local tool by absolute path (POST /api/tools/register).
// On success, the newly-registered tool's ToolCard renders inline so its
// capabilities and permissions are visible before anything is launched
// (acceptance criterion #4) — there is no launch action in v1 to race
// against anyway, but this keeps the "see it before you run it" guarantee
// even once launch support lands.

import { useState } from "react";
import ToolCard from "./ToolCard";

export default function ToolRegisterForm({ onRegistered }) {
  const [path, setPath] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null); // { status: "ok"|"errors"|"error", tool?, errors?, error? }

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = path.trim();
    if (!trimmed) {
      setResult({ status: "error", error: "enter a path first" });
      return;
    }
    if (!trimmed.startsWith("/")) {
      setResult({ status: "error", error: "path must be absolute (start with /)" });
      return;
    }

    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/tools/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: trimmed }),
      });
      const body = await res.json();
      if (body?.ok) {
        setResult({ status: "ok", tool: body.tool });
        onRegistered?.(body.tool);
      } else if (Array.isArray(body?.errors)) {
        setResult({ status: "errors", errors: body.errors });
      } else {
        setResult({ status: "error", error: body?.error || "register failed" });
      }
    } catch (err) {
      setResult({ status: "error", error: err?.message || "could not reach /api/tools/register" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="trf" data-tool-register-form>
      <form className="trf-form" onSubmit={handleSubmit}>
        <label className="trf-label" htmlFor="tool-register-path">
          Directory path (must contain agent-tool.json)
        </label>
        <div className="trf-row">
          <input
            id="tool-register-path"
            className="trf-input"
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Users/you/path/to/my-tool"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            data-tool-register-input
          />
          <button
            type="submit"
            className="trf-submit"
            disabled={submitting || !path.trim()}
            data-tool-register-submit
          >
            {submitting ? "Registering…" : "Register tool"}
          </button>
        </div>
      </form>

      {result?.status === "error" && (
        <p className="trf-error" data-tool-register-error>
          {result.error}
        </p>
      )}

      {result?.status === "errors" && (
        <div className="trf-errors" data-tool-register-errors>
          <span className="trf-errors-title">Manifest failed validation:</span>
          <ul className="trf-error-list">
            {result.errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {result?.status === "ok" && result.tool && (
        <div className="trf-success" data-tool-register-success>
          <p className="trf-success-line">
            Registered <strong>{result.tool.name || result.tool.id}</strong>. Review its
            capabilities and permissions below before running it.
          </p>
          <ToolCard tool={result.tool} />
        </div>
      )}

      <style jsx>{`
        .trf {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .trf-form {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .trf-label {
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .trf-row {
          display: flex;
          gap: 8px;
        }
        .trf-input {
          flex: 1;
          padding: 8px 10px;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          color: var(--ink);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          outline: none;
        }
        .trf-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .trf-submit {
          flex-shrink: 0;
          height: 36px;
          padding: 0 16px;
          border-radius: 8px;
          border: 1px solid var(--accent);
          background: var(--accent);
          color: #ffffff;
          font-size: 13px;
          font-weight: 600;
          font-family: inherit;
          cursor: pointer;
        }
        .trf-submit:disabled {
          border-color: var(--border);
          background: var(--surface);
          color: var(--muted);
          cursor: not-allowed;
        }
        .trf-error {
          margin: 0;
          font-size: 12px;
          color: var(--danger);
        }
        .trf-errors {
          border: 1px solid var(--danger);
          background: var(--danger-soft);
          border-radius: 8px;
          padding: 10px 12px;
        }
        .trf-errors-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--danger);
        }
        .trf-error-list {
          margin: 6px 0 0;
          padding-left: 16px;
          font-size: 12px;
          color: var(--ink);
        }
        .trf-success {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .trf-success-line {
          margin: 0;
          font-size: 12px;
          color: var(--ink);
        }
      `}</style>
    </div>
  );
}
