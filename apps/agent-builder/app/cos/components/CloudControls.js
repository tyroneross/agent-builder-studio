"use client";

// CloudControls — radio group for the cascade policy.
//
// Behavior:
//   - allowCloud=always  → if no cloud key is detected, show a warning row
//   - GROQ key indicator: ✓ when present, "missing" when not (text only,
//     no background pills per the project's design discipline)
//
// The cloud-token run budget is NOT a user-facing setting (follow-up item 10
// ruling): runChiefOfStaff derives it from cascadePolicy() and the cascade
// skips cloud lanes gracefully once it is spent. The UI states this instead
// of offering a dead knob.

const CLOUD_DESCRIPTIONS = {
  never: "Local only. Cascade falls back to local-fallback then fails.",
  "on-failure": "Default. Cloud is consulted only when both local lanes fail.",
  always: "Skip local entirely. Go straight to cloud (Groq → Anthropic → OpenAI).",
};

export default function CloudControls({
  allowCloud,
  setAllowCloud,
  envStatus,
  disabled,
}) {
  const groqOk = envStatus?.groq === true;
  const anthropicOk = envStatus?.anthropic === true;
  const openaiOk = envStatus?.openai === true;
  const anyCloudKey = groqOk || anthropicOk || openaiOk;

  const showAmberWarning = allowCloud === "always" && !anyCloudKey;

  return (
    <section className="cos-cloud">
      <header className="cos-cloud-head">
        <h2>Cloud cascade</h2>
        <KeyStatus envStatus={envStatus} />
      </header>

      <fieldset className="cos-cloud-radio" disabled={disabled}>
        <legend className="cos-visually-hidden">Allow cloud</legend>
        {(["never", "on-failure", "always"]).map((value) => (
          <label key={value} className="cos-radio-row">
            <input
              type="radio"
              name="allowCloud"
              value={value}
              checked={allowCloud === value}
              onChange={() => setAllowCloud(value)}
            />
            <span className="cos-radio-text">
              <strong>{value}</strong>
              <span className="cos-radio-hint">{CLOUD_DESCRIPTIONS[value]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {allowCloud !== "never" && (
        <p className="cos-cloud-budget">
          Cloud spend is budget-capped automatically per run; once spent, the
          cascade stays on local lanes.
        </p>
      )}

      {showAmberWarning && (
        <p className="cos-cloud-warn">
          allow-cloud is set to <strong>always</strong> but no cloud API key
          was detected. Set <code>GROQ_API_KEY</code> in your shell and reload,
          or switch to <strong>on-failure</strong>.
        </p>
      )}

      <style jsx>{`
        .cos-cloud {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px 18px;
          margin-bottom: 12px;
        }
        .cos-cloud-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 12px;
          gap: 12px;
        }
        .cos-cloud-head h2 {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .cos-cloud-radio {
          border: none;
          padding: 0;
          margin: 0 0 12px;
          display: grid;
          gap: 6px;
        }
        .cos-radio-row {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 6px 0;
          cursor: pointer;
        }
        .cos-radio-row input[type="radio"] {
          margin-top: 4px;
          width: auto;
          min-height: 0;
        }
        .cos-radio-text {
          display: grid;
          gap: 2px;
          line-height: 1.35;
        }
        .cos-radio-text strong {
          font-weight: 600;
          font-size: 14px;
        }
        .cos-radio-hint {
          color: var(--muted);
          font-size: 12px;
        }
        .cos-cloud-budget {
          color: var(--muted);
          font-size: 12px;
          line-height: 1.45;
          margin: 0 0 8px;
        }
        .cos-cloud-warn {
          color: var(--tool);
          font-size: 13px;
          line-height: 1.45;
          margin: 8px 0 0;
        }
        .cos-cloud-warn code {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
        }
        .cos-visually-hidden {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          border: 0;
        }
      `}</style>
    </section>
  );
}

function KeyStatus({ envStatus }) {
  if (!envStatus) {
    return <span className="cos-key-loading">checking keys…</span>;
  }
  const items = [
    { key: "groq", label: "GROQ" },
    { key: "anthropic", label: "Anthropic" },
    { key: "openai", label: "OpenAI" },
  ];
  return (
    <span className="cos-key-row">
      {items.map((it) => (
        <span
          key={it.key}
          className={envStatus[it.key] ? "cos-key-ok" : "cos-key-missing"}
        >
          {envStatus[it.key] ? "✓" : "·"} {it.label}
        </span>
      ))}
      <style jsx>{`
        .cos-key-row {
          display: inline-flex;
          gap: 12px;
          font-size: 12px;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
        }
        .cos-key-ok {
          color: var(--accent-strong);
          font-weight: 600;
        }
        .cos-key-missing {
          color: var(--faint);
        }
        .cos-key-loading {
          color: var(--muted);
          font-size: 12px;
        }
      `}</style>
    </span>
  );
}
