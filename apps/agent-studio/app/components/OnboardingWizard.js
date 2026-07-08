"use client";

import { useEffect, useRef, useState } from "react";
import PatternPicker from "./PatternPicker";

// OnboardingWizard — three-step modal shown on / when a user has no projects
// and hasn't seen onboarding yet. Pass 9.
//
// Calm Precision rules applied:
//   - Skip + Close (X) on every step. Exit-always-visible.
//   - One primary action per step. Alternates are compact secondary buttons.
//   - No progress dots — three steps don't need them.
//   - No animation flourish. Instant fade only.
//   - Single border around the dialog; horizontal divider above the actions.
//
// Steps:
//   1. Welcome — heading + ~30-word description + "Get started" + "Skip".
//   2. Choose a starting point — three options (pattern, blank, explore).
//   3. Pick a pattern — renders <PatternPicker/>.
//
// Props:
//   - open: boolean — render only when true.
//   - onComplete(): user finished or explicitly chose blank. Parent persists
//     the "complete" flag and closes.
//   - onPickPattern(pattern): fired when a pattern card is clicked.
//   - onPickBlank(): fired when "Create a blank project" is clicked.
//   - onExplore(): fired when "I'll explore on my own" is clicked.
//   - onClose(): fired when the user dismisses (X, Skip, or ESC). Parent
//     persists the flag and closes.
//
// Onboarding-complete flag write happens in the parent (page.js) — wizard
// only fires callbacks. This keeps the localStorage key in one place.
export const ONBOARDING_FLAG_KEY = "agent-studio:onboarding-complete:v1";

