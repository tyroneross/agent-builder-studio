// Pass 15 — in-process registry of pause/resume/cancel controllers for
// step-mode runs.
//
// SSE is a one-way (server → client) channel, so step-through can't be
// driven over the same socket. The browser opens an SSE connection to
// /api/agent/run with `step: true`, the server mints a `runId`, registers
// a controller in this module, and emits `{type: "run-started", runId}`
// as the first event. The browser then POSTs to /api/agent/run/control
// with `{runId, action: "advance" | "skip-to-end" | "cancel"}` to flip
// the gate.
//
// Lifetime: one entry per active step-mode run. Removed when `complete`
// fires or the controller is cancelled. The map is module-local; in a
// multi-instance deployment two clients connecting to different instances
// can't talk to each other's controllers, but Agent Studio is local-first
// so a single Next.js process is the only configuration today.

const _controllers = new Map(); // runId → { advance, skipAll, cancel, gate }

function makeRunId() {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Build a controller. The returned `gate` is a function the runtime calls
// before each level. When `skipAll` is set, the gate resolves immediately
// for every subsequent level. When `cancel` is set, the gate rejects.
export function registerStepController() {
  const runId = makeRunId();
  let advanceResolve = null;
  let cancelReject = null;
  let skipAll = false;
  let cancelled = false;
  let pendingPromise = null;

  function newPending() {
    pendingPromise = new Promise((resolve, reject) => {
      advanceResolve = resolve;
      cancelReject = reject;
    });
    return pendingPromise;
  }
  // Seed the first pending promise so the first level can await it.
  newPending();

  const controller = {
    runId,
    skipAll: () => {
      skipAll = true;
      if (advanceResolve) advanceResolve();
    },
    advance: () => {
      if (advanceResolve) advanceResolve();
    },
    cancel: () => {
      cancelled = true;
      if (cancelReject) cancelReject(new Error("cancelled"));
    },
    gate: async ({ level, nodeIds }) => {
      void level;
      void nodeIds;
      if (skipAll) return;
      if (cancelled) throw new Error("cancelled");
      // Wait for the current pending promise. After resolution, prime a
      // fresh pending so the next level pause waits cleanly.
      try {
        await pendingPromise;
      } finally {
        if (!skipAll && !cancelled) newPending();
      }
    },
    isCancelled: () => cancelled,
  };
  _controllers.set(runId, controller);
  return controller;
}

export function getController(runId) {
  return _controllers.get(runId) || null;
}

export function disposeController(runId) {
  _controllers.delete(runId);
}
