// /api/artifacts — stage + promote generated agent packages.
//
// GET  ?workingFolder=/abs/path        → { ok, artifacts: [...] }  (the registry)
// POST { action: "stage", workingFolder, name, files }  → { ok, entry }
// POST { action: "promote", workingFolder, id, to? }     → { ok, entry }
//
// Staging writes a git-ignored .artifacts/<type>/<slug>/ under the project's
// workingFolder (same path allowlist as the spec/markdown writers); promotion
// copies the artifact to a standalone "live" folder outside the app (default
// <workingFolder>/promoted/<slug>, or an explicit allowed `to`). The packaging
// itself happens client-side via exportProjectToFullPackage; this route only
// persists + tracks, via @tyroneross/agent-artifacts.

import { stageArtifact, promoteArtifact, listArtifacts } from "@tyroneross/agent-artifacts";

export const runtime = "nodejs";

const PERMITTED_PREFIXES = ["/Users/", "/tmp/", "/var/folders/"];

function isPermittedFolder(absolute) {
  return (
    typeof absolute === "string" &&
    absolute.startsWith("/") &&
    PERMITTED_PREFIXES.some((p) => absolute.startsWith(p))
  );
}

export async function GET(request) {
  const workingFolder = new URL(request.url).searchParams.get("workingFolder");
  if (!isPermittedFolder(workingFolder)) {
    return Response.json({ ok: false, error: "workingFolder not permitted" }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, artifacts: await listArtifacts(workingFolder) });
  } catch (err) {
    return Response.json({ ok: false, error: err?.message || "list failed" }, { status: 500 });
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const { action, workingFolder, name, files, id, to } = body || {};
  if (!isPermittedFolder(workingFolder)) {
    return Response.json({ ok: false, error: "workingFolder not permitted" }, { status: 400 });
  }
  try {
    if (action === "stage") {
      if (!Array.isArray(files) || files.length === 0) {
        return Response.json({ ok: false, error: "files[] required" }, { status: 400 });
      }
      const entry = await stageArtifact(workingFolder, { type: "package", name, files });
      return Response.json({ ok: true, entry });
    }
    if (action === "promote") {
      if (typeof id !== "string") {
        return Response.json({ ok: false, error: "id required" }, { status: 400 });
      }
      if (to != null && !isPermittedFolder(to)) {
        return Response.json({ ok: false, error: "promote target not permitted" }, { status: 400 });
      }
      const entry = await promoteArtifact(workingFolder, id, to ? { to } : {});
      return Response.json({ ok: true, entry });
    }
    return Response.json({ ok: false, error: `unknown action "${action}"` }, { status: 400 });
  } catch (err) {
    return Response.json({ ok: false, error: err?.message || "artifact op failed" }, { status: 500 });
  }
}
