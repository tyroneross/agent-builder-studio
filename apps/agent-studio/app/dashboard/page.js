"use client";

// Studio tool dashboard (build-loop chunk C6).
//
// Sections, each naming its real data source — nothing here is mock data:
//   - Tools          <- GET /api/tools/list (C5 registry: workspace discovery
//                       + persisted external registrations, one ToolCard
//                       each). This is the only guaranteed section.
//   - Register a tool <- ToolRegisterForm, POSTs /api/tools/register.
//
// Deliberately NOT included in v1 (per the C6 chunk spec's own scoping rule:
// omit rather than mock):
//   - "Project status" / "Agent graph status": the existing project store
//     (app/lib/projects.js) already renders a project dashboard on the
//     landing page ("/"), but its summarization logic lives inline and
//     unexported in app/page.js. Re-deriving it here would either duplicate
//     that logic (drift risk) or require editing page.js, which is out of
//     this chunk's owned files. No API route backs this either
//     (app/api/ has no /spec or /projects route). Omitted rather than faked.
//   - "Recent runs": no run-history API/store was found under app/api/
//     (agent/run* routes execute a run; they don't expose a history list).
//     Omitted rather than faked.
// A future chunk can add these once a real, reusable source exists.

import { useCallback, useEffect, useState } from "react";
import ToolCard from "../components/ToolCard";
import ToolRegisterForm from "../components/ToolRegisterForm";

export default function DashboardPage() {
  const [tools, setTools] = useState(null); // null = loading
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTools = useCallback(async ({ silent = false } = {}) => {
    if (silent) setRefreshing(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/tools/list");
      const body = await res.json();
      if (!body?.ok) {
        setLoadError(body?.error || "failed to load tools");
        setTools([]);
        return;
      }
      setTools(Array.isArray(body.tools) ? body.tools : []);
    } catch (err) {
      setLoadError(err?.message || "could not reach /api/tools/list");
      setTools((prev) => prev ?? []);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  function handleRegistered() {
    fetchTools({ silent: true });
  }

  function handleUnregistered() {
    fetchTools({ silent: true });
  }

  const loading = tools === null;

  return (
    <div className="dash-page" data-dashboard-page>
      <header className="dash-page-head">
        <div>
          <span className="dash-page-eyebrow">Studio</span>
          <h1 className="dash-page-title">Tool dashboard</h1>
          <p className="dash-page-sub">
            Every tool that declares an <code>agent-tool.json</code> manifest, plus any local
            path you register below. Studio reads manifests — it does not run per-tool code.
          </p>
        </div>
        <button
          type="button"
          className="dash-refresh-btn"
          onClick={() => fetchTools({ silent: true })}
          disabled={refreshing}
          data-dashboard-refresh
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <section className="dash-section" data-dashboard-tools>
        <div className="dash-section-head">
          <span className="dash-section-title">Tools</span>
          {tools && <span className="dash-section-count">{tools.length}</span>}
        </div>

        {loading && <p className="dash-muted">Loading tools…</p>}
        {loadError && (
          <p className="dash-error" data-dashboard-error>
            {loadError}
          </p>
        )}
        {!loading && !loadError && tools.length === 0 && (
          <p className="dash-muted">
            No tools discovered yet. Add an <code>apps/&lt;name&gt;/agent-tool.json</code> manifest,
            or register a local path below.
          </p>
        )}
        {!loading && tools.length > 0 && (
          <div className="dash-tool-grid">
            {tools.map((tool) => (
              <ToolCard key={tool.id} tool={tool} onUnregistered={handleUnregistered} />
            ))}
          </div>
        )}
      </section>

      <section className="dash-section" data-dashboard-register>
        <div className="dash-section-head">
          <span className="dash-section-title">Register a tool</span>
        </div>
        <p className="dash-muted">
          Point Studio at any local directory with a valid <code>agent-tool.json</code>. It will
          appear above once registered.
        </p>
        <ToolRegisterForm onRegistered={handleRegistered} />
      </section>

      <style jsx>{`
        .dash-page {
          max-width: 1120px;
          margin: 0 auto;
          padding: 40px 24px 96px;
          display: flex;
          flex-direction: column;
          gap: 28px;
        }
        .dash-page-head {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding-bottom: 24px;
          border-bottom: 1px solid var(--border);
          flex-wrap: wrap;
        }
        .dash-page-eyebrow {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .dash-page-title {
          margin: 2px 0 0;
          font-size: 26px;
          font-weight: 700;
          color: var(--ink);
        }
        .dash-page-sub {
          margin: 6px 0 0;
          font-size: 13px;
          color: var(--muted);
          max-width: 620px;
          line-height: 1.5;
        }
        .dash-page-sub code {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          color: var(--ink);
        }
        .dash-refresh-btn {
          height: 34px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink);
          font-size: 13px;
          font-family: inherit;
          cursor: pointer;
        }
        .dash-refresh-btn:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--accent-strong);
        }
        .dash-refresh-btn:disabled {
          color: var(--faint);
          cursor: not-allowed;
        }
        .dash-section {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .dash-section-head {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }
        .dash-section-title {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .dash-section-count {
          font-size: 12px;
          color: var(--muted);
        }
        .dash-muted {
          margin: 0;
          font-size: 13px;
          color: var(--muted);
        }
        .dash-muted code {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          color: var(--ink);
        }
        .dash-error {
          margin: 0;
          font-size: 13px;
          color: var(--danger);
        }
        .dash-tool-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
          gap: 16px;
        }
      `}</style>
    </div>
  );
}
