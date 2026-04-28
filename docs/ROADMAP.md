# Agent Studio — Roadmap

> Drafted 2026-04-28 after Pass 12. Frames the next ~5 build-loop passes as a coherent sequence with the **discrete-event-simulation (DES)** workbench as the centerpiece, with the four previously queued items absorbed into the same plan.

## Bottom line

We are turning the canvas from a single-shot "run the whole graph" tool into a **discrete-event simulation workbench** for agents. Each agent node is a discrete event. The user can run the chain end to end (today), step through the chain one level at a time (new), run any single node in isolation with hand-fed inputs (new), inspect every node's input and output after a run (new), and replay any single node from a saved transcript (new). The model is the same Arena / AnyLogic mental model: entities flow through the system, processes consume entities and emit outputs, every event is timestamped and inspectable.

The four items previously queued (lasso + group drag, LLM-inferred dependencies, generic agent-spec exporter, multi-agent compose) absorb cleanly into this DES framing and are sequenced below.

## Scope of this roadmap

| Pass | Theme | Output |
|---|---|---|
| 13 | UI polish — selection model upgrade | Lasso + group drag on canvas |
| 14 | DES foundation — single-node execution | "Solo run" mode + per-node input fixtures |
| 15 | DES inspection + step mode | Run trace inspector + step-through chain |
| 16 | DES intelligence — auto-ordering | LLM-inferred dependencies when graph is sparse |
| 17 | Spec export | Write `agent.yaml` + `tools.json` + `system-prompt.md` to working folder |
| 18 | Multi-agent compose | One project can call another as a sub-agent |

Each pass is independent enough to launch as a separate `/build-loop:build-loop` invocation. They share state through the existing project model and DAG runtime.

---

## Pass 13 — Lasso + group drag

### Why now

User-paused at start of session. Quick win before the heavier DES work. Improves usability for graphs >10 nodes which DES will encourage (more nodes per project once people start composing chains).

### Design

- Drag on empty canvas with **Shift held** starts a rubber-band rectangle.
- On release, every node whose center falls inside the rectangle joins a `selectedIds: Set<string>` selection model.
- Drag any selected node moves all selected nodes together. Edges follow.
- Click empty space clears selection.
- Delete-key removes all selected nodes (with cascading edge cleanup) after a single confirm.

### Acceptance

1. Shift-drag draws a visible bounding rect; on release, nodes inside are highlighted.
2. Drag any selected node translates all selected by the same delta.
3. Existing single-node drag, click-to-expand, port-drag-to-connect still work unchanged.
4. Persistence: positions of all selected nodes save on group-drag-end.
5. Pass 1-12 regressions all pass.

### Build-loop passes: **1**.

---

## Pass 14 — DES foundation — single-node execution

### Why now

Foundation for the rest of the DES workbench. Without solo execution there's no meaningful "isolate one agent" capability.

### Design

Three new concepts:

**1. Per-node input fixture.** Each node gets an optional `fixture: { inputs: any, source: "manual" | "upstream-cache" }`. Saved on the node, persisted with the project.

**2. Solo run.** Right-click a node or use a "Run solo" button in the side panel. Opens a small modal:
- If the node declares `inputs[]`, render one input field per declared input.
- If no declarations, render a single JSON textarea pre-populated with the node's last `fixture.inputs` if any, else empty.
- "Pull from upstream cache" button: if the node's upstream nodes have run before in this session, auto-fill their last outputs as inputs.
- "Run" button: executes only this node, streams the response, writes the output to a per-node cache (`projects[i].canvas.runCache[nodeId] = { input, output, ts }`).

**3. Per-node run cache.** Lives in localStorage with the project. Visible in the side panel. Cleared on demand via a "Clear cache" toolbar action.

### Acceptance

1. Right-click a node shows "Run solo" entry. Side panel has a "Run solo" button.
2. Modal renders correct inputs based on declarations.
3. "Pull from upstream cache" works when upstream nodes have cached outputs.
4. Solo run streams output via the same SSE pattern as full runs, but only for the chosen node.
5. Run cache persists across reload.
6. Solo run does NOT mutate the project's canonical transcript; it writes to runCache only.
7. Pass 1-13 regressions all pass.

### Build-loop passes: **1-2**.

---

## Pass 15 — DES inspection + step mode

### Why now

Once solo execution exists, the user needs to see what happened during a chain run, and to advance level-by-level when debugging. This is the inspector + debugger.

### Design

**Run trace inspector.** Today the runtime writes `transcript.json` to disk. Add a UI:
- After a run completes, the canvas shows a small "Inspect last run" badge in the toolbar.
- Clicking any node on the canvas opens a panel showing that node's record from the most recent transcript:
  - System prompt sent
  - User message sent
  - Raw text response
  - Parsed JSON output
  - Duration
  - Bytes
  - Error if any
