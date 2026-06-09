"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadStorageConfig, TRUNCATION_MARKER_PREFIX } from "../lib/storage-config.mjs";

// Solo Run modal — abstraction layer over the run-node API.
//
// Three modes:
//   - "plain"      : single prose textarea. Sent as a string. The runtime
//                    appends it as a "Solo-run inputs" block to the node
//                    prompt, so any node accepts it.
//   - "structured" : one textarea per declared `node.inputs[]` tag. Preset
//                    chips load the saved fixture, the upstream run-cache,
//                    or clear. "Suggest" asks Ollama to fill realistic
//                    example values.
//   - "json"       : raw JSON textarea — the original power-user fallback.
//                    "Format" pretty-prints. "Suggest" asks Ollama for a
//                    fixture-shaped JSON payload.
//
// A constraints panel sits above the mode tabs and surfaces what the node
// will do with the input: role, description, declared input tags, and
// whether a saved fixture or upstream cache is available. This is the
// "agent constraints" surface — the user knows what to type without
// reading code.
//
// What this component still does NOT do:
//   - It does not write to localStorage; the canvas page owns persistence
//     via `onComplete(nodeId, runCacheEntry)`.
//   - It does not mutate the project's canonical transcript.
//   - It does not currently support cancellation mid-stream beyond closing
//     the modal.

function upstreamAggregate(node, upstreamCache, edges) {
  const ids = (edges ?? []).filter((e) => e.to === node.id).map((e) => e.from);
  const out = {};
  for (const upId of ids) {
    const cached = upstreamCache?.[upId];
    if (cached && cached.output != null) out[upId] = cached.output;
  }
  return out;
}

function fixtureValuesFor(node) {
  if (!node?.fixture || node.fixture.inputs == null) return null;
  return node.fixture.inputs;
}

function declaredInputsOf(node) {
  return Array.isArray(node?.inputs) ? node.inputs.filter(Boolean) : [];
}

function pickInitialMode(node, hasFixture) {
  // Declared inputs → structured. Free-form node → plain. Fixture nudges
  // toward structured if the fixture is structured.
  const declared = declaredInputsOf(node);
  if (declared.length > 0) return "structured";
  const fx = fixtureValuesFor(node);
  if (hasFixture && fx && typeof fx === "object" && !Array.isArray(fx)) {
    return "json";
  }
  return "plain";
}

function buildStructuredInitial(node, upstreamMap) {
  const declared = declaredInputsOf(node);
  const fx = fixtureValuesFor(node);
  const values = {};
  for (const tag of declared) {
    if (fx && typeof fx === "object" && fx[tag] != null) {
      values[tag] = fx[tag];
    } else if (upstreamMap[tag] != null) {
      values[tag] = upstreamMap[tag];
    } else {
      values[tag] = "";
    }
  }
  return values;
}

function buildJsonInitial(node, upstreamMap) {
  const fx = fixtureValuesFor(node);
  if (fx != null) return JSON.stringify(fx, null, 2);
  if (Object.keys(upstreamMap).length > 0) return JSON.stringify(upstreamMap, null, 2);
  return "{}";
}

function buildPlainInitial(node) {
  const fx = fixtureValuesFor(node);
  if (typeof fx === "string") return fx;
  return "";
}

function valueAsString(v) {
  return typeof v === "string" ? v : JSON.stringify(v ?? "", null, 2);
}