export default function OnboardingWizard({
  open,
  onComplete,
  onPickPattern,
  onPickBlank,
  onExplore,
  onClose,
}) {
  const [step, setStep] = useState(1);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function handlePatternClick(pattern) {
    onPickPattern?.(pattern);
    onComplete?.();
  }

  return (
    <div className="ow-overlay" data-onboarding-wizard role="presentation">
      <div
        ref={dialogRef}
        className="ow"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ow-title"
        data-onboarding-dialog
        data-onboarding-step={step}
      >
        <button
          type="button"
          className="ow-close"
          onClick={onClose}
          aria-label="Close onboarding"
          data-onboarding-close
        >
          ×
        </button>

        {step === 1 && (
          <div className="ow-step" data-onboarding-step-content="1">
            <h2 id="ow-title" className="ow-title">
              Welcome to Agent Studio
            </h2>
            <p className="ow-body">
              A local canvas for designing and testing agents. Sketch the agent graph,
              attach context, and run a query. Everything stays on your machine.
            </p>
            <div className="ow-divider" />
            <div className="ow-actions ow-actions-step1">
              <button
                type="button"
                className="ow-cta ow-cta-primary"
                onClick={() => setStep(2)}
                data-onboarding-get-started
              >
                Get started
              </button>
              <button
                type="button"
                className="ow-skip"
                onClick={onClose}
                data-onboarding-skip
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="ow-step" data-onboarding-step-content="2">
            <h2 id="ow-title" className="ow-title">
              How do you want to start?
            </h2>
            <p className="ow-body">
              Pick a path. You can change anything once the project is open.
            </p>

            <ul className="ow-options">
              <li>
                <button
                  type="button"
                  className="ow-opt ow-opt-primary"
                  onClick={() => setStep(3)}
                  data-onboarding-choose-pattern
                >
                  <span className="ow-opt-title">Start from a pattern</span>
                  <span className="ow-opt-desc">
                    Bootstrap a project from a canonical agent shape.
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="ow-opt"
                  onClick={() => {
                    onPickBlank?.();
                    onComplete?.();
                  }}
                  data-onboarding-choose-blank
                >
                  <span className="ow-opt-title">Describe what you need</span>
                  <span className="ow-opt-desc">
                    Type your goal and let the local model suggest the rest.
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="ow-opt"
                  onClick={() => {
                    onExplore?.();
                    onComplete?.();
                  }}
                  data-onboarding-choose-explore
                >
                  <span className="ow-opt-title">I&apos;ll explore on my own</span>
                  <span className="ow-opt-desc">
                    Land on the regular page and decide later.
                  </span>
                </button>
              </li>
            </ul>

            <div className="ow-divider" />
            <div className="ow-actions">
              <button
                type="button"
                className="ow-back"
                onClick={() => setStep(1)}
                data-onboarding-back
              >
                Back
              </button>
              <button
                type="button"
                className="ow-skip"
                onClick={onClose}
                data-onboarding-skip
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="ow-step ow-step-pick" data-onboarding-step-content="3">
            <h2 id="ow-title" className="ow-title">
              Pick a pattern
            </h2>
            <p className="ow-body">
              Click a card to bias the conversational setup with that pattern. You can
              describe your goal next, and the local model will suggest the rest.
            </p>

            <PatternPicker onSelect={handlePatternClick} />

            <div className="ow-divider" />
            <div className="ow-actions">
              <button
                type="button"
                className="ow-back"
                onClick={() => setStep(2)}
                data-onboarding-back
              >
                Back
              </button>
              <button
                type="button"
                className="ow-skip"
                onClick={onClose}
                data-onboarding-skip
              >
                Skip
              </button>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .ow-overlay {
          position: fixed;
          inset: 0;
          background: rgba(31, 37, 32, 0.32);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 60;
          padding: 24px;
        }
        .ow {
          position: relative;
          width: 100%;
          max-width: 640px;
          max-height: calc(100vh - 48px);
          overflow-y: auto;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 28px 28px 22px;
          color: var(--ink);
        }
        .ow-step.ow-step-pick {
          /* Pattern picker step needs a bit more breathing room. */
        }
        .ow-close {
          position: absolute;
          top: 10px;
          right: 12px;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          line-height: 1;
          color: var(--muted);
          background: transparent;
          border: 1px solid transparent;
          border-radius: 6px;
          cursor: pointer;
        }
        .ow-close:hover {
          color: var(--ink);
          border-color: var(--border);
        }
        .ow-title {
          margin: 0 0 6px;
          font-size: 20px;
          font-weight: 600;
        }
        .ow-body {
          margin: 0 0 18px;
          font-size: 13px;
          line-height: 1.5;
          color: var(--muted);
        }
        .ow-divider {
          height: 1px;
          background: var(--border);
          margin: 18px 0 14px;
        }
        .ow-actions {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .ow-actions-step1 {
          justify-content: space-between;
        }
        .ow-cta {
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          height: 36px;
          padding: 0 18px;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink);
          cursor: pointer;
        }
        .ow-cta-primary {
          background: var(--accent);
          border-color: var(--accent);
          color: #ffffff;
        }
        .ow-cta-primary:hover {
          background: var(--accent-strong);
          border-color: var(--accent-strong);
        }
        .ow-skip {
          font-family: inherit;
          font-size: 12px;
          color: var(--muted);
          background: transparent;
          border: 0;
          cursor: pointer;
          padding: 6px 4px;
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .ow-skip:hover {
          color: var(--ink);
        }
        .ow-back {
          font-family: inherit;
          font-size: 12px;
          color: var(--muted);
          background: transparent;
          border: 0;
          cursor: pointer;
          padding: 6px 4px;
        }
        .ow-back:hover {
          color: var(--ink);
        }
        .ow-options {
          margin: 0;
          padding: 0;
          list-style: none;
          display: flex;
          flex-direction: column;
          gap: 0;
          border: 1px solid var(--border);
          border-radius: 10px;
          overflow: hidden;
        }
        .ow-options li + li {
          border-top: 1px solid var(--border);
        }
        .ow-opt {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 2px;
          padding: 14px 16px;
          background: transparent;
          border: 0;
          color: inherit;
          font: inherit;
          text-align: left;
          cursor: pointer;
        }
        .ow-opt:hover {
          background: var(--accent-soft);
        }
        .ow-opt:focus-visible {
          outline: 2px solid var(--accent-strong);
          outline-offset: -2px;
        }
        .ow-opt-primary {
          background: var(--accent-soft);
        }
        .ow-opt-primary:hover {
          background: var(--accent-soft);
          box-shadow: inset 0 0 0 1px var(--accent);
        }
        .ow-opt-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--ink);
        }
        .ow-opt-desc {
          font-size: 12px;
          color: var(--muted);
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
}
