"use client";

// Pass 15 — Run Inspector panel.
//
// Shows the most recent transcript record for a single node:
//   - System prompt sent
//   - User message sent
//   - Raw text response
//   - Parsed JSON output
//   - Duration
//   - Bytes
//   - Mocked badge if the node was bypassed via mockOutput
//   - "Replay this node" button → opens the SoloRunModal seeded with the
//     same inputs (handled by the parent via onReplay).
//
// The panel reads from a `transcript` prop that the canvas page captures on
// the most recent `complete` event from /api/agent/run. Pages without a
// transcript render an empty-state message.
//
// Bodies are truncated at DEFAULT_INSPECTOR_CONFIG.inlineBodyMaxChars and a
// "show full" toggle expands them. Truncation is render-only — the original
// body is preserved in the transcript object the parent retains.

import { useState } from "react";
import { DEFAULT_INSPECTOR_CONFIG } from "../lib/inspector-config.mjs";

function CollapsibleBody({ label, body }) {
  const [expanded, setExpanded] = useState(false);
  if (!body) {
    return (
      <section className="inspector-body">
        <div className="inspector-body-label">{label}</div>
        <div className="inspector-empty">(none)</div>
      </section>
    );
  }
  const cap = DEFAULT_INSPECTOR_CONFIG.inlineBodyMaxChars;
  const isLong = body.length > cap;
  const shown = !isLong || expanded ? body : `${body.slice(0, cap)}\n…`;
  return (
    <section className="inspector-body">
      <div className="inspector-body-label">
        {label}
        <span className="inspector-meta">{body.length.toLocaleString()} chars</span>
      </div>
      <pre className="inspector-pre">{shown}</pre>
      {isLong && (
        <button
          type="button"
          className="text-action"
          onClick={() => setExpanded((x) => !x)}
        >
          {expanded ? "show less" : "show full"}
        </button>
      )}
    </section>
  );
}

