"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import NewProjectForm from "./components/NewProjectForm";
import SetupConversation from "./components/SetupConversation";
import HowItWorks from "./components/HowItWorks";
import PatternPicker from "./components/PatternPicker";
import OnboardingWizard, { ONBOARDING_FLAG_KEY } from "./components/OnboardingWizard";
import {
  emptyStore,
  getActiveProject,
  loadStore,
  makeProject,
  makeDemoProject,
  findDemoProject,
  DEMO_PROJECT_NAME,
  DEMO_PROJECT_WORKING_FOLDER,
  withProjectUpdated,
  writeStore,
} from "./lib/projects";

// Landing page. Shows existing projects and gates new-project creation behind
// a single-screen form. Submitting routes to /canvas with the new project active.
//
// Pass 8 additions:
//   - When zero projects exist, show a hero + "How it works" + two CTAs.
//   - "Try the demo project" creates a canonical seeded project (or opens
//     it if one already exists) and routes to /canvas.
//   - Inline Ollama health check pings /api/agent/models and reports state.
export default function Landing() {
  const router = useRouter();
  const [store, setStore] = useState(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState(null);

  // Pass 9: onboarding wizard + pattern picker.
  // - showWizard: whether the modal is currently visible. Triggered on first
  //   visit (no localStorage flag) when the user has no projects, or when the
  //   user clicks the "Show onboarding" link.
  // - seedPattern: the pattern selected from either the wizard or the
  //   landing-page picker. Passed into NewProjectForm so it pre-fills name +
  //   carries the canvas through to project creation.
  const [showWizard, setShowWizard] = useState(false);
  const [seedPattern, setSeedPattern] = useState(null);

  // Pass 12: conversational setup is the default new-project path.
  //   - newProjectMode: "conversation" (default) | "manual"
  //   - newProjectActive: whether the user has chosen to start a new project.
  //     For empty state we just render SetupConversation inline. For the
  //     hasProjects=true header CTA, we toggle this on/off.
  // The seven-field NewProjectForm is gated behind manual mode (escape hatch).
  // `goalCarry` carries the typed goal across mode toggles so the user
  // doesn't have to retype if they bounce between conversation and form.
  const [newProjectMode, setNewProjectMode] = useState("conversation");
  const [newProjectActive, setNewProjectActive] = useState(false);
  const [goalCarry, setGoalCarry] = useState("");
  const [goalPlaceholder, setGoalPlaceholder] = useState(null);

  // Pass 8: Ollama prereq state. "unknown" while loading, "ok" if >=1 model,
  // "warn" if reachable but empty, "err" if unreachable. The empty state on
  // the landing page renders a compact pill driven by this.
  const [prereq, setPrereq] = useState({ status: "unknown", detail: null });

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

  // Pass 9: first-run onboarding gate. We open the wizard only when both
  // (a) the user has no projects and (b) they haven't completed onboarding.
  // The flag is per-browser (localStorage), not per-project. The wizard uses
  // the same store-loaded effect timing as the rest of the page so it doesn't
  // flash before hydration.
  useEffect(() => {
    if (!store) return;
    if (store.projects.length > 0) return;
    if (typeof window === "undefined") return;
    let done = false;
    try {
      done = window.localStorage.getItem(ONBOARDING_FLAG_KEY) === "1";
    } catch {
      done = false;
    }
    if (!done) setShowWizard(true);
  }, [store]);

  function persistOnboardingComplete() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(ONBOARDING_FLAG_KEY, "1");
    } catch {}
  }

  function handleWizardClose() {
    persistOnboardingComplete();
    setShowWizard(false);
  }

  function handleWizardComplete() {
    persistOnboardingComplete();
    setShowWizard(false);
  }

  // Pass 12: pattern click no longer opens the manual form. Instead it
  // biases the SetupConversation by setting `seedPattern` (used as
  // preferredPattern) and pre-fills a placeholder hint for the goal box.
  function handlePickPattern(pattern) {
    setSeedPattern(pattern);
    setNewProjectMode("conversation");
    setGoalPlaceholder(`e.g. ${pattern.shortDescription}`);
    setNewProjectActive(true);
    // Defer scroll to next tick so the section is mounted.
    if (typeof window !== "undefined") {
      setTimeout(() => {
        const el = document.querySelector("[data-landing-new-section]");
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 0);
    }
  }

  function handleWizardBlank() {
    // "Create a blank project" from the wizard now lands on the conversation
    // with no preferred pattern. The user can still escape to the form.
    setSeedPattern(null);
    setNewProjectMode("conversation");
    setGoalPlaceholder(null);
    setNewProjectActive(true);
  }

  function handleWizardExplore() {
    setSeedPattern(null);
    setNewProjectActive(false);
  }

  function handleReopenWizard() {
    setSeedPattern(null);
    setShowWizard(true);
  }

  function handleSwitchToManual({ goal } = {}) {
    if (typeof goal === "string") setGoalCarry(goal);
    setNewProjectMode("manual");
  }

  function handleSwitchToConversation({ goal } = {}) {
    if (typeof goal === "string") setGoalCarry(goal);
    setNewProjectMode("conversation");
  }

  function handleCloseNewProject() {
    setNewProjectActive(false);
    setSeedPattern(null);
    setGoalPlaceholder(null);
    setGoalCarry("");
    // Reset to conversation as the default for next time.
    setNewProjectMode("conversation");
  }

  // Health check: only when no projects exist. We don't need to spam the
  // model endpoint on every visit — once the user has projects they'll see
  // model state inside the canvas test panel.
  useEffect(() => {
    if (!store) return;
    if (store.projects.length > 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/agent/models");
        const body = await res.json();
        if (cancelled) return;
        if (body?.ok && Array.isArray(body.models) && body.models.length > 0) {
          setPrereq({ status: "ok", detail: `${body.models.length} model${body.models.length === 1 ? "" : "s"} available` });
        } else if (body?.ok && Array.isArray(body.models)) {
          setPrereq({ status: "warn", detail: "ollama is reachable but no models are pulled" });
        } else {
          setPrereq({ status: "err", detail: body?.error || "ollama did not respond" });
        }
      } catch (err) {
        if (cancelled) return;
        setPrereq({ status: "err", detail: err?.message || "ollama unreachable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store]);

  const activeProject = useMemo(() => (store ? getActiveProject(store) : null), [store]);
  const dashboard = useMemo(() => (store ? summarizeDashboard(store.projects) : null), [store]);

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

  function handleCreate({ name, workingFolder, goal, context, outcome, uploads, canvas, instructionDraftMode }) {
    // Pass 9: when canvas is supplied (from the seed-pattern flow), forward
    // it so makeProject uses the pattern's nodes/edges instead of the default
    // Solo Tool Agent seed.
    const project = makeProject({
      name,
      workingFolder,
      goal,
      context,
      outcome,
      uploads,
      canvas,
      instructionDraftMode,
    });
    const next = store
      ? { ...store, projects: [...store.projects, project], activeProjectId: project.id }
      : { ...emptyStore(), projects: [project], activeProjectId: project.id };
    persist(next);
    setSeedPattern(null);
    setNewProjectActive(false);
    setNewProjectMode("conversation");
    setGoalCarry("");
    setGoalPlaceholder(null);
    router.push("/canvas");
  }

  // Pass 8: idempotent demo flow.
  //   1. If a project named DEMO_PROJECT_NAME exists, switch to it and go.
  //   2. Otherwise: ensure /tmp/agent-studio-demo/ exists via /api/fs/validate
  //      with create:true, build the seeded project, persist, navigate.
  // Errors don't block — we still create the project locally and let the
  // canvas surface working-folder warnings later. We do show the message
  // inline so the user knows.
  async function handleTryDemo() {
    if (!store) return;
    if (demoBusy) return;
    setDemoBusy(true);
    setDemoError(null);

    const existing = findDemoProject(store);
    if (existing) {
      const next = { ...store, activeProjectId: existing.id };
      persist(next);
      // Mark the existing project's onboarded flag so we don't re-prompt
      // someone who has already seen the welcome modal for the demo.
      router.push("/canvas");
      return;
    }

    // Best-effort mkdir. The /tmp/agent-studio-demo path is permitted by the
    // validator's allowlist. We don't fail if it errors — the canvas will
    // show the working-folder warning the same way it does for any project.
    try {
      const res = await fetch("/api/fs/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: DEMO_PROJECT_WORKING_FOLDER, create: true }),
      });
      const body = await res.json();
      if (!body?.ok) {
        setDemoError(body?.error || "could not prepare working folder");
      }
    } catch (err) {
      setDemoError(err?.message || "could not reach /api/fs/validate");
    }

    const project = makeDemoProject();
    const next = {
      ...store,
      projects: [...store.projects, project],
      activeProjectId: project.id,
    };
    persist(next);
    setDemoBusy(false);
    router.push("/canvas");
  }

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

  const hasProjects = store.projects.length > 0;

  return (
    <div className={`land ${hasProjects ? "land-dashboard-mode" : ""}`}>
      <OnboardingWizard
        open={showWizard}
        onComplete={handleWizardComplete}
        onClose={handleWizardClose}
        onPickPattern={handlePickPattern}
        onPickBlank={handleWizardBlank}
        onExplore={handleWizardExplore}
      />
      <header className="land-hero">
        <div className="land-hero-text">
          <span className="land-eyebrow">Agent Studio</span>
          <h1 className="land-title">
            {hasProjects
              ? "Agent dashboard"
              : "Design and test agents on your local machine. No cloud, no waiting."}
          </h1>
          <p className="land-sub">
            {hasProjects
              ? "See what is in flight, what has been built, and which agents need the next test."
              : "Sketch the agent graph, attach context files, and iterate on a project at a time."}
          </p>
        </div>
        {hasProjects && (
          <div className="land-actions">
            {activeProject && (
              <button
                type="button"
                className="tool-btn"
                onClick={() => handleOpen(activeProject.id)}
                data-landing-open-active
              >
                open active
              </button>
            )}
            <button
              type="button"
              className="tool-btn land-cta"
              onClick={() => {
                if (newProjectActive) {
                  handleCloseNewProject();
                } else {
                  setNewProjectActive(true);
                  setNewProjectMode("conversation");
                }
              }}
              data-landing-new-project
            >
              {newProjectActive ? "close" : "+ new project"}
            </button>
          </div>
        )}
      </header>

      <main className="land-main">
        {hasProjects && dashboard && (
          <Dashboard
            summary={dashboard}
            activeProjectId={store.activeProjectId}
            onOpen={handleOpen}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        )}

        {!hasProjects && (
          <section className="land-card" data-landing-empty>
            <HowItWorks />

            <div className="land-cta-row" data-landing-cta-row>
              <button
                type="button"
                className="cta cta-primary"
                onClick={handleTryDemo}
                disabled={demoBusy}
                data-landing-try-demo
              >
                {demoBusy ? "Preparing demo…" : "Try the demo project"}
              </button>
            </div>

            <div
              className={`prereq prereq-${prereq.status}`}
              data-landing-prereq
              data-prereq-status={prereq.status}
            >
              <span className="prereq-dot" aria-hidden="true" />
              <span className="prereq-label">
                {prereq.status === "unknown" && "Checking Ollama…"}
                {prereq.status === "ok" && `Ollama ready · ${prereq.detail}`}
                {prereq.status === "warn" && (
                  <>
                    Ollama is reachable but no models are pulled. See{" "}
                    <a href="/README.md#troubleshooting" target="_blank" rel="noreferrer">
                      troubleshooting
                    </a>
                    .
                  </>
                )}
                {prereq.status === "err" && (
                  <>
                    Ollama not reachable ({prereq.detail}). See{" "}
                    <a href="/README.md#troubleshooting" target="_blank" rel="noreferrer">
                      troubleshooting
                    </a>
                    .
                  </>
                )}
              </span>
            </div>

            {demoError && (
              <p className="land-card-sub" data-landing-demo-error>
                Working folder note: {demoError}
              </p>
            )}
          </section>
        )}

        {/* Pass 12: pattern picker stays visible above the conversational
            entry. Clicking a card biases the conversation's preferredPattern
            and pre-fills a placeholder. */}
        {(!hasProjects || newProjectActive) && (
          <section className="land-card" data-landing-pattern-section>
            <div className="land-card-header">
              <span className="land-eyebrow">Start from a pattern</span>
              <p className="land-card-sub">
                Optional. Pick a canonical agent shape to bias the suggestion.
              </p>
            </div>
            <PatternPicker onSelect={handlePickPattern} />
          </section>
        )}

        {/* Pass 12: conversational setup is the default new-project entry.
            Always shown for empty state; toggled by the header CTA when the
            user has projects. The seven-field form is behind a manual escape
            hatch. */}
        {(!hasProjects || newProjectActive) && (
          <section
            className="land-card"
            data-landing-new-section
            data-new-project-mode={newProjectMode}
          >
            <div className="land-card-header">
              <span className="land-eyebrow">New project</span>
              {seedPattern && (
                <span className="land-card-sub" data-landing-seed-pattern>
                  Pattern hint: <strong>{seedPattern.name}</strong>
                </span>
              )}
            </div>
            {newProjectMode === "conversation" ? (
              <SetupConversation
                onCreate={handleCreate}
                onSwitchToManual={handleSwitchToManual}
                preferredPattern={seedPattern?.id || null}
                initialGoal={goalCarry}
                initialGoalPlaceholder={goalPlaceholder}
              />
            ) : (
              <NewProjectForm
                onCreate={handleCreate}
                onCancel={handleCloseNewProject}
                onSwitchToConversation={handleSwitchToConversation}
                seedPattern={seedPattern}
                initialGoal={goalCarry}
              />
            )}
          </section>
        )}

        <div className="land-footer" data-landing-footer>
          <button
            type="button"
            className="land-footer-link"
            onClick={handleReopenWizard}
            data-landing-show-onboarding
          >
            Show onboarding
          </button>
        </div>
      </main>

      <style jsx>{`
        .land {
          max-width: 920px;
          margin: 0 auto;
          padding: 48px 24px 96px;
          min-height: 100vh;
        }
        .land-dashboard-mode {
          max-width: 1120px;
          padding-top: 32px;
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
        .land-actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          justify-content: flex-end;
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
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .land-card-header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
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
        .land-cta-row {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
        }
        .cta {
          font-family: inherit;
          cursor: pointer;
          border-radius: 10px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink);
          font-size: 14px;
          padding: 0 16px;
          height: 40px;
          transition: border-color 100ms ease, color 100ms ease, background 100ms ease;
        }
        .cta:disabled {
          color: var(--faint);
          cursor: not-allowed;
        }
        .cta-primary {
          flex: 1 1 280px;
          height: 44px;
          font-weight: 600;
          background: var(--accent);
          border-color: var(--accent);
          color: #ffffff;
        }
        .cta-primary:hover:not(:disabled) {
          background: var(--accent-strong);
          border-color: var(--accent-strong);
        }
        .cta-primary:disabled {
          background: var(--accent-soft);
          border-color: var(--border);
          color: var(--accent-strong);
        }
        .cta-secondary {
          flex: 0 0 auto;
        }
        .cta-secondary:hover:not(:disabled) {
          border-color: var(--accent);
          color: var(--accent-strong);
        }
        .prereq {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--muted);
        }
        .prereq-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--faint);
          display: inline-block;
        }
        .prereq-ok .prereq-dot {
          background: var(--eval);
        }
        .prereq-ok .prereq-label {
          color: var(--ink);
        }
        .prereq-warn .prereq-dot {
          background: var(--tool);
        }
        .prereq-warn .prereq-label {
          color: var(--ink);
        }
        .prereq-err .prereq-dot {
          background: var(--danger);
        }
        .prereq-err .prereq-label {
          color: var(--danger);
        }
        .prereq a {
          color: inherit;
          text-decoration: underline;
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
        .land-footer {
          display: flex;
          justify-content: flex-end;
          margin-top: 8px;
        }
        .land-footer-link {
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
        .land-footer-link:hover {
          color: var(--ink);
        }
      `}</style>
    </div>
  );
}

function Dashboard({ summary, activeProjectId, onOpen, onRename, onDelete }) {
  function renameProject(project) {
    if (typeof window === "undefined") return;
    const next = window.prompt("Rename project:", project.name);
    if (!next || !next.trim()) return;
    onRename(project.id, next.trim());
  }

  function deleteProject(project) {
    if (typeof window === "undefined") return;
    if (!window.confirm(`Delete project "${project.name}"? This cannot be undone.`)) return;
    onDelete(project.id);
  }

  const activeProject = summary.projects.find((p) => p.id === activeProjectId) ?? summary.projects[0] ?? null;
  const inFlight = summary.projects.filter((p) => p.status !== "completed");
  const built = summary.projects.filter((p) => p.status === "completed");
  const needsTest = inFlight.filter((p) => p.runCount === 0);

  return (
    <section className="dashboard" data-landing-dashboard>
      <div className="dash-top">
        <div>
          <span className="dash-eyebrow">Overview</span>
          <h2 className="dash-title">Agent workbench status</h2>
        </div>
        {activeProject && (
          <div className="dash-active" data-dashboard-active>
            <span className="dash-active-label">Active</span>
            <button type="button" className="dash-active-name" onClick={() => onOpen(activeProject.id)}>
              {activeProject.name}
            </button>
          </div>
        )}
      </div>

      <div className="dash-metrics" data-dashboard-metrics>
        <DashboardMetric label="projects" value={summary.total} detail={`${summary.nodeCount} nodes`} />
        <DashboardMetric label="in flight" value={summary.inFlightCount} detail={`${needsTest.length} need test`} />
        <DashboardMetric label="built" value={summary.completedCount} detail="completed agents" />
        <DashboardMetric label="tested" value={summary.testedCount} detail={`${summary.runCount} cached runs`} />
      </div>

      <div className="dash-lanes">
        <DashboardLane
          title="In flight"
          empty="No draft agents."
          projects={inFlight.slice(0, 4)}
          onOpen={onOpen}
        />
        <DashboardLane
          title="Built"
          empty="No completed agents yet."
          projects={built.slice(0, 4)}
          onOpen={onOpen}
        />
      </div>

      <div className="dash-table-wrap" data-dashboard-projects>
        <div className="dash-table-head">
          <span>Agent projects</span>
          <span>{summary.projects.length} total</span>
        </div>
        <div className="dash-table">
          {summary.projects.map((project) => (
            <div
              key={project.id}
              className={`dash-row ${project.id === activeProjectId ? "is-active" : ""}`}
              data-dashboard-project-row
              data-project-status={project.status}
            >
              <div className="dash-project-main">
                <button type="button" className="dash-project-name" onClick={() => onOpen(project.id)}>
                  {project.name}
                </button>
                <span className="dash-project-meta">
                  {project.nodeCount} nodes · {project.edgeCount} edges · {project.lastActivityLabel}
                </span>
              </div>
              <span className={`dash-pill dash-pill-${project.stageKey}`}>{project.stageLabel}</span>
              <span className="dash-number">{project.runCount} runs</span>
              <span className="dash-number">{project.snapshotCount} snapshots</span>
              <div className="dash-actions">
                <button type="button" className="dash-btn" onClick={() => onOpen(project.id)}>open</button>
                <button type="button" className="dash-btn" onClick={() => renameProject(project)}>rename</button>
                <button type="button" className="dash-btn dash-danger" onClick={() => deleteProject(project)}>delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx global>{`
        .dashboard {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .dash-top {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 18px;
          flex-wrap: wrap;
        }
        .dash-eyebrow,
        .dash-active-label,
        .dash-table-head {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .dash-title {
          margin: 2px 0 0;
          font-size: 18px;
          line-height: 1.25;
        }
        .dash-active {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .dash-active-name,
        .dash-project-name {
          border: 0;
          background: transparent;
          color: var(--ink);
          cursor: pointer;
          font-family: inherit;
          font-weight: 600;
          padding: 0;
          text-align: left;
        }
        .dash-active-name:hover,
        .dash-project-name:hover {
          color: var(--accent-strong);
        }
        .dash-metrics {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        .dash-metric {
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 12px;
          background: var(--surface);
        }
        .dash-metric-label {
          display: block;
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .dash-metric-value {
          display: block;
          margin-top: 8px;
          font-size: 24px;
          font-weight: 700;
          line-height: 1;
        }
        .dash-metric-detail {
          display: block;
          margin-top: 6px;
          color: var(--muted);
          font-size: 12px;
        }
        .dash-lanes {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        .dash-lane {
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface);
          min-width: 0;
        }
        .dash-lane-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
          font-weight: 600;
        }
        .dash-lane-count {
          color: var(--muted);
          font-size: 12px;
          font-weight: 400;
        }
        .dash-lane-list {
          display: flex;
          flex-direction: column;
        }
        .dash-lane-item {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          padding: 10px 14px;
          border-bottom: 1px solid var(--border);
        }
        .dash-lane-item:last-child {
          border-bottom: 0;
        }
        .dash-empty {
          padding: 14px;
          color: var(--muted);
          font-size: 13px;
        }
        .dash-table-wrap {
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
          background: var(--surface);
        }
        .dash-table-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
        }
        .dash-table {
          display: flex;
          flex-direction: column;
        }
        .dash-row {
          display: grid;
          grid-template-columns: minmax(220px, 1fr) auto auto auto auto;
          gap: 12px;
          align-items: center;
          padding: 12px 14px;
          border-bottom: 1px solid var(--border);
        }
        .dash-row:last-child {
          border-bottom: 0;
        }
        .dash-row.is-active {
          background: var(--accent-soft);
        }
        .dash-project-main {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .dash-project-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dash-project-meta,
        .dash-number {
          color: var(--muted);
          font-size: 12px;
        }
        .dash-pill {
          justify-self: start;
          min-width: 72px;
          text-align: center;
          border-radius: 999px;
          padding: 4px 8px;
          border: 1px solid var(--border);
          font-size: 11px;
          color: var(--muted);
          background: var(--surface);
        }
        .dash-pill-built {
          border-color: var(--eval);
          color: var(--eval);
        }
        .dash-pill-testing {
          border-color: var(--accent);
          color: var(--accent-strong);
        }
        .dash-pill-drafted {
          border-color: var(--tool);
          color: var(--ink);
        }
        .dash-actions {
          display: flex;
          gap: 6px;
          justify-content: flex-end;
        }
        .dash-btn {
          height: 28px;
          padding: 0 10px;
          border-radius: 7px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink);
          cursor: pointer;
          font-family: inherit;
          font-size: 12px;
        }
        .dash-btn:hover {
          border-color: var(--accent);
          color: var(--accent-strong);
        }
        .dash-danger:hover {
          border-color: var(--danger);
          color: var(--danger);
        }
        @media (max-width: 900px) {
          .dash-metrics,
          .dash-lanes {
            grid-template-columns: 1fr;
          }
          .dash-row {
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .dash-actions {
            justify-content: flex-start;
            flex-wrap: wrap;
          }
        }
      `}</style>
    </section>
  );
}

function DashboardMetric({ label, value, detail }) {
  return (
    <div className="dash-metric">
      <span className="dash-metric-label">{label}</span>
      <span className="dash-metric-value">{value}</span>
      <span className="dash-metric-detail">{detail}</span>
    </div>
  );
}

function DashboardLane({ title, empty, projects, onOpen }) {
  return (
    <div className="dash-lane">
      <div className="dash-lane-title">
        <span>{title}</span>
        <span className="dash-lane-count">{projects.length}</span>
      </div>
      {projects.length === 0 ? (
        <div className="dash-empty">{empty}</div>
      ) : (
        <div className="dash-lane-list">
          {projects.map((project) => (
            <div key={project.id} className="dash-lane-item">
              <div className="dash-project-main">
                <button type="button" className="dash-project-name" onClick={() => onOpen(project.id)}>
                  {project.name}
                </button>
                <span className="dash-project-meta">
                  {project.stageLabel} · {project.lastActivityLabel}
                </span>
              </div>
              <span className={`dash-pill dash-pill-${project.stageKey}`}>{project.stageLabel}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function summarizeDashboard(projects = []) {
  const summaries = projects
    .map((project) => summarizeProject(project))
    .sort((a, b) => b.lastActivityMs - a.lastActivityMs);
  const inFlight = summaries.filter((p) => p.status !== "completed");
  const completed = summaries.filter((p) => p.status === "completed");
  const tested = summaries.filter((p) => p.runCount > 0);
  return {
    projects: summaries,
    total: summaries.length,
    inFlightCount: inFlight.length,
    completedCount: completed.length,
    testedCount: tested.length,
    nodeCount: summaries.reduce((sum, p) => sum + p.nodeCount, 0),
    runCount: summaries.reduce((sum, p) => sum + p.runCount, 0),
  };
}

function summarizeProject(project) {
  const nodes = Array.isArray(project?.canvas?.nodes) ? project.canvas.nodes : [];
  const edges = Array.isArray(project?.canvas?.edges) ? project.canvas.edges : [];
  const snapshots = Array.isArray(project?.snapshots) ? project.snapshots : [];
  const runEntries = Object.values(project?.runCache ?? {}).filter((entry) => entry && typeof entry === "object");
  const lastActivityMs = Math.max(
    dateMs(project?.createdAt),
    ...snapshots.map((snapshot) => dateMs(snapshot?.createdAt)),
    ...runEntries.map((entry) => dateMs(entry?.ts)),
  );
  const status = project?.status === "completed" ? "completed" : "draft";
  const stageKey = status === "completed"
    ? "built"
    : runEntries.length > 0
      ? "testing"
      : snapshots.length > 0
        ? "drafted"
        : "draft";
  const stageLabel = {
    built: "built",
    testing: "testing",
    drafted: "drafted",
    draft: "draft",
  }[stageKey];
  return {
    id: project.id,
    name: project.name || "Untitled project",
    status,
    stageKey,
    stageLabel,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    runCount: runEntries.length,
    snapshotCount: snapshots.length,
    lastActivityMs,
    lastActivityLabel: formatRelativeDate(lastActivityMs),
  };
}

function dateMs(value) {
  if (typeof value !== "string") return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function formatRelativeDate(ms) {
  if (!ms) return "no activity";
  const diffMs = Date.now() - ms;
  if (diffMs < 60_000) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
