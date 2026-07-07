"use client";

// Renders a single tool from the Studio tool registry (GET /api/tools/list).
// Everything shown here comes from the tool object returned by the API
// (id/name/manifest/source/valid/errors/status/path) — there is no per-tool
// branching or hardcoded tool id/name anywhere in this file. New tools that
// declare a valid apps/<name>/agent-tool.json (or are registered by external
// path) render automatically with zero changes to this component.
//
// Studio can launch and stop tool dev commands through real API endpoints.
// The manifest's devCommand remains copyable for users who prefer to run a
// tool manually.
//
// F2 (Calm Precision, non-negotiable): permissions are declared by the tool
// author in agent-tool.json — Studio does not sandbox, verify, or enforce
// them. The permissions section is always labeled to say so; never rendered
// as a bare "Permissions:" list that could read as a security guarantee.

import { useEffect, useState } from "react";

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!text) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("clipboard API unavailable");
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Best-effort only — clipboard access can be blocked (permissions,
      // insecure context, older browser). Fail silently; the command text
      // is still selectable/copyable by hand.
    }
  }

  return (
    <button
      type="button"
      className="tc-copy-btn"
      onClick={handleCopy}
      disabled={!text}
      data-tool-card-copy
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function StatusDot({ status }) {
  const known = status === "running" || status === "stopped";
  return (
    <span
      className={`tc-status tc-status-${known ? status : "unknown"}`}
      data-tool-card-status={status}
      title={known ? `Tool is ${status}` : "Status unknown"}
    >
      <span className="tc-status-dot" aria-hidden="true" />
      {known ? status : "unknown"}
    </span>
  );
}

function Pills({ items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <p className="tc-muted">None declared.</p>;
  }
  return (
    <div className="tc-pills" data-tool-card-capabilities>
      {items.map((item) => (
        <span key={item} className="tc-pill">
          {item}
        </span>
      ))}
    </div>
  );
}

function IoTable({ title, items, testId }) {
  if (!Array.isArray(items) || items.length === 0) {
    return (
      <div className="tc-io">
        <span className="tc-io-title">{title}</span>
        <p className="tc-muted">None declared.</p>
      </div>
    );
  }
  return (
    <div className="tc-io" data-tool-card-io={testId}>
      <span className="tc-io-title">{title}</span>
      <table className="tc-table">
        <thead>
          <tr>
            <th>id</th>
            <th>type</th>
            <th>required</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={`${item?.id ?? "field"}-${idx}`}>
              <td>{item?.id ?? "—"}</td>
              <td>{item?.type ?? "—"}</td>
              <td>{item?.required ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EnvTable({ title, items }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="tc-io">
      <span className="tc-io-title">{title}</span>
      <table className="tc-table">
        <thead>
          <tr>
            <th>name</th>
            <th>default</th>
            <th>description</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, idx) => (
            <tr key={`${item?.name ?? "env"}-${idx}`}>
              <td className="tc-code">{item?.name ?? "—"}</td>
              <td className="tc-code">{item?.default ?? "—"}</td>
              <td>{item?.description ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StringList({ items }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <p className="tc-muted">None declared.</p>;
  }
  return (
    <ul className="tc-list">
      {items.map((item, idx) => (
        <li key={`${item}-${idx}`}>{item}</li>
      ))}
    </ul>
  );
}

export default function ToolCard({ tool, onUnregistered }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(tool?.status ?? "stopped");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [unregisterError, setUnregisterError] = useState(null);

  useEffect(() => {
    setStatus(tool?.status ?? "stopped");
  }, [tool?.status]);

  if (!tool) return null;

  const manifest = tool.manifest ?? null;
  const entry = manifest?.entry ?? {};
  const env = manifest?.env ?? {};
  const permissions = manifest?.permissions ?? null;
  const currentStatus = status === "running" ? "running" : "stopped";
  const actionEndpoint = currentStatus === "running" ? "/api/tools/stop" : "/api/tools/launch";
  const actionLabel = currentStatus === "running" ? "Stop" : "Launch";
  const actionBusyLabel = currentStatus === "running" ? "Stopping..." : "Launching...";
  const nextStatus = currentStatus === "running" ? "stopped" : "running";

  async function refreshStatus() {
    const res = await fetch("/api/tools/list", { cache: "no-store" });
    const body = await res.json();
    if (!body?.ok) {
      throw new Error(body?.error || "status refresh failed");
    }
    const latest = Array.isArray(body.tools) ? body.tools.find((item) => item.id === tool.id) : null;
    if (latest?.status) setStatus(latest.status);
  }

  async function handleToolAction() {
    if (actionBusy || !entry.devCommand) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await fetch(actionEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: tool.id }),
      });
      const body = await res.json();
      if (!body?.ok) {
        setActionError(body?.error || `${actionLabel.toLowerCase()} failed`);
        return;
      }
      setStatus(nextStatus);
      try {
        await refreshStatus();
      } catch (err) {
        setActionError(err?.message || "status refresh failed");
      }
    } catch (err) {
      setActionError(err?.message || `${actionLabel.toLowerCase()} failed`);
    } finally {
      setActionBusy(false);
    }
  }

  async function handleUnregister() {
    if (busy || actionBusy) return;
    setBusy(true);
    setUnregisterError(null);
    try {
      const res = await fetch("/api/tools/unregister", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: tool.id }),
      });
      const body = await res.json();
      if (!body?.ok) {
        setUnregisterError(body?.error || "unregister failed");
        setBusy(false);
        return;
      }
      onUnregistered?.(tool.id);
    } catch (err) {
      setUnregisterError(err?.message || "unregister failed");
      setBusy(false);
    }
  }

  return (
    <article
      className={`tc ${tool.valid ? "" : "tc-invalid"}`}
      data-tool-card
      data-tool-id={tool.id}
      data-tool-source={tool.source}
      data-tool-valid={tool.valid ? "true" : "false"}
    >
      <header className="tc-head">
        <div className="tc-head-main">
          <h3 className="tc-name">{tool.name || tool.id}</h3>
          <span className="tc-id">{tool.id}</span>
        </div>
        <div className="tc-head-meta">
          <span className={`tc-badge tc-badge-${tool.source}`}>{tool.source}</span>
          <StatusDot status={currentStatus} />
        </div>
      </header>

      {!tool.valid && (
        <div className="tc-errors" data-tool-card-errors>
          <span className="tc-errors-title">Manifest is invalid — not usable until fixed.</span>
          <ul className="tc-list">
            {(tool.errors ?? []).map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
          <p className="tc-muted tc-path">{tool.path}</p>
        </div>
      )}

      {tool.valid && manifest && (
        <div className="tc-body">
          {manifest.description && <p className="tc-desc">{manifest.description}</p>}

          <section className="tc-section">
            <span className="tc-section-title">Dev command</span>
            <p className="tc-note">
              Studio can launch this command. Copy it if you prefer to run the tool manually.
            </p>
            <div className="tc-cmd-row">
              <code className="tc-code tc-cmd" data-tool-card-dev-command>
                {entry.devCommand || "no dev command declared"}
              </code>
              <CopyButton text={entry.devCommand} />
              <button
                type="button"
                className={`tc-tool-action ${
                  currentStatus === "running" ? "tc-tool-action-stop" : "tc-tool-action-launch"
                }`}
                onClick={handleToolAction}
                disabled={actionBusy || !entry.devCommand}
                data-tool-card-launch-stop
                data-tool-card-action={currentStatus === "running" ? "stop" : "launch"}
              >
                {actionBusy ? actionBusyLabel : actionLabel}
              </button>
            </div>
            {actionError && <span className="tc-inline-error">{actionError}</span>}
            <div className="tc-meta-row">
              {typeof entry.port === "number" && <span>port {entry.port}</span>}
              {entry.healthPath && <span>health {entry.healthPath}</span>}
              {entry.workspace && <span className="tc-code">{entry.workspace}</span>}
            </div>
          </section>

          <section className="tc-section">
            <span className="tc-section-title">Capabilities</span>
            <Pills items={manifest.capabilities} />
          </section>

          <section className="tc-section tc-io-grid">
            <IoTable title="Inputs" items={manifest.inputs} testId="inputs" />
            <IoTable title="Outputs" items={manifest.outputs} testId="outputs" />
          </section>

          {(env.required?.length > 0 || env.optional?.length > 0) && (
            <section className="tc-section">
              <span className="tc-section-title">Environment variables</span>
              <EnvTable title="Required" items={env.required} />
              <EnvTable title="Optional" items={env.optional} />
            </section>
          )}

          <section className="tc-section tc-permissions" data-tool-card-permissions>
            <span className="tc-section-title">Permissions</span>
            <p className="tc-permissions-label">
              Declared by the tool — not enforced by Studio.
            </p>
            <div className="tc-permissions-grid">
              <div>
                <span className="tc-permissions-sub">Filesystem</span>
                <StringList items={permissions?.filesystem} />
              </div>
              <div>
                <span className="tc-permissions-sub">Network</span>
                <StringList items={permissions?.network} />
              </div>
            </div>
          </section>
        </div>
      )}

      {tool.source === "external" && (
        <footer className="tc-footer">
          <button
            type="button"
            className="tc-text-action tc-danger"
            onClick={handleUnregister}
            disabled={busy || actionBusy}
            data-tool-card-unregister
          >
            {busy ? "removing…" : "remove registration"}
          </button>
          {unregisterError && <span className="tc-inline-error">{unregisterError}</span>}
        </footer>
      )}

      <style jsx>{`
        .tc {
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--surface);
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .tc-invalid {
          border-color: var(--danger);
        }
        .tc-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .tc-head-main {
          display: flex;
          flex-direction: column;
          gap: 2px;
          min-width: 0;
        }
        .tc-name {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
          color: var(--ink);
        }
        .tc-id {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 11px;
          color: var(--muted);
        }
        .tc-head-meta {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .tc-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid var(--border);
          color: var(--muted);
        }
        .tc-badge-workspace {
          border-color: var(--accent);
          color: var(--accent-strong);
        }
        .tc-badge-external {
          border-color: var(--tool);
          color: var(--tool);
        }
        .tc-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: var(--muted);
        }
        .tc-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--faint);
        }
        .tc-status-running .tc-status-dot {
          background: var(--eval);
        }
        .tc-status-stopped .tc-status-dot {
          background: var(--faint);
        }
        .tc-status-unknown .tc-status-dot {
          background: var(--faint);
        }
        .tc-errors {
          border: 1px solid var(--danger);
          background: var(--danger-soft);
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .tc-errors-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--danger);
        }
        .tc-path {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
        }
        .tc-body {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .tc-desc {
          margin: 0;
          font-size: 13px;
          color: var(--ink);
        }
        .tc-section {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .tc-section-title {
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .tc-note {
          margin: 0;
          font-size: 11px;
          color: var(--muted);
          line-height: 1.4;
        }
        .tc-cmd-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .tc-cmd {
          flex: 1;
          min-width: 220px;
          overflow-x: auto;
          white-space: nowrap;
          padding: 6px 10px;
          border-radius: 6px;
          background: var(--surface-muted);
          border: 1px solid var(--border);
        }
        .tc-code {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          color: var(--ink);
        }
        .tc-copy-btn {
          flex-shrink: 0;
          height: 28px;
          padding: 0 10px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink);
          font-size: 12px;
          font-family: inherit;
          cursor: pointer;
        }
        .tc-copy-btn:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--accent-strong);
        }
        .tc-copy-btn:disabled {
          color: var(--faint);
          cursor: not-allowed;
        }
        .tc-tool-action {
          flex-shrink: 0;
          min-height: 32px;
          padding: 0 12px;
          border-radius: 6px;
          border: 1px solid var(--accent);
          background: var(--accent-soft);
          color: var(--accent-strong);
          font-size: 12px;
          font-family: inherit;
          font-weight: 600;
          cursor: pointer;
        }
        .tc-tool-action:hover:not(:disabled) {
          border-color: var(--accent-strong);
        }
        .tc-tool-action:disabled {
          border-color: var(--border);
          color: var(--faint);
          cursor: not-allowed;
        }
        .tc-tool-action-stop {
          border-color: var(--danger);
          background: var(--danger-soft);
          color: var(--danger);
        }
        .tc-meta-row {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          font-size: 11px;
          color: var(--muted);
        }
        .tc-pills {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .tc-pill {
          font-size: 11px;
          padding: 3px 9px;
          border-radius: 999px;
          background: var(--accent-soft);
          color: var(--accent-strong);
        }
        .tc-io-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .tc-io {
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        .tc-io-title {
          font-size: 11px;
          font-weight: 600;
          color: var(--ink);
        }
        .tc-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
        }
        .tc-table th,
        .tc-table td {
          text-align: left;
          padding: 4px 6px;
          border-bottom: 1px solid var(--border);
          vertical-align: top;
        }
        .tc-muted {
          margin: 0;
          font-size: 12px;
          color: var(--muted);
        }
        .tc-list {
          margin: 0;
          padding-left: 16px;
          font-size: 12px;
          color: var(--ink);
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .tc-permissions {
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 10px 12px;
          background: var(--surface-muted);
        }
        .tc-permissions-label {
          margin: 0;
          font-size: 12px;
          font-weight: 600;
          color: var(--policy);
        }
        .tc-permissions-grid {
          margin-top: 8px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }
        .tc-permissions-sub {
          display: block;
          font-size: 11px;
          font-weight: 600;
          color: var(--muted);
          margin-bottom: 4px;
        }
        .tc-footer {
          display: flex;
          align-items: center;
          gap: 10px;
          padding-top: 4px;
          border-top: 1px solid var(--border);
        }
        .tc-text-action {
          background: none;
          border: none;
          padding: 0;
          font-size: 12px;
          cursor: pointer;
          color: var(--accent);
          font-family: inherit;
        }
        .tc-text-action:hover:not(:disabled) {
          text-decoration: underline;
        }
        .tc-text-action:disabled {
          color: var(--faint);
          cursor: not-allowed;
        }
        .tc-danger {
          color: var(--danger);
        }
        .tc-inline-error {
          font-size: 11px;
          color: var(--danger);
        }
        @media (max-width: 640px) {
          .tc-cmd {
            min-width: 100%;
          }
          .tc-copy-btn,
          .tc-tool-action {
            min-height: 40px;
          }
          .tc-io-grid,
          .tc-permissions-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </article>
  );
}