export default function InspectorPanel({ open, onClose, node, record, onReplay }) {
  if (!open) return null;
  if (!node) return null;

  const empty = !record;

  const parsedText = record?.parsed != null ? JSON.stringify(record.parsed, null, 2) : "";

  return (
    <aside
      className="inspector-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Run inspector"
      data-inspector-panel
    >
      <div className="inspector-backdrop" onClick={onClose} />
      <div className="inspector-sheet">
        <header className="inspector-header">
          <div>
            <div className="inspector-eyebrow">Run inspector</div>
            <h2 className="inspector-title">
              {node.title || node.id}
              {record?.mocked && (
                <span className="inspector-badge" data-inspector-mocked>
                  mocked
                </span>
              )}
            </h2>
          </div>
          <button
            type="button"
            className="tool-btn"
            onClick={onClose}
            aria-label="Close inspector"
          >
            ×
          </button>
        </header>

        <div className="inspector-stats">
          {record ? (
            <>
              <span>
                Role: <code>{node.role}</code>
              </span>
              <span>
                Duration: <code>{record.durationMs ?? 0} ms</code>
              </span>
              <span>
                Bytes: <code>{(record.bytes ?? 0).toLocaleString()}</code>
              </span>
              {record.error && (
                <span className="inspector-error">Error: {record.error}</span>
              )}
            </>
          ) : (
            <span className="inspector-empty">
              No recorded run for this node yet. Run the chain or solo-run this node first.
            </span>
          )}
        </div>

        {!empty && (
          <div className="inspector-body-stack">
            {record.subagent ? (
              <>
                {/* Pass 18 — subagent drill-down. Sub-agent nodes don't
                    have system+user prompts of their own (they delegate);
                    instead we show the resolved ref + a per-child-node
                    summary pulled from the nested transcript. */}
                <section className="inspector-body">
                  <div className="inspector-body-label">
                    Sub-agent reference
                    <span className="inspector-meta">{record.subagent.ref || "(missing)"}</span>
                  </div>
                  {record.subagent.transcript ? (
                    <div className="inspector-subagent-list" data-inspector-subagent-list>
                      {(record.subagent.transcript.nodes ?? []).map((sn) => (
                        <div key={sn.id} className="inspector-subagent-row">
                          <span className="inspector-subagent-title">{sn.title || sn.id}</span>
                          <span className="inspector-subagent-meta">
                            {sn.role} · {sn.durationMs ?? 0} ms · {(sn.bytes ?? 0).toLocaleString()} b
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="inspector-empty">No nested transcript captured.</div>
                  )}
                </section>
                {record.subagent.transcript && (
                  <CollapsibleBody
                    label="Nested transcript (JSON)"
                    body={JSON.stringify(record.subagent.transcript, null, 2)}
                  />
                )}
                {parsedText && <CollapsibleBody label="Parent-visible parsed payload" body={parsedText} />}
              </>
            ) : (
              <>
                <CollapsibleBody label="System prompt" body={record.systemPrompt} />
                <CollapsibleBody label="User message" body={record.userMessage} />
                <CollapsibleBody label="Raw response" body={record.output} />
                {parsedText && <CollapsibleBody label="Parsed JSON" body={parsedText} />}
              </>
            )}
          </div>
        )}

        <footer className="inspector-footer">
          <button type="button" className="tool-btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="tool-btn"
            onClick={() => onReplay?.(node.id)}
            disabled={!record}
            title={record ? "Re-run this node with the same inputs" : "Run the chain first"}
          >
            Replay this node
          </button>
        </footer>
      </div>

      <style jsx>{`
        .inspector-panel {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: flex;
          justify-content: flex-end;
        }
        .inspector-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(31, 37, 32, 0.4);
        }
        .inspector-sheet {
          position: relative;
          width: min(560px, 100%);
          height: 100%;
          background: var(--surface);
          border-left: 1px solid var(--border);
          box-shadow: var(--shadow-lift);
          display: flex;
          flex-direction: column;
          overflow-y: auto;
        }
        .inspector-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border);
        }
        .inspector-eyebrow {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .inspector-title {
          margin: 4px 0 0 0;
          font-size: 16px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .inspector-badge {
          font-size: 10px;
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--accent-soft);
          color: var(--accent-strong);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .inspector-stats {
          display: flex;
          flex-wrap: wrap;
          gap: 14px;
          padding: 12px 20px;
          border-bottom: 1px solid var(--border);
          font-size: 12px;
          color: var(--muted);
        }
        .inspector-stats code {
          color: var(--ink);
        }
        .inspector-error {
          color: var(--danger);
        }
        .inspector-empty {
          color: var(--muted);
          font-style: italic;
        }
        .inspector-body-stack {
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .inspector-body {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .inspector-body-label {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
          display: flex;
          justify-content: space-between;
        }
        .inspector-meta {
          font-size: 10px;
          color: var(--muted);
          font-weight: 400;
          letter-spacing: 0;
        }
        .inspector-subagent-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 8px 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          background: var(--surface-muted);
        }
        .inspector-subagent-row {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
        }
        .inspector-subagent-title {
          color: var(--ink);
          font-weight: 500;
        }
        .inspector-subagent-meta {
          color: var(--muted);
        }
        .inspector-pre {
          margin: 0;
          padding: 10px 12px;
          border: 1px solid var(--border);
          background: var(--surface-muted);
          border-radius: 6px;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          line-height: 1.5;
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 320px;
          overflow: auto;
        }
        .text-action {
          background: none;
          border: none;
          color: var(--accent);
          padding: 0;
          font-size: 12px;
          cursor: pointer;
          text-align: left;
        }
        .text-action:hover {
          text-decoration: underline;
        }
        .inspector-footer {
          margin-top: auto;
          padding: 12px 20px;
          border-top: 1px solid var(--border);
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
      `}</style>
    </aside>
  );
}
