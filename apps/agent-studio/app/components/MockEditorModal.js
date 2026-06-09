"use client";

// Pass 15 — Mock output editor.
//
// Tiny modal for setting `node.mockOutput`. JSON-only payload (matches the
// runtime's `format:"json"` Ollama call), with a textarea + parse-on-change
// validation. "Clear" wipes the mock; saving with empty input is treated as
// a clear.
//
// `mockOutput` is studio-only per the docs/SPEC.md bucket table — never
// written to the spec or to agent.md. The runtime substitutes the value
// before any LLM call when it's set.

import { useEffect, useState } from "react";

export default function MockEditorModal({ open, node, onClose, onSave, onClear }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !node) return;
    if (node.mockOutput == null) {
      setText("");
    } else {
      try {
        setText(JSON.stringify(node.mockOutput, null, 2));
      } catch {
        setText(String(node.mockOutput));
      }
    }
    setError("");
  }, [open, node]);

  if (!open || !node) return null;

  function handleSave() {
    const trimmed = text.trim();
    if (!trimmed) {
      onClear?.(node.id);
      onClose?.();
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      onSave?.(node.id, parsed);
      onClose?.();
    } catch (err) {
      setError(`Invalid JSON: ${err.message || "parse failed"}`);
    }
  }

  return (
    <div className="mock-modal-backdrop" role="dialog" aria-modal="true" aria-label="Set mock">
      <div className="mock-modal">
        <header className="mock-header">
          <div>
            <div className="studio-eyebrow">Set mock</div>
            <h2 className="mock-title">{node.title || node.id}</h2>
          </div>
          <button type="button" className="tool-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="mock-body">
          <p className="mock-hint">
            When set, the runtime emits this JSON instead of calling the model for this node.
            Useful for testing downstream nodes without burning tokens. Mocks are studio-only —
            never written to the exported spec.
          </p>
          <textarea
            className="mock-text"
            rows={10}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError("");
            }}
            placeholder='{ "result": "your mock payload here" }'
            data-mock-editor-textarea
          />
          {error && <div className="mock-error">{error}</div>}
        </div>
        <footer className="mock-footer">
          <button type="button" className="tool-btn" onClick={onClose}>
            Cancel
          </button>
          {node.mockOutput != null && (
            <button
              type="button"
              className="tool-btn"
              onClick={() => {
                onClear?.(node.id);
                onClose?.();
              }}
            >
              Clear mock
            </button>
          )}
          <button
            type="button"
            className="tool-btn solo-run-go"
            onClick={handleSave}
            data-mock-editor-save
          >
            Save mock
          </button>
        </footer>
      </div>
      <style jsx>{`
        .mock-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(31, 37, 32, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
          padding: 24px;
        }
        .mock-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          width: min(560px, 100%);
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-lift);
          overflow: hidden;
        }
        .mock-header {
          padding: 16px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border);
        }
        .mock-title {
          margin: 4px 0 0 0;
          font-size: 16px;
          font-weight: 600;
        }
        .mock-body {
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .mock-hint {
          margin: 0;
          font-size: 12px;
          color: var(--muted);
        }
        .mock-text {
          width: 100%;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          padding: 8px 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--surface-muted);
          color: var(--ink);
          line-height: 1.4;
        }
        .mock-error {
          font-size: 12px;
          color: var(--danger);
          background: var(--danger-soft);
          padding: 6px 10px;
          border-radius: 6px;
        }
        .mock-footer {
          padding: 12px 20px;
          border-top: 1px solid var(--border);
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
      `}</style>
    </div>
  );
}
