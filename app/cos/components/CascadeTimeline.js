"use client";

// CascadeTimeline — six rows, one per node. State machine per row:
//
//   pending  (default) — no cascade-attempt seen yet
//   trying   — cascade-attempt fired; latest attempt's lane/model shown
//   ok       — node-end with parsed=true
//   failed   — node-error
//
// Lane indicators (text-only — no background pills per design discipline):
//   local-primary    [local-1]
//   local-fallback   [local-2]
//   cloud            [cloud-1]
//   cloud-secondary  [cloud-2]
//   cloud-tertiary   [cloud-3]
//   user-override    [override]
//
// The status color is conveyed by text color and weight, not by a colored
// background row. We do thin-border-left accent on the active row only.
//
// "No fake/placeholder rows" — the six nodes are the actual node keys the
// runtime will execute. Each starts in 'pending' state until a cascade-attempt
// arrives; we never show stub timing or stub lane text.

const NODE_ORDER = [
  "intake",
  "triage",
  "time_block_plan",
  "decision_log",
  "follow_up_plan",
  "operating_risks",
];

const NODE_LABELS = {
  intake: "Context intake",
  triage: "Priority triage",
  time_block_plan: "Time architect",
  decision_log: "Decision prep",
  follow_up_plan: "Follow-up planner",
  operating_risks: "Operating risk check",
};

const NODE_ROLES = {
  intake: "intake",
  triage: "priority strategist",
  time_block_plan: "calendar architect",
  decision_log: "decision prep",
  follow_up_plan: "follow-up operator",
  operating_risks: "honesty auditor",
};

const LANE_LABEL = {
  "local-primary": "local-1",
  "local-fallback": "local-2",
  cloud: "cloud-1",
  "cloud-secondary": "cloud-2",
  "cloud-tertiary": "cloud-3",
  "user-override": "override",
};

export default function CascadeTimeline({ nodes }) {
  return (
    <section className="cos-timeline">
      <header className="cos-timeline-head">
        <h2>Cascade</h2>
      </header>
      <ol className="cos-timeline-rows">
        {NODE_ORDER.map((key) => {
          const n = nodes[key] ?? { status: "pending" };
          return <Row key={key} nodeKey={key} node={n} />;
        })}
      </ol>
      <style jsx>{`
        .cos-timeline {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px 18px;
          margin-bottom: 12px;
        }
        .cos-timeline-head h2 {
          margin: 0 0 12px;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .cos-timeline-rows {
          list-style: none;
          padding: 0;
          margin: 0;
        }
      `}</style>
    </section>
  );
}

function Row({ nodeKey, node }) {
  const status = node.status ?? "pending";
  const label = NODE_LABELS[nodeKey] ?? nodeKey;
  const role = NODE_ROLES[nodeKey] ?? "—";

  return (
    <li className={`cos-row cos-row-${status}`}>
      <div className="cos-row-meta">
        <span className="cos-row-label">{label}</span>
        <span className="cos-row-role">{role}</span>
      </div>
      <div className="cos-row-state">
        <StateText nodeKey={nodeKey} node={node} />
      </div>
      <style jsx>{`
        .cos-row {
          display: grid;
          grid-template-columns: 220px 1fr;
          gap: 16px;
          padding: 10px 0;
          border-top: 1px solid var(--border);
          align-items: baseline;
        }
        .cos-row:first-child {
          border-top: none;
        }
        .cos-row-meta {
          display: grid;
          gap: 2px;
        }
        .cos-row-label {
          font-weight: 600;
          font-size: 14px;
          color: var(--ink);
        }
        .cos-row-role {
          font-size: 11px;
          color: var(--muted);
          text-transform: lowercase;
        }
        .cos-row-state {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          line-height: 1.5;
          color: var(--muted);
        }
        .cos-row-pending .cos-row-state {
          color: var(--faint);
        }
        .cos-row-trying .cos-row-state {
          color: var(--policy);
        }
        .cos-row-ok .cos-row-state {
          color: var(--accent-strong);
        }
        .cos-row-failed .cos-row-state {
          color: var(--danger);
        }
      `}</style>
    </li>
  );
}

function StateText({ node }) {
  const status = node.status ?? "pending";
  if (status === "pending") return <span>pending</span>;

  if (status === "trying") {
    const lane = LANE_LABEL[node.currentLane] ?? node.currentLane ?? "?";
    return (
      <span>
        trying <strong>{lane}</strong> · {node.currentProvider}/{node.currentModel}
        {node.attempt ? <> · attempt {node.attempt}</> : null}
      </span>
    );
  }

  if (status === "ok") {
    const lane = LANE_LABEL[node.lane] ?? node.lane ?? "?";
    const ms = typeof node.durationMs === "number" ? `${(node.durationMs / 1000).toFixed(1)}s` : "?";
    const retry = node.parseRetried ? <> · parse-retry</> : null;
    const reason = node.fallbackReason ? <> · {node.fallbackReason}</> : null;
    return (
      <span>
        ok via <strong>{lane}</strong> · {node.provider}/{node.model} · {ms}
        {retry}
        {reason}
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span>
        failed: {node.error ?? "all cascade lanes exhausted"}
      </span>
    );
  }

  return <span>{status}</span>;
}

export { NODE_ORDER };
