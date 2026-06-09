"use client";

import { useRef, useState } from "react";
import {
  PERMITTED_UPLOAD_ACCEPT,
  PERMITTED_UPLOAD_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  formatSize,
  isPermittedExtension,
  uploadFile,
} from "../lib/uploads";

// Drag-drop + click-to-pick file uploader.
//
// Props:
//   workingFolder: string                 // absolute path; required for upload
//   uploads: Array<{name, size, savedPath, uploadedAt}>
//   onUploaded(record): void              // a successful upload's record
//   onRemoved(savedPath): void            // record-only removal (no disk delete)
//   disabled?: boolean                    // gates the picker + drop zone
//
// Per-file state during upload is local to this component:
//   pending: [{ id, name, size, status: "uploading"|"failed", error? }]
// On success the record is handed up via onUploaded() and the pending entry is
// removed; on failure it stays on the list with its error message until the
// user dismisses it. Folder drag-drop is intentionally not handled — the same
// browser limitation applies as in WorkingFolderInput.
export default function UploadZone({
  workingFolder,
  uploads = [],
  onUploaded,
  onRemoved,
  disabled = false,
}) {
  const [pending, setPending] = useState([]);
  const [isHover, setIsHover] = useState(false);
  const inputRef = useRef(null);

  const isReady = !disabled && !!workingFolder;

  function dispatchFiles(fileList) {
    if (!isReady) return;
    const arr = Array.from(fileList || []);
    for (const file of arr) {
      startUpload(file);
    }
  }

  async function startUpload(file) {
    const id = `up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    // Pre-flight: extension + size. Reject locally so we don't burn a round-trip
    // for an obviously-bad file. The server re-checks both.
    if (!isPermittedExtension(file.name)) {
      setPending((arr) => [
        ...arr,
        { id, name: file.name, size: file.size, status: "failed", error: "extension not permitted" },
      ]);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setPending((arr) => [
        ...arr,
        { id, name: file.name, size: file.size, status: "failed", error: "file exceeds 10MB limit" },
      ]);
      return;
    }
    setPending((arr) => [
      ...arr,
      { id, name: file.name, size: file.size, status: "uploading" },
    ]);
    try {
      const result = await uploadFile({ file, workingFolder });
      if (!result.ok) {
        setPending((arr) =>
          arr.map((p) => (p.id === id ? { ...p, status: "failed", error: result.error || "upload failed" } : p)),
        );
        return;
      }
      // Success — hand the record up and drop the pending entry.
      onUploaded?.({
        name: result.name,
        size: result.size,
        savedPath: result.savedPath,
        uploadedAt: result.uploadedAt,
      });
      setPending((arr) => arr.filter((p) => p.id !== id));
    } catch (err) {
      setPending((arr) =>
        arr.map((p) =>
          p.id === id ? { ...p, status: "failed", error: err?.message || "upload failed" } : p,
        ),
      );
    }
  }

  function dismissPending(id) {
    setPending((arr) => arr.filter((p) => p.id !== id));
  }

  function onDragEnter(e) {
    if (!isReady) return;
    e.preventDefault();
    e.stopPropagation();
    setIsHover(true);
  }
  function onDragOver(e) {
    if (!isReady) return;
    e.preventDefault();
    e.stopPropagation();
    setIsHover(true);
  }
  function onDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsHover(false);
  }
  function onDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setIsHover(false);
    if (!isReady) return;
    // Reject folder drops up front so we don't try to upload directory entries
    // as files. Same browser limitation as WorkingFolderInput.
    const items = e.dataTransfer?.items;
    if (items && items.length > 0) {
      for (const item of Array.from(items)) {
        const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
        if (entry?.isDirectory) {
          // Surface a soft hint via a pending failed row.
          setPending((arr) => [
            ...arr,
            {
              id: `up-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              name: entry.name || "(folder)",
              size: 0,
              status: "failed",
              error: "folder drop not supported — drop individual files",
            },
          ]);
          return;
        }
      }
    }
    dispatchFiles(e.dataTransfer?.files);
  }

  function onPickerChange(e) {
    dispatchFiles(e.target.files);
    // Reset so the same file can be re-added.
    e.target.value = "";
  }

  function onClickZone() {
    if (!isReady) return;
    inputRef.current?.click();
  }

  function onZoneKeyDown(e) {
    if (!isReady) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  }

  return (
    <div className="uploads">
      <span className="panel-label">Files</span>

      <div
        className={`uz-zone ${isHover ? "is-hover" : ""} ${isReady ? "" : "is-disabled"}`}
        role="button"
        tabIndex={isReady ? 0 : -1}
        aria-disabled={!isReady}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onClickZone}
        onKeyDown={onZoneKeyDown}
        data-upload-zone
      >
        <div className="uz-zone-line">
          <strong>Drop files here</strong> or click to pick
        </div>
        <div className="uz-zone-sub">
          {PERMITTED_UPLOAD_EXTENSIONS.join(", ")} · up to {formatSize(MAX_UPLOAD_BYTES)}
        </div>
        {!isReady && (
          <div className="uz-zone-disabled">
            set a valid working folder above to enable uploads
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={PERMITTED_UPLOAD_ACCEPT}
        onChange={onPickerChange}
        disabled={!isReady}
        style={{ display: "none" }}
        data-upload-input
      />

      {(uploads.length > 0 || pending.length > 0) && (
        <ul className="uz-list" data-upload-list>
          {uploads.map((u) => (
            <li key={u.savedPath} className="uz-row" data-upload-row data-upload-saved={u.savedPath}>
              <div className="uz-row-main">
                <span className="uz-name" title={u.savedPath}>{u.name}</span>
                <span className="uz-size">{formatSize(u.size)}</span>
              </div>
              <button
                type="button"
                className="uz-remove"
                onClick={() => onRemoved?.(u.savedPath)}
                title="Remove from project (does not delete from disk)"
                data-upload-remove
              >
                remove
              </button>
            </li>
          ))}
          {pending.map((p) => (
            <li
              key={p.id}
              className={`uz-row uz-row-pending uz-status-${p.status}`}
              data-upload-pending
              data-upload-status={p.status}
            >
              <div className="uz-row-main">
                <span className="uz-name">{p.name}</span>
                <span className="uz-size">
                  {p.status === "uploading" ? "uploading…" : (p.error || "failed")}
                </span>
              </div>
              {p.status === "failed" && (
                <button
                  type="button"
                  className="uz-remove"
                  onClick={() => dismissPending(p.id)}
                  title="Dismiss this error"
                >
                  dismiss
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="uz-foot">
        Removing a file from this list does <em>not</em> delete it from disk. Files live in
        <code> {workingFolder ? `${workingFolder}/uploads/` : "<workingFolder>/uploads/"}</code>.
      </p>

      <style jsx>{`
        .uploads {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .panel-label {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--muted);
        }
        .uz-zone {
          border: 1px dashed var(--border-strong);
          border-radius: 10px;
          padding: 18px 14px;
          background: var(--surface);
          text-align: center;
          color: var(--ink);
          cursor: copy;
          transition: border-color 100ms ease, background 100ms ease;
          outline: none;
        }
        .uz-zone:focus-visible {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-soft);
        }
        .uz-zone.is-hover {
          border-color: var(--accent);
          background: var(--accent-soft);
        }
        .uz-zone.is-disabled {
          background: var(--surface-muted);
          color: var(--faint);
          cursor: not-allowed;
        }
        .uz-zone-line {
          font-size: 13px;
        }
        .uz-zone-sub {
          font-size: 11px;
          color: var(--muted);
          margin-top: 4px;
        }
        .uz-zone-disabled {
          font-size: 11px;
          color: var(--policy);
          margin-top: 6px;
        }
        .uz-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .uz-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 6px 8px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface);
        }
        .uz-row-main {
          display: flex;
          flex-direction: column;
          min-width: 0;
        }
        .uz-name {
          font-size: 13px;
          color: var(--ink);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .uz-size {
          font-size: 11px;
          color: var(--muted);
        }
        .uz-row-pending.uz-status-failed .uz-size {
          color: var(--danger);
        }
        .uz-row-pending.uz-status-uploading .uz-size {
          color: var(--accent-strong);
        }
        .uz-remove {
          flex-shrink: 0;
          height: 26px;
          padding: 0 10px;
          border-radius: 6px;
          border: 1px solid var(--border);
          background: var(--surface);
          font-size: 11px;
          color: var(--muted);
          cursor: pointer;
          font-family: inherit;
        }
        .uz-remove:hover {
          border-color: var(--danger);
          color: var(--danger);
        }
        .uz-foot {
          font-size: 11px;
          color: var(--faint);
          margin: 0;
          line-height: 1.4;
        }
        .uz-foot code {
          font-family: ui-monospace, "SF Mono", Menlo, monospace;
          font-size: 11px;
        }
      `}</style>
    </div>
  );
}
