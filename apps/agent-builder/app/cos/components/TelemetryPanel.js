"use client";

// TelemetryPanel — collapsible, end-of-run.
//
// Inputs:
//   summary       run-summary event payload, shape: {perNode, totals}
//   brief         the markdown brief (string)
//   transcript    the full transcript object
//   telemetryRows the raw telemetry rows (parsed from JSONL stream — we
//                 don't have direct access to the file, but the run-summary
//                 payload + transcript is enough to reconstruct everything
//                 the user would download. We synthesize JSONL on the fly
//                 from transcript + per-node winners for the download path.)
//
// Downloads use Blob URLs. No external dependencies.

import { useMemo, useState } from "react";

export default function TelemetryPanel({ summary, brief, transcript, lessons }) {
  const [open, setOpen] = useState(true);

  if (!summary) return null;

  const t = summary.totals;
  const quality = transcript?.qualityScorecard ?? null;
  const briefBlobUrl = useMemo(
    () => (brief ? blobUrl(brief, "text/markdown") : null),
    [brief],
  );
  const transcriptBlobUrl = useMemo(
    () =>
      transcript
        ? blobUrl(JSON.stringify(transcript, null, 2), "application/json")
        : null,
    [transcript],
  );
  const telemetryBlobUrl = useMemo(
    () => buildTelemetryJsonlBlobUrl(summary),
    [summary],
  );
  const scorecardBlobUrl = useMemo(
    () => quality ? blobUrl(JSON.stringify(quality, null, 2), "application/json") : null,
    [quality],
  );

  return (
    <section className="cos-telemetry">
      <button
        type="button"
        className="cos-telemetry-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        <h2>Telemetry</h2>
        <span className="cos-telemetry-chevron">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="cos-telemetry-body">
          <dl className="cos-totals">
            <Stat label="Wall-clock" value={`${(t.total_ms / 1000).toFixed(1)}s`} />
            <Stat label="Tokens in" value={t.total_tokens_in.toLocaleString()} />
            <Stat label="Tokens out" value={t.total_tokens_out.toLocaleString()} />
            <Stat label="Parse retries" value={t.parse_retries} />
            <Stat label="Lessons loaded" value={t.lessons_loaded} />
            <Stat label="Cloud calls" value={t.cloud_calls} />
          </dl>

          {lessons && lessons.length > 0 && (
            <div className="cos-lessons">
              <h3>Lessons injected</h3>
              <ol>
                {lessons.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
            </div>
          )}

          {quality && (
            <div className="cos-scorecard">
              <h3>Quality scorecard</h3>
              <dl>
                <Stat label="Score" value={`${quality.score}/${quality.maxScore}`} />
                <Stat label="Status" value={quality.status} />
              </dl>
              <ul>
                {quality.dimensions.map((item) => (
                  <li key={item.id}>
                    <strong>{item.label}</strong>: {item.score}/{item.maxScore}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="cos-downloads">
            {telemetryBlobUrl && (
              <a
                href={telemetryBlobUrl}
                download="telemetry.jsonl"
                className="cos-download-link"
                data-test="dl-telemetry"
              >
                Download telemetry.jsonl
              </a>
            )}
            {briefBlobUrl && (
              <a
                href={briefBlobUrl}
                download="weekly-operating-brief.md"
                className="cos-download-link"
                data-test="dl-brief"
              >
                Download brief.md
              </a>
            )}
            {transcriptBlobUrl && (
              <a
                href={transcriptBlobUrl}
                download="transcript.json"
                className="cos-download-link"
                data-test="dl-transcript"
              >
                Download transcript.json
              </a>
            )}
            {scorecardBlobUrl && (
              <a
                href={scorecardBlobUrl}
                download="quality-scorecard.json"
                className="cos-download-link"
                data-test="dl-scorecard"
              >
                Download quality-scorecard.json
              </a>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .cos-telemetry {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 16px 18px;
          margin-bottom: 12px;
        }
        .cos-telemetry-toggle {
          background: transparent;
          border: 0;
          padding: 0;
          cursor: pointer;
          width: 100%;
          display: flex;
          justify-content: space-between;
          align-items: center;
          color: var(--ink);
        }
        .cos-telemetry-toggle h2 {
          margin: 0;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .cos-telemetry-chevron {
          color: var(--muted);
          font-size: 14px;
        }
        .cos-telemetry-body {
          margin-top: 14px;
        }
        .cos-totals {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 12px;
          margin: 0 0 16px;
        }
        .cos-lessons {
          margin: 16px 0;
          padding: 12px 14px;
          background: var(--surface-muted);
          border-radius: 8px;
        }
        .cos-lessons h3 {
          margin: 0 0 6px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .cos-lessons ol {
          margin: 0;
          padding-left: 20px;
        }
        .cos-lessons li {
          font-size: 13px;
          line-height: 1.45;
          margin-bottom: 4px;
        }
        .cos-scorecard {
          margin: 16px 0;
          padding: 12px 14px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
        }
        .cos-scorecard h3 {
          margin: 0 0 8px;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .cos-scorecard dl {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 10px;
          margin: 0 0 8px;
        }
        .cos-scorecard ul {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 6px 14px;
          margin: 0;
          padding-left: 18px;
        }
        .cos-scorecard li {
          font-size: 13px;
          line-height: 1.4;
        }
        .cos-downloads {
          display: flex;
          gap: 18px;
          flex-wrap: wrap;
        }
      `}</style>
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="cos-stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
      <style jsx>{`
        .cos-stat {
          display: grid;
          gap: 2px;
        }
        dt {
          color: var(--muted);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        dd {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
          font-feature-settings: "tnum";
          color: var(--ink);
        }
      `}</style>
    </div>
  );
}

// ---------- helpers ----------

function blobUrl(text, type) {
  if (typeof window === "undefined") return null;
  const blob = new Blob([text], { type });
  return URL.createObjectURL(blob);
}

// We don't have the raw JSONL on the client (the file lives on the server's
// runDir). So we synthesize a one-row-per-node JSONL stand-in from the
// run-summary payload. This is enough for users who want to grep the
// telemetry without opening DevTools. The on-disk file is the authoritative
// copy for production tooling.
function buildTelemetryJsonlBlobUrl(summary) {
  if (typeof window === "undefined" || !summary) return null;
  const lines = [];
  for (const n of summary.perNode) {
    lines.push(JSON.stringify({ ...n, source: "ui-synthesized" }));
  }
  lines.push(JSON.stringify({ source: "ui-synthesized", totals: summary.totals }));
  return blobUrl(lines.join("\n") + "\n", "application/x-ndjson");
}
