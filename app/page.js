"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ProjectsList from "./components/ProjectsList";
import NewProjectForm from "./components/NewProjectForm";
import {
  emptyStore,
  getActiveProject,
  loadStore,
  makeProject,
  withProjectUpdated,
  writeStore,
} from "./lib/projects";

// Landing page. Shows existing projects and gates new-project creation behind
// a single-screen form. Submitting routes to /canvas with the new project active.
//
// Storage flow:
//   - On mount: load v3 (with v2/v1 migration) into a top-level `store`. If
//     the store exists but has no projects, render the empty state. If load()
//     returned null (truly fresh install), seed an empty store and persist.
//   - All mutations go through writeStore() so the canvas page sees the same
//     bytes when we router.push("/canvas").
export default function Landing() {
  const router = useRouter();
  const [store, setStore] = useState(null);
  const [showForm, setShowForm] = useState(false);

  // Hydrate from localStorage on mount. We accept null (no store) and an
  // empty-projects store as legitimate states; both flow into the empty list.
  useEffect(() => {
    const loaded = loadStore();
    if (loaded) {
      setStore(loaded);
    } else {
      const fresh = emptyStore();
      setStore(fresh);
      writeStore(fresh);
    }
  }, []);

  const activeProject = useMemo(() => (store ? getActiveProject(store) : null), [store]);

  function persist(next) {
    setStore(next);
    writeStore(next);
  }

  function handleOpen(projectId) {
    if (!store) return;
    const next = { ...store, activeProjectId: projectId };
    persist(next);
    router.push("/canvas");
  }

  function handleRename(projectId, name) {
    if (!store) return;
    const next = withProjectUpdated(store, projectId, (p) => ({ ...p, name }));
    persist(next);
  }

  function handleDelete(projectId) {
    if (!store) return;
    const remaining = store.projects.filter((p) => p.id !== projectId);
    const wasActive = store.activeProjectId === projectId;
    const next = {
      ...store,
      projects: remaining,
      activeProjectId: wasActive ? (remaining[0]?.id ?? null) : store.activeProjectId,
    };
    persist(next);
  }

  function handleCreate({ name, workingFolder, goal, context, outcome, uploads }) {
    const project = makeProject({ name, workingFolder, goal, context, outcome, uploads });
    const next = store
      ? { ...store, projects: [...store.projects, project], activeProjectId: project.id }
      : { ...emptyStore(), projects: [project], activeProjectId: project.id };
    persist(next);
    router.push("/canvas");
  }

  // Initial render before hydration. Brief flash; we skip showing nonsense
  // empty/full states by waiting for the store to mount.
  if (!store) {
    return (
      <div className="land-loading" data-landing-loading>
        Loading…
        <style jsx>{`
          .land-loading {
            padding: 48px;
            color: var(--muted);
            font-size: 14px;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="land">
      <header className="land-hero">
        <div className="land-hero-text">
          <span className="land-eyebrow">Agent Studio</span>
          <h1 className="land-title">Visual canvas for agent design and testing.</h1>
          <p className="land-sub">
            Sketch the agent graph, attach context files, and iterate on a project at a time.
          </p>
        </div>
        <button
          type="button"
          className="tool-btn land-cta"
          onClick={() => setShowForm((v) => !v)}
          data-landing-new-project
        >
          {showForm ? "close" : "+ new project"}
        </button>
      </header>

      <main className="land-main">
        {showForm && (
          <section className="land-card" data-landing-form>
            <div className="land-card-header">
              <span className="land-eyebrow">New project</span>
              <p className="land-card-sub">
                Pick a working folder under <code>/Users</code>, <code>/tmp</code>, or
                <code> /var/folders</code>. Files dropped below upload immediately into
                <code> &lt;workingFolder&gt;/uploads/</code>.
              </p>
            </div>
            <NewProjectForm
              onCreate={handleCreate}
              onCancel={() => setShowForm(false)}
            />
          </section>
        )}

        <section className="land-card">
          <div className="land-card-header">
            <span className="land-eyebrow">
              Projects {store.projects.length > 0 && `(${store.projects.length})`}
            </span>
            {activeProject && (
              <span className="land-card-sub">
                Active: <strong>{activeProject.name}</strong>
              </span>
            )}
          </div>
          <ProjectsList
            projects={store.projects}
            activeProjectId={store.activeProjectId}
            onOpen={handleOpen}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        </section>
      </main>

      <style jsx>{`
        .land {
          max-width: 920px;
          margin: 0 auto;
          padding: 48px 24px 96px;
          min-height: 100vh;
        }
        .land-hero {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 24px;
          padding-bottom: 32px;
          border-bottom: 1px solid var(--border);
          margin-bottom: 32px;
          flex-wrap: wrap;
        }
        .land-hero-text {
          display: flex;
          flex-direction: column;
          gap: 6px;
          max-width: 620px;
        }
        .land-eyebrow {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .land-title {
          font-size: 28px;
          font-weight: 700;
          color: var(--ink);
          margin: 0;
          line-height: 1.2;
        }
        .land-sub {
          font-size: 15px;
          color: var(--muted);
          margin: 4px 0 0;
        }
        .land-cta {
          height: 36px;
          font-weight: 600;
          background: var(--accent-soft);
          border-color: var(--accent);
          color: var(--accent-strong);
        }
        .land-main {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .land-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 22px 22px 24px;
        }
        .land-card-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .land-card-sub {
          font-size: 12px;
          color: var(--muted);
          margin: 0;
          line-height: 1.5;
        }
        .land-card-sub code {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 11px;
          color: var(--ink);
        }
        .tool-btn {
          height: 32px;
          padding: 0 14px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface);
          font-size: 13px;
          color: var(--ink);
          cursor: pointer;
          font-family: inherit;
        }
        .tool-btn:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--accent-strong);
        }
        .tool-btn:disabled {
          color: var(--faint);
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
}
