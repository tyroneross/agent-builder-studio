"use client";

import { PATTERNS } from "../lib/agent-patterns";

// PatternPicker — grid of cards, one per canonical pattern. Pass 9.
//
// Calm Precision rules applied:
//   - Single border around the whole grid; cells separated by hairline
//     dividers, not individual card borders.
//   - Category is text-only ("Type I", "Type II"), no badge background.
//   - Mini-diagram is dimmed (opacity 0.7) until hover; size signals weight,
//     not chrome.
//   - One affordance per card: the whole cell is clickable.
//   - No animations beyond instant border tint on hover.
//
// Props:
//   - onSelect(pattern): emitted when the user clicks a card.
//   - patterns?: optional override for testing; defaults to the full PATTERNS.
//
// Each card renders a compact SVG mini-diagram derived from the pattern's
// nodes + edges. We don't render the full graph — we sample up to 6 nodes,
// normalize their coords, and draw small role-tinted boxes connected by
// straight lines. The goal is shape recognition, not legibility.
export default function PatternPicker({ onSelect, patterns }) {
  const list = patterns || PATTERNS;
  return (
    <div className="pp" data-pattern-picker>
      <ul className="pp-grid">
        {list.map((pattern) => (
          <li key={pattern.id} className="pp-cell">
            <button
              type="button"
              className="pp-card"
              onClick={() => onSelect?.(pattern)}
              data-pattern-card={pattern.id}
              aria-label={`Use the ${pattern.name} pattern`}
            >
              <div className="pp-head">
                <span className="pp-name">{pattern.name}</span>
                <span className="pp-cat">{pattern.category}</span>
              </div>
              <p className="pp-desc">{pattern.shortDescription}</p>
              <div className="pp-diagram" aria-hidden="true">
                <MiniDiagram pattern={pattern} />
              </div>
            </button>
          </li>
        ))}
      </ul>

      <style jsx>{`
        .pp {
          width: 100%;
        }
        .pp-grid {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          border: 1px solid var(--border);
          border-radius: 12px;
          background: var(--surface);
          overflow: hidden;
        }
        @media (max-width: 640px) {
          .pp-grid {
            grid-template-columns: 1fr;
          }
        }
        .pp-cell {
          display: flex;
          /* Hairline dividers, not per-card borders. */
        }
        .pp-cell:nth-child(2n) {
          border-left: 1px solid var(--border);
        }
        @media (max-width: 640px) {
          .pp-cell:nth-child(2n) {
            border-left: none;
          }
        }
        .pp-cell:nth-child(n + 3) {
          border-top: 1px solid var(--border);
        }
        @media (max-width: 640px) {
          .pp-cell:nth-child(n + 2) {
            border-top: 1px solid var(--border);
          }
        }
        .pp-card {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
          padding: 16px 18px;
          background: transparent;
          border: 0;
          border-radius: 0;
          color: inherit;
          font: inherit;
          text-align: left;
          cursor: pointer;
          transition: background 100ms ease;
        }
        .pp-card:hover {
          background: var(--accent-soft);
        }
        .pp-card:focus-visible {
          outline: 2px solid var(--accent-strong);
          outline-offset: -2px;
        }
        .pp-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
        }
        .pp-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--ink);
          line-height: 1.25;
        }
        .pp-cat {
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .pp-desc {
          margin: 0;
          font-size: 13px;
          line-height: 1.4;
          color: var(--muted);
        }
        .pp-diagram {
          margin-top: auto;
          opacity: 0.72;
          transition: opacity 100ms ease;
        }
        .pp-card:hover .pp-diagram {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}

// Tiny SVG renderer. Samples up to 6 nodes, projects coordinates onto a
// 240x100 viewbox, draws role-tinted rectangles + lines. Not a literal
// representation; meant for shape-recognition.
function MiniDiagram({ pattern }) {
  const W = 240;
  const H = 100;
  const PADDING = 8;
  const BOX_W = 28;
  const BOX_H = 14;

  const nodes = pattern.nodes.slice(0, 6);
  if (nodes.length === 0) return null;

  // Find bounds so we can normalize.
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rangeX = Math.max(1, maxX - minX);
  const rangeY = Math.max(1, maxY - minY);

  function project(n) {
    const cx = PADDING + ((n.x - minX) / rangeX) * (W - 2 * PADDING - BOX_W);
    const cy = PADDING + ((n.y - minY) / rangeY) * (H - 2 * PADDING - BOX_H);
    return { x: cx, y: cy };
  }

  const positions = new Map(nodes.map((n) => [n.id, project(n)]));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="76"
      role="img"
      aria-hidden="true"
      data-pattern-diagram={pattern.id}
    >
      {/* Edges: only draw if both endpoints are in the sampled set. */}
      {pattern.edges.map((e) => {
        const a = positions.get(e.from);
        const b = positions.get(e.to);
        if (!a || !b) return null;
        return (
          <line
            key={e.id || `${e.from}->${e.to}`}
            x1={a.x + BOX_W / 2}
            y1={a.y + BOX_H / 2}
            x2={b.x + BOX_W / 2}
            y2={b.y + BOX_H / 2}
            stroke="var(--border-strong)"
            strokeWidth="1"
          />
        );
      })}
      {/* Nodes: role-tinted fills using existing CSS vars. */}
      {nodes.map((n) => {
        const p = positions.get(n.id);
        if (!p) return null;
        const fill = roleColor(n.role);
        return (
          <rect
            key={n.id}
            x={p.x}
            y={p.y}
            width={BOX_W}
            height={BOX_H}
            rx="2"
            ry="2"
            fill={fill}
            stroke="var(--border)"
            strokeWidth="0.5"
          />
        );
      })}
    </svg>
  );
}

function roleColor(role) {
  switch (role) {
    case "agent":
      return "var(--accent-soft)";
    case "guardrail":
      return "var(--policy-soft)";
    case "orchestrator":
      return "var(--accent-soft)";
    case "executor":
      return "var(--tool-soft)";
    case "eval":
      return "var(--eval-soft)";
    case "memory":
      return "var(--memory-soft)";
    default:
      return "var(--surface-muted)";
  }
}
