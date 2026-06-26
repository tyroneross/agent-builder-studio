# Canvas governance UX — implementation brief

Branch: `feat/canvas-governance-ux` (worktree off `main` @ ddc3954). Merge back when green.

## Goal
The v7 schema + full-package export already carry node `tools`/`permission` and
project `memory`/`validationProfile` (committed in P3a/P4). Today those fields are
**authored programmatically but have no canvas UI**. This branch adds the editing
controls so users can set governance on the canvas — the last piece of "Studio
hosts everything Builder did."

## Scope (build these)
1. **Node right-panel (per-node)** — `app/canvas/page.js` right panel / node editor:
   - **Permission** select: `allow-read | ask-first | deny-by-default | approval-required | allow-write` (writes `node.permission`).
   - **Tools** editor: add/remove rows of `{ name, responsibility, sideEffect, permission }`. `sideEffect ∈ none|read|network|write|shell|destructive` (drives the packager's T0–T5 tier). Writes `node.tools[]`.
   - Show the derived **permission tier** (call `mapToolPermissionTier` from `@tyroneross/agent-pack`) as a read-only chip per tool.
2. **Project settings** — wherever project goal/context/outcome are edited:
   - **Validation profile** select: `skill | personal | team | enterprise` (writes `project.validationProfile`).
   - **Memory** toggles for working/session/persistent (writes `project.memory`).
3. **Export full package** action — wire a button to `exportProjectToFullPackage(project)`
   (already in `app/lib/spec-export.mjs`), then stage the result via
   `@tyroneross/agent-artifacts` `stageArtifact(root, { type: "package", name, files })`,
   and surface a **Promote** action calling `promoteArtifact`.

## Guardrails
- Persist through the existing data layer (`withProjectUpdated` / reducer in `page.js`) so
  `normalizeNode`/`normalizeProject` keep the shape valid; do NOT write localStorage directly
  (the `test:no-hardcoded-storage` guard enforces this).
- Keep the 10-file subset roundtrip green; the new fields already default-match.
- Verify in a running app (IBR / visual pass), not just headless tests — this is UI.

## Done = 
- Canvas can author tools/permission/profile/memory; values survive reload (v7 store).
- "Export full package" produces the 40-file bundle and stages it; promote moves it out.
- `npm test` green + studio build + a visual pass on the new controls.
