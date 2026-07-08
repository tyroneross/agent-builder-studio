"use client";

// Renders a single tool from the Studio tool registry (GET /api/tools/list).
// Everything shown here comes from the tool object returned by the API
// (id/name/manifest/source/valid/errors/status/path) — there is no per-tool
// branching or hardcoded tool id/name anywhere in this file. New tools that
// declare a valid apps/<name>/agent-tool.json (or are registered by external
// path) render automatically with zero changes to this component.
//
// Layout follows Calm Precision: a three-line header (name -> metadata ->
// description), one prominent primary action (Launch/Stop), and progressive
// disclosure — capabilities, I/O, env, and permissions live behind a Details
// toggle so the card stays scannable. Studio launches/stops tool dev commands
// through real API endpoints; the devCommand stays copyable for manual runs.
//
// F2 (Calm Precision, non-negotiable): permissions are declared by the tool
// author in agent-tool.json — Studio does not sandbox, verify, or enforce
// them. The permissions block is always labeled to say so; never rendered as a
// bare "Permissions:" list that could read as a security guarantee.

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

function IoList({ title, items, testId }) {
  return (
    <div className="tc-io" data-tool-card-io={testId}>
      <span className="tc-io-title">{title}</span>
      {Array.isArray(items) && items.length > 0 ? (
        <ul className="tc-io-list">
          {items.map((item, idx) => (
            <li key={`${item?.id ?? "field"}-${idx}`}>
              <code className="tc-code">{item?.id ?? "—"}</code>
              <span className="tc-io-type">{item?.type ?? "—"}</span>
              {item?.required && <span className="tc-req">required</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="tc-muted">None declared.</p>
      )}
    </div>
  );
}

function EnvList({ title, items, required }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="tc-env-group">
      <span className="tc-env-group-title">{title}</span>
      <dl className="tc-env">
        {items.map((item, idx) => (
          <div className="tc-env-row" key={`${item?.name ?? "env"}-${idx}`}>
            <dt>
              <code className="tc-code">{item?.name ?? "—"}</code>
              {required && <span className="tc-req">required</span>}
              {item?.default != null && (
                <span className="tc-env-default">
                  default <code className="tc-code">{String(item.default)}</code>
                </span>
              )}
            </dt>
            {item?.description && <dd>{item.description}</dd>}
          </div>
        ))}
      </dl>
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
  const [launchConfirmation, setLaunchConfirmation] = useState(false);
  const [unregisterError, setUnregisterError] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    setStatus(tool?.status ?? "stopped");
  }, [tool?.status]);

  useEffect(() => {
    setLaunchConfirmation(false);
  }, [tool?.id, tool?.status]);

  if (!tool) return null;

  const manifest = tool.manifest ?? null;
  const entry = manifest?.entry ?? {};
  const env = manifest?.env ?? {};
  const permissions = manifest?.permissions ?? null;
  const isEnforced = permissions?.mode === "enforced";
  const currentStatus = status === "running" ? "running" : "stopped";
  const actionEndpoint = currentStatus === "running" ? "/api/tools/stop" : "/api/tools/launch";
  const actionLabel = currentStatus === "running" ? "Stop" : "Launch";
  const actionBusyLabel = currentStatus === "running" ? "Stopping…" : "Launching…";
  const nextStatus = currentStatus === "running" ? "stopped" : "running";

  const hasEnv = env.required?.length > 0 || env.optional?.length > 0;
  const envCount = (env.required?.length ?? 0) + (env.optional?.length ?? 0);

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
      if (currentStatus !== "running" && res.status === 409 && body?.needsConfirmation) {
        setLaunchConfirmation(true);
        return;
      }
      if (!body?.ok) {
        setLaunchConfirmation(false);
        setActionError(body?.error || `${actionLabel.toLowerCase()} failed`);
        return;
      }
      setLaunchConfirmation(false);
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

  async function handleConfirmLaunch() {
    if (actionBusy || !entry.devCommand) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await fetch("/api/tools/launch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: tool.id, confirm: true }),
      });
      const body = await res.json();
      if (!body?.ok) {
        setActionError(body?.error || "launch failed");
        return;
      }
      setLaunchConfirmation(false);
      setStatus("running");
      try {
        await refreshStatus();
      } catch (err) {
        setActionError(err?.message || "status refresh failed");
      }
    } catch (err) {
      setActionError(err?.message || "launch failed");
    } finally {
      setActionBusy(false);
    }
  }

  function handleCancelLaunchConfirmation() {
    if (actionBusy) return;
    setLaunchConfirmation(false);
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
        <h3 className="tc-name">{tool.name || tool.id}</h3>
        <StatusDot status={currentStatus} />
      </header>

      <div className="tc-meta" data-tool-card-meta>
        <code className="tc-id">{tool.id}</code>
        <span className="tc-dot" aria-hidden="true">·</span>
        <span className={`tc-source tc-source-${tool.source}`}>{tool.source}</span>
        {typeof entry.port === "number" && (
          <>
            <span className="tc-dot" aria-hidden="true">·</span>
            <span>port {entry.port}</span>
          </>
        )}
        {isEnforced && (
          <>
            <span className="tc-dot" aria-hidden="true">·</span>
            <span className="tc-enforced-label" title="Enforced: launch command restricted to allowed binaries" data-tool-card-enforced>
              enforced
            </span>
          </>
        )}
      </div>

      {!tool.valid ? (
        <div className="tc-errors" data-tool-card-errors>
          <span className="tc-errors-title">Manifest is invalid — not usable until fixed.</span>
          <ul className="tc-list">
            {(tool.errors ?? []).map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
          <p className="tc-muted tc-path">{tool.path}</p>
        </div>
      ) : (
        <>
          {manifest?.description && <p className="tc-desc">{manifest.description}</p>}

          <code className="tc-cmd" data-tool-card-dev-command title={entry.devCommand || undefined}>
            {entry.devCommand || "no dev command declared"}
          </code>

          <div className="tc-actions">
            <button
              type="button"
              className={`tc-action-primary ${currentStatus === "running" ? "tc-action-stop" : ""}`}
              onClick={handleToolAction}
              disabled={actionBusy || !entry.devCommand || (currentStatus !== "running" && launchConfirmation)}
              data-tool-card-launch-stop
              data-tool-card-action={currentStatus === "running" ? "stop" : "launch"}
            >
              {actionBusy ? actionBusyLabel : actionLabel}
            </button>
            <CopyButton text={entry.devCommand} />
            {manifest && (
              <button
                type="button"
                className="tc-details-toggle"
                onClick={() => setShowDetails((v) => !v)}
                aria-expanded={showDetails}
                data-tool-card-details-toggle
              >
                Details
                <span className={`tc-chevron ${showDetails ? "tc-chevron-open" : ""}`} aria-hidden="true">
                  ▾
                </span>
              </button>
            )}
          </div>

          {launchConfirmation && currentStatus !== "running" && (
            <div className="tc-confirm" data-tool-card-launch-confirmation>
              <p className="tc-confirm-text">
                This will run <code className="tc-code tc-confirm-command">{entry.devCommand}</code>
                {tool.source === "git" ? " — untrusted cloned code." : "."} Launch it?
              </p>
              <div className="tc-confirm-actions">
                <button
                  type="button"
                  className="tc-action-primary"
                  onClick={handleConfirmLaunch}
                  disabled={actionBusy}
                  data-tool-card-confirm-launch
                >
                  {actionBusy ? "Launching…" : "Confirm launch"}
                </button>
                <button
                  type="button"
                  className="tc-text-action"
                  onClick={handleCancelLaunchConfirmation}
                  disabled={actionBusy}
                  data-tool-card-cancel-launch
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {actionError && <p className="tc-inline-error">{actionError}</p>}

          {showDetails && manifest && (
            <div className="tc-details" data-tool-card-details>
              <section className="tc-section">
                <span className="tc-section-title">Capabilities</span>
                <Pills items={manifest.capabilities} />
              </section>

              <section className="tc-section tc-io-grid">
                <IoList title="Inputs" items={manifest.inputs} testId="inputs" />
                <IoList title="Outputs" items={manifest.outputs} testId="outputs" />
              </section>

              {hasEnv && (
                <section className="tc-section">
                  <span className="tc-section-title">
                    Environment
                    <span className="tc-count">{envCount}</span>
                  </span>
                  <EnvList title="Required" items={env.required} required />
                  <EnvList title="Optional" items={env.optional} />
                </section>
              )}

              <section className="tc-section" data-tool-card-permissions>
                <span className="tc-section-title">Permissions</span>
                <p className="tc-permissions-label">Declared by the tool — not enforced by Studio.</p>
                <div className="tc-perm-group">
                  <span className="tc-perm-sub">Filesystem</span>
                  <StringList items={permissions?.filesystem} />
                </div>
                <div className="tc-perm-group">
                  <span className="tc-perm-sub">Network</span>
                  <StringList items={permissions?.network} />
                </div>
              </section>
            </div>
          )}
        </>
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
            {busy ? "removing…" : "Remove registration"}
          </button>
          {unregisterError && <span className="tc-inline-error">{unregisterError}</span>}
        </footer>
      )}

      <style jsx global>{`
        .tc {
          border: 1px solid var(--border);
          border-radius: 12px;
          background: var(--surface);
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .tc-invalid {
          border-color: var(--danger);
        }
        .tc-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
        }
        .tc-name {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--ink);
          line-height: 1.2;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .tc-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          font-size: 12px;
          color: var(--muted);
          margin-top: -2px;
        }
        .tc-id {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          color: var(--muted);
        }
        .tc-dot {
          color: var(--faint);
        }
        .tc-source-external {
          color: var(--tool);
        }
        .tc-status {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 12px;
          color: var(--muted);
          flex-shrink: 0;
        }
        .tc-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--faint);
        }
        .tc-status-running {
          color: var(--eval);
        }
        .tc-status-running .tc-status-dot {
          background: var(--eval);
        }
        .tc-enforced-label {
          color: var(--accent-strong);
          font-weight: 600;
        }
        .tc-desc {
          margin: 0;
          font-size: 13px;
          line-height: 1.45;
          color: var(--ink);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .tc-cmd {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          color: var(--ink);
          display: block;
          overflow-x: auto;
          white-space: nowrap;
          padding: 7px 10px;
          border-radius: 7px;
          background: var(--surface-muted);
          border: 1px solid var(--border);
        }
        .tc-code {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          color: var(--ink);
        }
        .tc-actions {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .tc-action-primary {
          flex-shrink: 0;
          min-height: 34px;
          padding: 0 16px;
          border-radius: 7px;
          border: 1px solid var(--accent);
          background: var(--accent);
          color: #ffffff;
          font-size: 13px;
          font-family: inherit;
          font-weight: 600;
          cursor: pointer;
          transition: background 120ms ease;
        }
        .tc-action-primary:hover:not(:disabled) {
          background: var(--accent-strong);
        }
        .tc-action-primary:disabled {
          border-color: var(--border);
          background: var(--surface-muted);
          color: var(--faint);
          cursor: not-allowed;
        }
        .tc-action-stop {
          border-color: var(--danger);
          background: var(--surface);
          color: var(--danger);
        }
        .tc-action-stop:hover:not(:disabled) {
          background: var(--danger-soft);
        }
        .tc-copy-btn {
          flex-shrink: 0;
          min-height: 34px;
          box-sizing: border-box;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 0 12px;
          border-radius: 7px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink);
          font-size: 13px;
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
        .tc-details-toggle {
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          min-height: 34px;
          padding: 0 4px;
          background: none;
          border: none;
          font-size: 13px;
          font-family: inherit;
          color: var(--muted);
          cursor: pointer;
        }
        .tc-details-toggle:hover {
          color: var(--ink);
        }
        .tc-chevron {
          font-size: 10px;
          transition: transform 150ms ease;
        }
        .tc-chevron-open {
          transform: rotate(180deg);
        }
        .tc-confirm {
          padding: 10px 12px;
          border-radius: 8px;
          background: var(--surface-muted);
          border: 1px solid var(--border);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .tc-confirm-text {
          margin: 0;
          font-size: 12px;
          line-height: 1.45;
          color: var(--ink);
        }
        .tc-confirm-command {
          overflow-wrap: anywhere;
        }
        .tc-confirm-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .tc-details {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding-top: 14px;
          margin-top: 2px;
          border-top: 1px solid var(--border);
        }
        .tc-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .tc-section-title {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted);
          font-weight: 600;
        }
        .tc-count {
          font-size: 11px;
          letter-spacing: 0;
          color: var(--muted);
          background: var(--surface-muted);
          border-radius: 999px;
          padding: 1px 7px;
          font-weight: 500;
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
          gap: 16px;
        }
        .tc-io {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        .tc-io-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--ink);
        }
        .tc-io-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .tc-io-list li {
          display: flex;
          align-items: baseline;
          gap: 8px;
          font-size: 12px;
        }
        .tc-io-type {
          color: var(--muted);
          font-size: 11px;
        }
        .tc-req {
          font-size: 10px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: var(--accent-strong);
          font-weight: 600;
        }
        .tc-env-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .tc-env-group-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--ink);
        }
        .tc-env {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .tc-env-row {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .tc-env-row dt {
          display: flex;
          align-items: baseline;
          flex-wrap: wrap;
          gap: 8px;
        }
        .tc-env-default {
          font-size: 11px;
          color: var(--muted);
        }
        .tc-env-row dd {
          margin: 0;
          font-size: 12px;
          line-height: 1.45;
          color: var(--muted);
        }
        .tc-permissions-label {
          margin: 0;
          font-size: 12px;
          color: var(--policy);
        }
        .tc-perm-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .tc-perm-sub {
          font-size: 12px;
          font-weight: 600;
          color: var(--ink);
        }
        .tc-list {
          margin: 0;
          padding-left: 16px;
          font-size: 12px;
          line-height: 1.45;
          color: var(--muted);
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .tc-muted {
          margin: 0;
          font-size: 12px;
          color: var(--muted);
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
          word-break: break-all;
        }
        .tc-footer {
          display: flex;
          align-items: center;
          gap: 10px;
          padding-top: 10px;
          margin-top: 2px;
          border-top: 1px solid var(--border);
        }
        .tc-text-action {
          background: none;
          border: none;
          padding: 0;
          font-size: 13px;
          cursor: pointer;
          color: var(--accent-strong);
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
          margin: 0;
          font-size: 12px;
          color: var(--danger);
        }
        @media (max-width: 640px) {
          .tc-action-primary,
          .tc-copy-btn,
          .tc-details-toggle {
            min-height: 44px;
          }
          .tc-io-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </article>
  );
}
