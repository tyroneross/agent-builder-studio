// Pass 15 — inspector pagination + virtualization thresholds.
//
// The inspector panel renders the most recent transcript record for a single
// node at a time, but a long transcript can carry per-node bodies in the
// hundreds of KB. These constants govern how aggressively the panel
// summarizes large payloads to keep the DOM responsive on graphs with many
// nodes and bodies.
//
// Lifted to a dedicated module so a future settings UI can surface the
// values; consumers (`InspectorPanel`) import from here so the same value
// drives both rendering and layout.

export const DEFAULT_INSPECTOR_CONFIG = Object.freeze({
  // Maximum number of characters of `systemPrompt` / `userMessage` /
  // `output` to render inline before the panel collapses the body to a
  // "show full" toggle. 8 KB keeps a typical text+code block from making
  // the panel scroll forever. The cached body itself is unaffected — this
  // is a render-only ceiling.
  inlineBodyMaxChars: 8_192,

  // Number of inspector entries cached in memory across panel switches. The
  // panel itself is a single-record view; this threshold governs how many
  // recent transcripts the canvas page should retain so a "back to previous"
  // navigation is instant. Default 3 covers the common Inspect → Replay →
  // Inspect-again loop.
  recentTranscriptsKept: 3,
});

export function getInspectorConfig() {
  return { ...DEFAULT_INSPECTOR_CONFIG };
}