- The panel has a "Replay this node" button that re-runs only that node with the same inputs. Useful for verifying a prompt edit without re-running the chain.

**Step-through mode.** New "Step run" button next to the existing "Run" button.
- On click, the runtime starts but pauses after each DAG level emits its `level-end` event.
- A "Next level" button advances to the next batch.
- "Skip to end" runs the rest non-stop.
- "Cancel" aborts.
- Level-by-level advancement is the discrete-event step. Inside a level, nodes still parallelize (cap 4).

**Per-node mock output.** Right-click a node → "Set mock". Opens a JSON textarea. Saved on the node as `mockOutput: any`. When set, the runtime emits the mock instead of calling Ollama for that node, marks the event as `mocked: true`. Useful for testing downstream without burning tokens.

### Acceptance

1. After a chain run, clicking a node opens an inspector panel with the system+user prompts, raw response, parsed output, duration.
2. "Replay this node" re-runs just that node and updates the panel.
3. "Step run" pauses after each level; "Next level" advances; "Skip to end" runs without pausing further; "Cancel" aborts mid-step.
4. Setting a mock output on a node bypasses Ollama for that node and the event is tagged `mocked: true` in the transcript.
5. Mocked nodes still appear in the inspector with their mock as the parsed output.
6. Pass 1-14 regressions all pass.

### Build-loop passes: **2**.

---

## Pass 16 — DES intelligence — auto-ordering

### Why now

Today the runtime topologically sorts on explicit edges + declared `inputs`/`outputs`. When neither is present, it warns and runs everything in parallel. With the DES workbench in place, users will increasingly draw graphs with implicit data flow that the model can infer.

### Design

When the graph has nodes with no edges and no `inputs`/`outputs` declarations, before execution:
- Make one extra LLM call passing every node's `{ id, role, title, description, instructions }`.
- Prompt the model to return a JSON array of edges it would draw based on data flow inferred from descriptions: `[{ from, to, reason }]`.
- Show the inferred edges as **dashed ghost edges** on the canvas with a banner: "Inferred order. Click to accept or edit."
- "Accept" promotes them to real edges. "Decline" runs in parallel as today.
- Inferred edges are saved per-run; they don't auto-write to the project unless the user accepts.

### Acceptance

1. Graph with explicit edges runs as today, no inference call.
2. Graph with no edges and `inputs`/`outputs` declared uses declarations, no inference call.
3. Graph with no edges and no declarations triggers the inference call. Banner appears.
4. "Accept" persists edges to the project.
5. "Decline" runs in parallel, original behavior.
6. Inference call uses Ollama with `format:json`. Falls back to parallel mode on failure.
7. Pass 1-15 regressions all pass.

### Build-loop passes: **1**.

---

## Pass 17 — Spec export

### Why now

The DES workbench produces well-defined per-node behavior. Other tools (agent-builder, build-loop, external runtimes) want to consume that behavior as portable spec files. Today the studio's project state lives only in the studio. This pass makes it portable.

### Design

New toolbar action: **Export agent spec**. Writes to the project's working folder:

```
<workingFolder>/spec/
  agent.yaml         # name, description, runtime, framework, autonomy, inputs, outputs
  manifest.json      # tool registry, permissions, sandbox tier
  system-prompt.md   # composed from role templates + node instructions
  tools.json         # tool descriptions per node that uses them
  evals/golden-tasks.json  # turned from the project's run history
  README.md          # summary + how to consume
```

Format mirrors `agent-builder/lib/build-files.js` so the spec can be picked up by the agent-builder generator without changes.

A second mode: **Import agent spec** lets the studio open a spec directory and reconstruct nodes/edges from it. Cycle-test: studio export → studio import produces the same graph.

### Acceptance

1. "Export agent spec" writes the six files atomically to `<workingFolder>/spec/`.
2. The exported `agent.yaml` validates against the agent-builder schema.
3. "Import agent spec" lets the user pick a spec directory; the canvas loads the graph.
4. Round-trip: export then import produces the same nodes/edges/instructions.
5. Pass 1-16 regressions all pass.

### Build-loop passes: **1-2**.

---

## Pass 18 — Multi-agent compose

### Why now

Last item in the roadmap. Once specs are portable and DES can run pieces in isolation, the natural next step is letting one project invoke another as a sub-agent. This unlocks compositions like "research agent → writing agent → eval agent" where each sub-agent is its own project with its own canvas, working folder, role overrides.

### Design

New node type: **`subagent`**. A node whose `role: "subagent"` carries `subagentProjectId: string`. When the runtime hits a subagent node:
- Resolves the project by id (must be in the same studio store).
- Recursively runs that project against Ollama with the parent node's inputs as the sub-project's inputs.
- The subagent's full transcript becomes the subagent node's output.
- DES inspection drills into the subagent's transcript (clickable).

