// Telemetry summary digest. Single source of truth for both the CLI
// `--summary` output and the API `run-summary` SSE event.
//
// Input shape: a list of telemetry rows as recorded by recordTelemetry()
// (see lib/cos-telemetry.mjs). We tolerate extra fields and missing optional
// fields so older runs and future schema additions don't break the digest.
//
// Output shape (stable contract — UI and CLI both consume this):
//
//   {
//     perNode: [
//       { node, role, lane, provider, model, ms, parsed_ok, fallback_reason,
//         parse_retry, attempt }
//     ],
//     totals: {
//       total_ms,
//       total_tokens_in,
//       total_tokens_out,
//       parse_retries,
//       lessons_loaded,
//       cloud_calls,
//       node_count,
//     },
//   }
//
// Per-node we surface ONE row per node — the WINNING attempt (the one with
// parsed_ok=true). If no attempt parsed, we surface the LAST attempt so the
// failure reason is visible.
//
// Synthetic nodes (`_warmup`, `_run`) are excluded from `perNode` but their
// counters do feed `totals` (warmup ms goes into total_ms; lessons_loaded
// is read from the `_run` row).

const SYNTHETIC_NODES = new Set(["_warmup", "_run"]);
const CLOUD_LANES = new Set(["cloud", "cloud-secondary", "cloud-tertiary"]);

/**
 * @param {Array<object>} rows  telemetry rows (parsed JSONL)
 * @returns {{perNode: object[], totals: object}}
 */
export function summarize(rows) {
  if (!Array.isArray(rows)) rows = [];

  // Group by node key, preserving order of first appearance.
  const byNode = new Map();
  for (const r of rows) {
    if (!r || typeof r.node !== "string") continue;
    if (!byNode.has(r.node)) byNode.set(r.node, []);
    byNode.get(r.node).push(r);
  }

  const perNode = [];
  for (const [node, attempts] of byNode) {
    if (SYNTHETIC_NODES.has(node)) continue;
    // Prefer the parsed_ok=true row; otherwise the last attempt.
    const winner = attempts.find((a) => a.parsed_ok === true) ?? attempts[attempts.length - 1];
    if (!winner) continue;
    perNode.push({
      node,
      role: winner.role ?? null,
      lane: winner.lane ?? null,
      provider: winner.provider ?? null,
      model: winner.model ?? null,
      ms: typeof winner.ms === "number" ? winner.ms : null,
      parsed_ok: !!winner.parsed_ok,
      fallback_reason: winner.fallback_reason ?? null,
      parse_retry: !!winner.parse_retry,
      attempt: winner.attempt ?? null,
    });
  }

  // Totals span ALL rows (including warmup + retries) so wall-clock and token
  // counts reflect actual work done, not just the winners.
  let total_ms = 0;
  let total_tokens_in = 0;
  let total_tokens_out = 0;
  let parse_retries = 0;
  let lessons_loaded = 0;
  let cloud_calls = 0;
  for (const r of rows) {
    if (!r) continue;
    if (typeof r.ms === "number") total_ms += r.ms;
    if (typeof r.tokens_in === "number") total_tokens_in += r.tokens_in;
    if (typeof r.tokens_out === "number") total_tokens_out += r.tokens_out;
    if (r.parse_retry === true) parse_retries += 1;
    if (typeof r.lessons_loaded === "number") {
      // The `_run` synthetic row carries the lessons_loaded count. We pick the
      // max across rows so duplicate writes don't double-count.
      if (r.lessons_loaded > lessons_loaded) lessons_loaded = r.lessons_loaded;
    }
    if (CLOUD_LANES.has(r.lane)) cloud_calls += 1;
  }

  return {
    perNode,
    totals: {
      total_ms,
      total_tokens_in,
      total_tokens_out,
      parse_retries,
      lessons_loaded,
      cloud_calls,
      node_count: perNode.length,
    },
  };
}

/**
 * Format a summary as a human-readable string for terminal output.
 * Stable, pyramid-structured: totals first (headline), then per-node table.
 */
export function formatSummary(summary) {
  const t = summary.totals;
  const lines = [];
  lines.push("");
  lines.push("[cos] === Run summary ===");
  lines.push(
    `[cos] totals: ${t.total_ms}ms · in=${t.total_tokens_in} out=${t.total_tokens_out} · ` +
      `parse_retries=${t.parse_retries} · lessons_loaded=${t.lessons_loaded} · cloud_calls=${t.cloud_calls}`,
  );
  lines.push("[cos] per node:");
  for (const n of summary.perNode) {
    const ok = n.parsed_ok ? "ok" : "FAIL";
    const role = n.role ? ` role=${n.role}` : "";
    const retry = n.parse_retry ? " parse_retry" : "";
    const reason = n.fallback_reason ? ` reason=${n.fallback_reason}` : "";
    lines.push(
      `[cos]   ${n.node.padEnd(18)} ${ok.padEnd(4)} ${String(n.ms).padStart(6)}ms ` +
        `${(n.lane ?? "?").padEnd(16)} ${n.provider ?? "?"}/${n.model ?? "?"}${role}${retry}${reason}`,
    );
  }
  return lines.join("\n");
}

/**
 * Read a `telemetry.jsonl` file and produce a summary.
 * Tolerates partial/corrupt lines (skips them silently).
 */
export async function summarizeFile(path, fs) {
  const fsImpl = fs ?? (await import("node:fs/promises"));
  let text;
  try {
    text = await fsImpl.readFile(path, "utf8");
  } catch {
    return summarize([]);
  }
  const rows = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {}
  }
  return summarize(rows);
}