export default function SoloRunModal({ project, node, onClose, onComplete }) {
  const upstreamCache = project?.runCache ?? {};
  const edges = project?.canvas?.edges ?? [];

  const declared = declaredInputsOf(node);
  const hasFixture = !!fixtureValuesFor(node);
  const upstreamMap = useMemo(
    () => upstreamAggregate(node, upstreamCache, edges),
    [node, upstreamCache, edges],
  );
  const hasUpstream = Object.keys(upstreamMap).length > 0;

  const [mode, setMode] = useState(() => pickInitialMode(node, hasFixture));
  const [plainText, setPlainText] = useState(() => buildPlainInitial(node));
  const [fieldValues, setFieldValues] = useState(() =>
    buildStructuredInitial(node, upstreamMap),
  );
  const [jsonText, setJsonText] = useState(() => buildJsonInitial(node, upstreamMap));
  const [jsonError, setJsonError] = useState("");

  const [running, setRunning] = useState(false);
  const [bytes, setBytes] = useState(0);
  const [output, setOutput] = useState(null);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState([]);

  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState("");

  const abortRef = useRef(null);
  const suggestAbortRef = useRef(null);

  // Mode switches carry the current input forward so the user can edit the
  // same payload across representations — drafting JSON from scratch is hard,
  // editing it is easy. Plain → JSON wraps the prose as a string; structured
  // → JSON serializes the field map; JSON → structured tries to project keys
  // back onto declared tags; JSON → plain falls back to a stringified blob.
  function switchMode(next) {
    if (next === mode) return;
    if (next === "json") {
      let payload;
      if (mode === "plain") {
        payload = plainText;
      } else {
        payload = { ...fieldValues };
      }
      setJsonText(JSON.stringify(payload, null, 2));
      setJsonError("");
    } else if (next === "structured") {
      if (mode === "json") {
        try {
          const parsed = JSON.parse(jsonText || "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const next2 = {};
            for (const tag of declared) {
              const v = parsed[tag];
              next2[tag] = v == null ? fieldValues[tag] ?? "" : v;
            }
            setFieldValues(next2);
          }
        } catch {
          /* keep current field values */
        }
      } else if (mode === "plain" && declared.length === 1) {
        setFieldValues({ [declared[0]]: plainText });
      }
    } else {
      // next === "plain"
      if (mode === "json") {
        try {
          const parsed = JSON.parse(jsonText || "");
          setPlainText(typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2));
        } catch {
          setPlainText(jsonText);
        }
      } else if (mode === "structured") {
        if (declared.length === 1) {
          setPlainText(valueAsString(fieldValues[declared[0]]));
        } else {
          setPlainText(JSON.stringify(fieldValues, null, 2));
        }
      }
    }
    setMode(next);
  }

  // Reset all derived state when the target node changes.
  useEffect(() => {
    setMode(pickInitialMode(node, hasFixture));
    setPlainText(buildPlainInitial(node));
    setFieldValues(buildStructuredInitial(node, upstreamMap));
    setJsonText(buildJsonInitial(node, upstreamMap));
    setJsonError("");
    setBytes(0);
    setOutput(null);
    setError("");
    setWarnings([]);
    setSuggestNote("");
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Always release any in-flight readers when the modal unmounts.
  useEffect(() => {
    return () => {
      try {
        abortRef.current?.abort();
      } catch {
        /* no-op */
      }
      try {
        suggestAbortRef.current?.abort();
      } catch {
        /* no-op */
      }
    };
  }, []);

  function readInputsForRun() {
    if (mode === "plain") {
      const t = plainText.trim();
      return t === "" ? null : t;
    }
    if (mode === "structured") {
      return { ...fieldValues };
    }
    // json
    if (!jsonText.trim()) return null;
    try {
      const parsed = JSON.parse(jsonText);
      setJsonError("");
      return parsed;
    } catch (err) {
      setJsonError(err.message || "invalid JSON");
      throw err;
    }
  }

  async function run() {
    let inputs;
    try {
      inputs = readInputsForRun();
    } catch {
      return; // jsonError already set
    }

    setRunning(true);
    setBytes(0);
    setOutput(null);
    setError("");
    setWarnings([]);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const storageConfig = loadStorageConfig();
      const res = await fetch("/api/agent/run-node", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project, nodeId: node.id, inputs, storageConfig }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) throw new Error(`run-node returned ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = frame.startsWith("data:") ? frame.slice(5).trim() : frame.trim();
          if (!line) continue;
          let evt;
          try {
            evt = JSON.parse(line);
          } catch {
            continue;
          }
          handleEvent(evt);
        }
      }
    } catch (err) {
      if (err?.name !== "AbortError") setError(err?.message || "request failed");
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  function handleEvent(evt) {
    switch (evt.type) {
      case "warmup-fail":
        setError(evt.error || "ollama warmup failed");
        break;
      case "node-chunk":
        if (typeof evt.bytes === "number") setBytes(evt.bytes);
        break;
      case "node-end":
        setOutput(evt.parsed != null ? evt.parsed : evt.output);
        if (typeof evt.bytes === "number") setBytes(evt.bytes);
        break;
      case "node-error":
        setError(evt.error || "node failed");
        break;
      case "warning":
        setWarnings((w) => [...w, evt.text]);
        break;
      case "complete":
        if (evt.runCacheEntry) onComplete?.(node.id, evt.runCacheEntry);
        break;
      default:
        break;
    }
  }

  function applyFixture() {
    const fx = fixtureValuesFor(node);
    if (fx == null) {
      setSuggestNote("no fixture saved on this node");
      return;
    }
    if (mode === "plain") {
      setPlainText(typeof fx === "string" ? fx : JSON.stringify(fx, null, 2));
    } else if (mode === "structured") {
      const next = {};
      for (const tag of declared) {
        next[tag] = typeof fx === "object" && fx?.[tag] != null ? fx[tag] : fieldValues[tag] ?? "";
      }
      setFieldValues(next);
    } else {
      setJsonText(JSON.stringify(fx, null, 2));
      setJsonError("");
    }
    setSuggestNote("loaded saved fixture");
  }

  function applyUpstream() {
    if (!hasUpstream) {
      setSuggestNote("no upstream cached outputs available");
      return;
    }
    if (mode === "plain") {
      setPlainText(JSON.stringify(upstreamMap, null, 2));
    } else if (mode === "structured") {
      const next = { ...fieldValues };
      for (const tag of declared) {
        if (upstreamMap[tag] != null) next[tag] = upstreamMap[tag];
      }
      setFieldValues(next);
    } else {
      setJsonText(JSON.stringify(upstreamMap, null, 2));
      setJsonError("");
    }
    setSuggestNote("loaded upstream cache");
  }

  function clearInputs() {
    if (mode === "plain") setPlainText("");
    else if (mode === "structured") {
      const blank = {};
      for (const tag of declared) blank[tag] = "";
      setFieldValues(blank);
    } else {
      setJsonText("{}");
      setJsonError("");
    }
    setSuggestNote("");
  }

  function formatJson() {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setJsonError("");
    } catch (err) {
      setJsonError(err?.message || "invalid JSON");
    }
  }

  async function suggest() {
    setSuggesting(true);
    setSuggestNote("");
    const ac = new AbortController();
    suggestAbortRef.current = ac;
    try {
      const res = await fetch("/api/agent/suggest-inputs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ project, nodeId: node.id, mode }),
        signal: ac.signal,
      });
      const json = await res.json();
      if (!json?.ok) {
        setSuggestNote(json?.error || "could not generate a suggestion");
        return;
      }
      const sug = json.suggestion;
      if (mode === "plain") {
        setPlainText(typeof sug === "string" ? sug : JSON.stringify(sug, null, 2));
      } else if (mode === "structured") {
        const next = {};
        for (const tag of declared) {
          const v = sug && typeof sug === "object" ? sug[tag] : null;
          next[tag] = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
        }
        setFieldValues(next);
      } else {
        setJsonText(JSON.stringify(sug, null, 2));
        setJsonError("");
      }
      setSuggestNote("filled with model suggestion");
    } catch (err) {
      if (err?.name !== "AbortError") setSuggestNote(err?.message || "suggest failed");
    } finally {
      setSuggesting(false);
      suggestAbortRef.current = null;
    }
  }

  function close() {
    try {
      abortRef.current?.abort();
    } catch {
      /* no-op */
    }
    try {
      suggestAbortRef.current?.abort();
    } catch {
      /* no-op */
    }
    onClose?.();
  }

  const description =
    typeof node?.description === "string" && node.description.trim()
      ? node.description.trim()
      : null;

  return (
    <div className="solo-run-modal-backdrop" role="dialog" aria-modal="true" aria-label="Solo run">
      <div className="solo-run-modal">
        <header className="solo-run-modal-header">
          <div>
            <div className="studio-eyebrow">Solo run</div>
            <h2 className="solo-run-modal-title">{node.title}</h2>
          </div>
          <button className="tool-btn" type="button" onClick={close} aria-label="Close">
            ×
          </button>
        </header>

        <div className="solo-run-modal-body">
          <section className="solo-run-section solo-run-constraints">
            <div className="solo-run-section-label">What this node expects</div>
            <div className="solo-run-constraint-row">
              <span className="solo-run-chip solo-run-chip-role">{node.role || "agent"}</span>
              {declared.length > 0 ? (
                declared.map((t) => (
                  <span key={t} className="solo-run-chip">
                    {t}
                  </span>
                ))
              ) : (
                <span className="solo-run-chip solo-run-chip-muted">free-form input</span>
              )}
              {hasFixture && (
                <span className="solo-run-chip solo-run-chip-soft">fixture available</span>
              )}
              {hasUpstream && (
                <span className="solo-run-chip solo-run-chip-soft">upstream cache available</span>
              )}
            </div>
            {description && <p className="solo-run-constraint-text">{description}</p>}
          </section>

          <section className="solo-run-section">
            <div className="solo-run-mode-tabs" role="tablist" aria-label="Input mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "plain"}
                className={`solo-run-mode-tab ${mode === "plain" ? "active" : ""}`}
                onClick={() => switchMode("plain")}
              >
                Plain text
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "structured"}
                className={`solo-run-mode-tab ${mode === "structured" ? "active" : ""}`}
                onClick={() => switchMode("structured")}
                disabled={declared.length === 0}
                title={
                  declared.length === 0
                    ? "this node has no declared input tags — use Plain text or Raw JSON"
                    : undefined
                }
              >
                Structured
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "json"}
                className={`solo-run-mode-tab ${mode === "json" ? "active" : ""}`}
                onClick={() => switchMode("json")}
              >
                Raw JSON
              </button>
            </div>

            <div className="solo-run-presets">
              {hasFixture && (
                <button
                  type="button"
                  className="solo-run-preset"
                  onClick={applyFixture}
                  disabled={running}
                >
                  Use saved fixture
                </button>
              )}
              {hasUpstream && (
                <button
                  type="button"
                  className="solo-run-preset"
                  onClick={applyUpstream}
                  disabled={running}
                >
                  Use upstream cache
                </button>
              )}
              <button
                type="button"
                className="solo-run-preset solo-run-preset-suggest"
                onClick={suggest}
                disabled={running || suggesting}
                title="Ask the local model for a realistic example based on this node's role and description"
              >
                {suggesting ? "Suggesting…" : "Suggest"}
              </button>
              {mode === "json" && (
                <button
                  type="button"
                  className="solo-run-preset"
                  onClick={formatJson}
                  disabled={running}
                >
                  Format
                </button>
              )}
              <button
                type="button"
                className="solo-run-preset solo-run-preset-clear"
                onClick={clearInputs}
                disabled={running}
              >
                Clear
              </button>
            </div>

            {mode === "plain" && (
              <>
                <textarea
                  className="solo-run-json"
                  rows={6}
                  value={plainText}
                  onChange={(e) => setPlainText(e.target.value)}
                  placeholder="Type a test query in plain English. The node will receive it as its user input."
                />
                <p className="solo-run-hint">
                  Sent as a string. The runtime appends it to the node prompt as a
                  &ldquo;Solo-run inputs&rdquo; block, so any node accepts it.
                </p>
              </>
            )}

            {mode === "structured" && (
              <>
                {declared.length > 0 ? (
                  <div className="solo-run-fields">
                    {declared.map((tag) => (
                      <label key={tag} className="solo-run-field">
                        <span className="solo-run-field-label">{tag}</span>
                        <textarea
                          className="solo-run-field-input"
                          rows={3}
                          value={valueAsString(fieldValues[tag])}
                          onChange={(e) =>
                            setFieldValues((v) => ({ ...v, [tag]: e.target.value }))
                          }
                          placeholder={`value for ${tag}`}
                        />
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="solo-run-hint">
                    This node has no declared input tags. Switch to Plain text or Raw JSON.
                  </p>
                )}
                <p className="solo-run-hint">
                  One field per declared input tag. Sent as an object keyed by tag name.
                </p>
              </>
            )}

            {mode === "json" && (
              <>
                <textarea
                  className="solo-run-json"
                  rows={8}
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    setJsonError("");
                  }}
                  placeholder='{ "field": "value" }'
                />
                {jsonError && <div className="solo-run-error">JSON: {jsonError}</div>}
                <p className="solo-run-hint">
                  Sent as parsed JSON. Use the &ldquo;Suggest&rdquo; button if you want a
                  fixture-shaped starting point.
                </p>
              </>
            )}

            {suggestNote && <div className="solo-run-note">{suggestNote}</div>}

            {mode !== "json" && (
              <details className="solo-run-wire">
                <summary>Will be sent as</summary>
                <pre className="solo-run-output solo-run-wire-preview">
                  {(() => {
                    try {
                      let payload;
                      if (mode === "plain") {
                        payload = plainText;
                      } else {
                        payload = { ...fieldValues };
                      }
                      return JSON.stringify(payload, null, 2);
                    } catch (err) {
                      return `// preview error: ${err?.message || "unknown"}`;
                    }
                  })()}
                </pre>
                <p className="solo-run-hint">
                  Switch to Raw JSON to edit the wire payload directly.
                </p>
              </details>
            )}
          </section>

          {(running || bytes > 0 || output != null || error) && (
            <section className="solo-run-section">
              <div className="solo-run-section-label">
                Output {running ? "(streaming…)" : ""}
              </div>
              {bytes > 0 && (
                <div className="solo-run-meta">{bytes.toLocaleString()} bytes</div>
              )}
              {output != null && (
                <>
                  <pre className="solo-run-output">
                    {typeof output === "string" ? output : JSON.stringify(output, null, 2)}
                  </pre>
                  {typeof output === "string" && output.includes(TRUNCATION_MARKER_PREFIX) && (
                    <p className="solo-run-hint" data-solo-run-truncated>
                      Output exceeded the cache size cap. The full payload was written to the
                      project working folder; see the marker above for the path.
                    </p>
                  )}
                </>
              )}
              {error && <div className="solo-run-error">{error}</div>}
              {warnings.length > 0 && (
                <ul className="solo-run-warnings">
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>

        <footer className="solo-run-modal-footer">
          <button className="tool-btn" type="button" onClick={close} disabled={running}>
            Close
          </button>
          <button
            className="tool-btn solo-run-go"
            type="button"
            onClick={run}
            disabled={running}
          >
            {running ? "Running…" : "Run"}
          </button>
        </footer>
      </div>

      <style jsx>{`
        .solo-run-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(31, 37, 32, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
          padding: 24px;
        }
        .solo-run-modal {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          width: min(680px, 100%);
          max-height: calc(100vh - 48px);
          display: flex;
          flex-direction: column;
          box-shadow: var(--shadow-lift);
          overflow: hidden;
        }
        .solo-run-modal-header {
          padding: 16px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border);
        }
        .solo-run-modal-title {
          margin: 4px 0 0 0;
          font-size: 18px;
          font-weight: 600;
        }
        .solo-run-modal-body {
          padding: 16px 20px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 18px;
        }
        .solo-run-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .solo-run-section-label {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .solo-run-constraints {
          padding: 12px 14px;
          background: var(--surface-muted);
          border: 1px solid var(--border);
          border-radius: 8px;
          gap: 8px;
        }
        .solo-run-constraint-row {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .solo-run-constraint-text {
          font-size: 12.5px;
          line-height: 1.45;
          color: var(--ink);
          margin: 4px 0 0 0;
        }
        .solo-run-chip {
          font-size: 11px;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          padding: 2px 8px;
          border-radius: 999px;
          background: var(--surface);
          border: 1px solid var(--border);
          color: var(--ink);
        }
        .solo-run-chip-role {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .solo-run-chip-soft {
          background: transparent;
          color: var(--muted);
          border-style: dashed;
        }
        .solo-run-chip-muted {
          color: var(--muted);
          font-style: italic;
        }
        .solo-run-mode-tabs {
          display: inline-flex;
          gap: 0;
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 2px;
          align-self: flex-start;
        }
        .solo-run-mode-tab {
          font-size: 12px;
          padding: 5px 12px;
          border-radius: 6px;
          border: 0;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
        }
        .solo-run-mode-tab.active {
          background: var(--surface);
          color: var(--ink);
          font-weight: 600;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
        }
        .solo-run-mode-tab:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .solo-run-presets {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .solo-run-preset {
          font-size: 11.5px;
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--ink);
          cursor: pointer;
        }
        .solo-run-preset:hover:not(:disabled) {
          background: var(--surface-muted);
        }
        .solo-run-preset:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .solo-run-preset-suggest {
          border-color: var(--accent);
          color: var(--accent);
          font-weight: 600;
        }
        .solo-run-preset-clear {
          color: var(--muted);
        }
        .solo-run-fields {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .solo-run-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .solo-run-field-label {
          font-size: 12px;
          color: var(--muted);
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
        }
        .solo-run-field-input,
        .solo-run-json,
        .solo-run-output {
          width: 100%;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          padding: 8px 10px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--surface-muted);
          color: var(--ink);
          resize: vertical;
          line-height: 1.4;
        }
        .solo-run-output {
          white-space: pre-wrap;
          word-break: break-word;
          max-height: 320px;
          overflow: auto;
          margin: 0;
        }
        .solo-run-hint {
          font-size: 12px;
          color: var(--muted);
          margin: 0;
        }
        .solo-run-note {
          font-size: 11.5px;
          color: var(--muted);
          font-style: italic;
        }
        .solo-run-wire {
          font-size: 12px;
        }
        .solo-run-wire summary {
          cursor: pointer;
          color: var(--muted);
          font-size: 11px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          padding: 4px 0;
          user-select: none;
        }
        .solo-run-wire summary:hover {
          color: var(--ink);
        }
        .solo-run-wire-preview {
          max-height: 180px;
          margin-top: 6px;
          opacity: 0.85;
        }
        .solo-run-meta {
          font-size: 12px;
          color: var(--muted);
        }
        .solo-run-error {
          font-size: 12px;
          color: var(--danger);
          background: var(--danger-soft);
          padding: 6px 10px;
          border-radius: 6px;
        }
        .solo-run-warnings {
          font-size: 12px;
          color: var(--muted);
          margin: 4px 0 0 0;
          padding-left: 18px;
        }
        .solo-run-modal-footer {
          padding: 12px 20px;
          border-top: 1px solid var(--border);
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
        .solo-run-go {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
          font-weight: 600;
        }
        .solo-run-go:hover:not(:disabled) {
          background: var(--accent-strong);
        }
      `}</style>
    </div>
  );
}
