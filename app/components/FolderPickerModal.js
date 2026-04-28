"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PERMITTED_PATH_PREFIXES, looksAbsolutePath } from "../lib/projects";

// FolderPickerModal — server-driven directory picker. Pass 10.
//
// Replaces the native <input webkitdirectory> picker (which macOS labels
// "Upload" — confusing) and the drag-drop folder zone (which can never deliver
// an absolute path in standard browsers). The modal navigates the filesystem
// via /api/fs/list (Node runtime, allowlisted to /Users, /tmp, /var/folders)
// and commits the chosen absolute path on "Use this folder".
//
// Calm Precision rules applied:
//   - Single border around the dialog. Hairline divider between breadcrumb,
//     list, and footer. No per-row borders or backgrounds (signal in text).
//   - One primary action ("Use this folder"); cancel is a text-link.
//   - Hidden entries filtered server-side; max 1000 entries.
//   - No animation flourish. ESC closes; Enter on a row enters it.
//
// Props:
//   - open: boolean
//   - initialPath: string                     // absolute path; we open here
//   - onSelect(absolutePath): void            // user chose; parent commits + closes
//   - onClose(): void                         // dismiss without selection
export default function FolderPickerModal({ open, initialPath, onSelect, onClose }) {
  const [path, setPath] = useState(initialPath || "");
  const [data, setData] = useState(null); // { path, parent, entries }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef(null);
  const useBtnRef = useRef(null);

  const navigate = useCallback(async (next) => {
    if (!next || !looksAbsolutePath(next)) {
      setError("path must be absolute");
      return;
    }
    if (!PERMITTED_PATH_PREFIXES.some((p) => next.startsWith(p))) {
      setError("path outside permitted root (/Users, /tmp, /var/folders)");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/fs/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: next }),
      });
      const json = await res.json();
      if (!json.ok) {
        // Keep the path in the input so the user can correct it; show error.
        setError(json.error || "could not list directory");
        setData(null);
        return;
      }
      setData(json);
      setPath(json.path);
    } catch (err) {
      setError(err?.message || "list failed");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Find the closest existing ancestor of a path that's still inside the
  // allowlist. Used when initialPath points at a not-yet-created project
  // folder ("${HOME}/agent-studio/foo/") — we open the picker at the first
  // existing parent so the user sees something useful.
  const navigateOrAncestor = useCallback(async (start) => {
    let candidate = start;
    // Strip trailing slashes once for the walk.
    if (candidate.endsWith("/") && candidate.length > 1) {
      candidate = candidate.replace(/\/+$/, "");
    }
    // Walk up at most 10 segments to avoid pathological loops.
    for (let i = 0; i < 10; i++) {
      if (!candidate || !PERMITTED_PATH_PREFIXES.some((p) => candidate.startsWith(p) || candidate + "/" === p)) {
        candidate = "/Users";
        break;
      }
      try {
        const res = await fetch("/api/fs/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: candidate }),
        });
        const json = await res.json();
        if (json.ok) {
          setLoading(false);
          setError("");
          setData(json);
          setPath(json.path);
          return;
        }
      } catch {
        /* fall through to walk up */
      }
      // Walk up.
      const idx = candidate.lastIndexOf("/");
      if (idx <= 0) {
        candidate = "/Users";
        break;
      }
      candidate = candidate.slice(0, idx);
    }
    navigate(candidate || "/Users");
  }, [navigate]);

  // Initial load when modal opens.
  useEffect(() => {
    if (!open) return;
    const start = initialPath || "";
    const usable =
      looksAbsolutePath(start) && PERMITTED_PATH_PREFIXES.some((p) => start.startsWith(p))
        ? start
        : `${PERMITTED_PATH_PREFIXES[0]}`; // /Users/ as a sane fallback
    navigateOrAncestor(usable);
  }, [open, initialPath, navigateOrAncestor]);

  // ESC to close; focus the primary action when data arrives.
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (open && data && useBtnRef.current) {
      useBtnRef.current.focus();
    }
  }, [open, data]);

  if (!open) return null;

  // Build breadcrumb segments. Always anchored at "/" (clickable to /Users/).
  const segments = (() => {
    if (!path) return [];
    const parts = path.split("/").filter(Boolean);
    let acc = "";
    return parts.map((p) => {
      acc += "/" + p;
      return { label: p, path: acc };
    });
  })();

  function handleEnterDir(name) {
    const next = path.endsWith("/") ? `${path}${name}` : `${path}/${name}`;
    navigate(next);
  }

  function handleParent() {
    if (data?.parent) navigate(data.parent);
  }

  function handleUse() {
    if (!path) return;
    onSelect?.(path);
  }

  function handleManualSubmit(e) {
    e.preventDefault();
    navigate(path.trim());
  }

  return (
    <div className="fp-overlay" data-folder-picker-modal role="presentation">
      <div
        ref={dialogRef}
        className="fp"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fp-title"
        data-folder-picker-dialog
      >
        <div className="fp-header">
          <h2 id="fp-title" className="fp-title">Select working folder</h2>
          <button
            type="button"
            className="fp-close"
            onClick={onClose}
            aria-label="Close folder picker"
            data-folder-picker-close
          >
            ×
          </button>
        </div>

        <div
          className="fp-path-row"
          data-folder-picker-path-form
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target?.dataset?.folderPickerPathInput !== undefined) {
              handleManualSubmit(e);
            }
          }}
        >
          <nav className="fp-crumbs" data-folder-picker-crumbs aria-label="path breadcrumb">
            <button
              type="button"
              className="fp-crumb fp-crumb-root"
              onClick={() => navigate("/Users/")}
              data-folder-picker-crumb="/"
            >
              /
            </button>
            {segments.map((seg, i) => (
              <span key={seg.path} className="fp-crumb-wrap">
                <span className="fp-crumb-sep" aria-hidden="true">/</span>
                <button
                  type="button"
                  className={`fp-crumb ${i === segments.length - 1 ? "fp-crumb-current" : ""}`}
                  onClick={() => navigate(seg.path)}
                  data-folder-picker-crumb={seg.path}
                >
                  {seg.label}
                </button>
              </span>
            ))}
          </nav>
          <input
            className="fp-path-input"
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                navigate(path.trim());
              }
            }}
            placeholder="/Users/you/path"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            data-folder-picker-path-input
            aria-label="Edit path"
          />
        </div>

        <div className="fp-divider" />

        <ul className="fp-list" data-folder-picker-list>
          {data?.parent && (
            <li className="fp-row fp-row-parent">
              <button
                type="button"
                className="fp-row-btn"
                onClick={handleParent}
                data-folder-picker-parent
              >
                <span className="fp-icon" aria-hidden="true">↑</span>
                <span className="fp-name">..</span>
                <span className="fp-meta">parent</span>
              </button>
            </li>
          )}
          {loading && (
            <li className="fp-row fp-row-status" data-folder-picker-loading>
              <span className="fp-name fp-name-muted">loading…</span>
            </li>
          )}
          {!loading && error && (
            <li className="fp-row fp-row-status" data-folder-picker-error>
              <span className="fp-name fp-name-error">{error}</span>
            </li>
          )}
          {!loading && !error && data && data.entries.length === 0 && (
            <li className="fp-row fp-row-status" data-folder-picker-empty>
              <span className="fp-name fp-name-muted">no subfolders</span>
            </li>
          )}
          {!loading && !error && data && data.entries
            .filter((e) => e.isDirectory)
            .map((e) => (
              <li key={e.name} className="fp-row" data-folder-picker-row data-folder-picker-name={e.name}>
                <button
                  type="button"
                  className="fp-row-btn"
                  onClick={() => handleEnterDir(e.name)}
                  data-folder-picker-enter
                >
                  <span className="fp-icon" aria-hidden="true">📁</span>
                  <span className="fp-name">{e.name}</span>
                </button>
              </li>
            ))}
        </ul>

        <div className="fp-divider" />

        <div className="fp-footer">
          <span className="fp-current" title={path}>{path || "no path"}</span>
          <div className="fp-actions">
            <button
              type="button"
              className="fp-cancel"
              onClick={onClose}
              data-folder-picker-cancel
            >
              cancel
            </button>
            <button
              ref={useBtnRef}
              type="button"
              className="fp-use"
              onClick={handleUse}
              disabled={!path}
              data-folder-picker-use
            >
              Use this folder
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        .fp-overlay {
          position: fixed;
          inset: 0;
          background: rgba(31, 37, 32, 0.32);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 60;
          padding: 24px;
        }
        .fp {
          width: 100%;
          max-width: 560px;
          max-height: 80vh;
          display: flex;
          flex-direction: column;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 12px;
          color: var(--ink);
          overflow: hidden;
        }
        .fp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px 10px;
        }
        .fp-title {
          margin: 0;
          font-size: 15px;
          font-weight: 600;
        }
        .fp-close {
          width: 28px;
          height: 28px;
          border: none;
          background: transparent;
          color: var(--muted);
          font-size: 20px;
          cursor: pointer;
          line-height: 1;
          padding: 0;
        }
        .fp-close:hover { color: var(--ink); }
        .fp-path-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 0 16px 12px;
        }
        .fp-crumbs {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0;
          font-size: 12px;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          color: var(--muted);
        }
        .fp-crumb-wrap {
          display: inline-flex;
          align-items: center;
        }
        .fp-crumb {
          background: transparent;
          border: none;
          padding: 2px 4px;
          color: var(--muted);
          cursor: pointer;
          font: inherit;
          border-radius: 4px;
        }
        .fp-crumb:hover { color: var(--accent-strong); }
        .fp-crumb-current {
          color: var(--ink);
          font-weight: 600;
        }
        .fp-crumb-sep {
          color: var(--faint);
          padding: 0 1px;
        }
        .fp-path-input {
          width: 100%;
          padding: 6px 8px;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 12px;
          color: var(--ink);
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 6px;
          outline: none;
        }
        .fp-path-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .fp-divider {
          height: 1px;
          background: var(--border);
        }
        .fp-list {
          list-style: none;
          margin: 0;
          padding: 4px 0;
          overflow-y: auto;
          flex: 1;
          min-height: 200px;
        }
        .fp-row + .fp-row {
          border-top: 1px solid var(--border);
        }
        .fp-row-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 8px 16px;
          background: transparent;
          border: none;
          font: inherit;
          font-size: 13px;
          color: var(--ink);
          cursor: pointer;
          text-align: left;
        }
        .fp-row-btn:hover {
          color: var(--accent-strong);
        }
        .fp-row-btn:focus-visible {
          outline: 2px solid var(--accent);
          outline-offset: -2px;
        }
        .fp-icon {
          flex-shrink: 0;
          width: 18px;
          font-size: 14px;
          color: var(--muted);
        }
        .fp-name {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fp-name-muted { color: var(--muted); }
        .fp-name-error { color: var(--danger); }
        .fp-meta {
          font-size: 11px;
          color: var(--faint);
        }
        .fp-row-status {
          padding: 10px 16px;
          font-size: 12px;
        }
        .fp-row-parent .fp-icon { color: var(--accent-strong); }
        .fp-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 16px;
        }
        .fp-current {
          flex: 1;
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 11px;
          color: var(--muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .fp-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-shrink: 0;
        }
        .fp-cancel {
          background: transparent;
          border: none;
          padding: 0;
          font: inherit;
          font-size: 13px;
          color: var(--muted);
          cursor: pointer;
        }
        .fp-cancel:hover { color: var(--ink); }
        .fp-use {
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          height: 36px;
          padding: 0 18px;
          border-radius: 8px;
          border: 1px solid var(--accent);
          background: var(--accent);
          color: #ffffff;
          cursor: pointer;
        }
        .fp-use:hover {
          background: var(--accent-strong);
          border-color: var(--accent-strong);
        }
        .fp-use:disabled {
          background: var(--surface);
          color: var(--faint);
          border-color: var(--border);
          cursor: not-allowed;
        }
        .fp-use:focus-visible {
          outline: 2px solid var(--accent-strong);
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}