Visual: subagent nodes render with a distinct double border and a "↳ <project name>" label.

Cycle prevention: a project cannot directly or indirectly call itself. Detected and rejected at run time.

### Acceptance

1. New role `subagent` available in the side-panel role dropdown.
2. When `subagent` is selected, a project picker appears, choosing from the studio's projects.
3. Running a graph with a subagent node runs the inner project and inlines its output.
4. The inspector panel for a subagent node opens a nested view of the inner project's transcript.
5. Self-referential cycles are detected with a clear error message before any LLM call.
6. Pass 1-17 regressions all pass.

### Build-loop passes: **2**.

---

## Sequencing rationale

| Pass | Why it goes here |
|---|---|
| 13 — Lasso | Quick win, blocks nothing. UI polish lifts the rest. |
| 14 — Solo run | Foundation for DES. Without it, "discrete event" isolation isn't possible. |
| 15 — Inspect + step | DES core. Inspection makes solo + chain runs useful as debugging tools. |
| 16 — Inferred order | Once inspection exists, the user can verify inferred edges visually. Bad time to ship inference without an inspector. |
| 17 — Spec export | Independent of DES. Could be earlier, but waits for nodes to carry richer per-node state (mocks, fixtures) so the export captures everything. |
| 18 — Multi-agent | Last because it depends on solid runtime, spec round-trip, and inspection (so users can drill into sub-agent runs). |

---

## Open questions for the user

The following choices materially affect what gets built. Worth answering before launching Pass 14.

**Q1. Solo-run inputs — auto-pull or always manual?**
Default: when a node's upstream nodes have cached outputs in `runCache`, the solo modal pre-fills those as inputs but lets the user override. Alternative: always show empty fields, force the user to think about them.

**Q2. Mock outputs — per-project or per-node?**
Per-node is simpler. Per-project lets you save a "test fixture" for the whole graph and switch between fixtures. Recommend per-node for v1.

**Q3. Step mode granularity — per level, or per node within a level?**
Per level keeps DAG semantics (parallel siblings run together). Per node would require serializing within a level. Recommend per level.

**Q4. Spec export format — agent-builder compatible only, or also OpenAgents / standard formats?**
Agent-builder compat is concrete and validates today. OpenAgents standards are still drafty. Recommend agent-builder for v1, defer OpenAgents.

**Q5. Subagent recursion — same store only, or remote URL?**
Same store keeps everything local and inspectable. Remote URL means fetching another studio's project over the network. Recommend same store for v1; remote later.

---

## Risks

- **Inference-call cost.** Pass 16 adds an extra LLM round-trip whenever a graph is sparse. Cap at one inference per run; cache by graph hash so identical graphs don't re-infer.
- **Solo-run UX with undeclared inputs.** When `inputs[]` isn't declared, the JSON textarea is unfriendly. Mitigation: auto-suggest a JSON shape from the node's role template.
- **Inspector scrolling.** A 20-node graph produces 20 inspector entries. Mitigation: virtualize the per-node panel list, or lazy-render only on click.
- **Multi-agent compose context size.** A subagent's full transcript inlined into the parent prompt can blow context. Mitigation: pass only the parsed output, not raw text. Surface a "show full transcript" link in the inspector.
- **Backward compatibility.** Each pass extends the project model. Storage version bumps from `agent-studio:v4` upward. Migration paths must chain (v4 → v5 → v6 ...) so legacy users keep their data.

---

## Out of scope for this roadmap

These came up in earlier conversation but are not in this five-pass plan. Tracked here so they don't get lost.

- **NavGator detection of Ollama via raw fetch.** Tooling gap; report it to NavGator, not a code fix in this repo.
- **`gpt-oss:20b` self-consistency check** vs the `llama3.2:3b` test used in Pass 6. Run `OLLAMA_MODEL=gpt-oss:20b npm run test:self` ad-hoc.
- **iOS / mobile companion app.** Web-first for now.
- **Cloud-backed multi-user mode.** Local-first by design; multi-user is a different product.

---

## How to launch a pass

In a fresh Claude Code session at `~/dev/git-folder/agent-studio/`:

```
/build-loop:build-loop run pass <N> from docs/ROADMAP.md
```

The orchestrator reads this doc, picks the section for that pass, and follows its acceptance criteria. Each pass commits and reports back. Push manually after each pass or every few passes. Use `npm run test:self` to confirm runtime regression after any runtime-touching pass (14, 15, 16, 18).

---

_Last updated 2026-04-28. After Pass 12, before Pass 13. Repo: https://github.com/tyroneross/agent-studio._
