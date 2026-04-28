// POST /api/agent/run
// Body: { project, query, model? }
//   - project: full project object from localStorage (the client owns
//     persistence; the server just runs the graph).
//   - query:   user test query string.
//   - model:   optional Ollama model name override.
//
// Streams Server-Sent Events (`text/event-stream`). Each event line is
// `data: <json>\n\n` matching the runtime's onEvent shape:
//   warmup, warmup-ok, warmup-fail, level-start, node-start, node-chunk,
//   node-end, node-error, warning, complete.
//
// On the `complete` event we attach `runDir` if a working folder was
// configured and writable: artifacts (transcript.json + brief.md) are written
// to <workingFolder>/runs/<isoTimestamp>/.
//
// The same path allowlist as /api/fs/validate + /api/uploads is applied to the
// project's workingFolder before any disk write — defense in depth for a
// single-user local dev tool.

import { promises as fs } from "node:fs";
import path from "node:path";
import { runProject, planExecution } from "../../../lib/agent-runtime.mjs";

export const runtime = "nodejs";

const PERMITTED_PREFIXES = ["/Users/", "/tmp/", "/var/folders/"];

function isPermittedFolder(absolute) {
  return PERMITTED_PREFIXES.some(
    (prefix) => absolute.startsWith(prefix) || absolute + "/" === prefix,
  );
}

// Same allowlist + absolute-path enforcement as /api/uploads.
function resolveWritableRunDir(workingFolder) {
  if (typeof workingFolder !== "string" || workingFolder.length === 0) return null;
  if (!workingFolder.startsWith("/")) return null;
  const abs = path.resolve(workingFolder);
  if (!isPermittedFolder(abs)) return null;
  return abs;
}

function isoStamp() {
  // 2026-04-27T15-32-04-512Z — colons replaced with dashes so this is a safe
  // directory name on every filesystem.
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sseFrame(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const project = body?.project;
  const query = typeof body?.query === "string" ? body.query : "";
  const model = typeof body?.model === "string" && body.model ? body.model : undefined;

  if (!project || !project.canvas || !Array.isArray(project.canvas.nodes)) {
    return Response.json(
      { ok: false, error: "project with canvas.nodes required" },
      { status: 400 },
    );
  }

  // Plan upfront so cycle errors come back as a clean SSE event before any
  // streaming starts, instead of as a torn 200/500.
  let planError = null;
  try {
    planExecution(project);
  } catch (err) {
    planError = err.message || String(err);
  }

  // Pre-compute target run dir if we'll be able to write artifacts.
  const wfAbs = resolveWritableRunDir(project.workingFolder);
  const runDir = wfAbs ? path.join(wfAbs, "runs", isoStamp()) : null;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (evt) => {
        try {
          controller.enqueue(encoder.encode(sseFrame(evt)));
        } catch {
          /* client disconnected */
        }
      };

      // Honor client cancellation. The runtime takes an AbortSignal.
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      request.signal.addEventListener("abort", onAbort);

      try {
        if (planError) {
          send({ type: "node-error", id: null, error: planError });
          send({ type: "complete", transcript: { error: planError }, brief: `# Error\n\n${planError}\n` });
          controller.close();
          return;
        }

        const { transcript, brief } = await runProject({
          project,
          query,
          model,
          baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
          signal: ac.signal,
          onEvent: (evt) => {
            // Attach runDir to the final `complete` event so the UI can show
            // the path. We swallow it on every other event to keep frames lean.
            if (evt.type === "complete") {
              send({ ...evt, runDir });
            } else {
              send(evt);
            }
          },
        });

        // Persist artifacts. Failures here are non-fatal; we surface them as
        // a warning event so the client can show a small badge.
        if (runDir) {
          try {
            await fs.mkdir(runDir, { recursive: true });
            await fs.writeFile(
              path.join(runDir, "transcript.json"),
              JSON.stringify(transcript, null, 2),
              "utf8",
            );
            await fs.writeFile(path.join(runDir, "brief.md"), brief, "utf8");
          } catch (err) {
            send({
              type: "warning",
              text: `could not write run artifacts to ${runDir}: ${err?.message || "write failed"}`,
            });
          }
        } else if (project.workingFolder) {
          send({
            type: "warning",
            text: `working folder "${project.workingFolder}" is not under the permitted root; run artifacts not saved`,
          });
        } else {
          send({
            type: "warning",
            text: "no working folder set on this project — run artifacts not saved",
          });
        }
      } catch (err) {
        send({
          type: "node-error",
          id: null,
          error: err?.message || "run failed",
        });
        send({
          type: "complete",
          transcript: { error: err?.message || "run failed" },
          brief: `# Error\n\n${err?.message || "run failed"}\n`,
          runDir: null,
        });
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
}
