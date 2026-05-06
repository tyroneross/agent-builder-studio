# v0 UI Brief: Chief of Staff Agent Console

Design a usable first-screen UI for the local-first Chief of Staff agent.

## Product Context

The app is a standalone local-first Chief of Staff tool for a MacBook Pro. It uses Ollama on localhost by default, supports an optional OpenAI-compatible cloud LLM provider when configured, stores state in `cos-workspace/`, creates daily plans and follow-up drafts, imports and exports `.ics` calendar files, and queues sensitive write actions for approval. Internet, system, email, Slack, Gmail, Outlook, Apple Calendar, delete, and overwrite behaviors are intentionally gated or deferred.

The UI should not be a marketing page. It should be the actual operating console.

## Key Component

The central object is an Agent Operating Contract.

Show it as a compact, inspectable control surface that tells the user:

- Agent identity: Chief of Staff
- Contract version and last checked timestamp
- Runtime: local browser app, local workspace, Ollama provider, optional cloud LLM provider
- Trust boundaries: localhost model calls only, documents created only inside workspace, approvals required for sensitive writes, no deletes
- Inputs required: workspace readiness, goal, notes, schedule text or `.ics`, selected provider, selected model, approval queue
- Tools and rituals available: daily plan, document creation, calendar import/export, approvals, planned memory/tasks/people integrations
- Permissions: read local, draft, ask first, system approved, internet approved, delete blocked

## Two Primary Outputs

### 1. Capability + Readiness Output

Create a scannable readiness panel that answers:

- Which capabilities are implemented, planned, or blocked
- Whether workspace is initialized
- Whether Ollama is reachable
- Which model is selected or recommended
- Whether calendar import/export is ready
- Which actions require approval
- Which actions are blocked by policy

Use clear state labels: Ready, Needs setup, Planned, Approval required, Blocked.

### 2. Action Plan + Approval Output

Create an action workspace that answers:

- What the agent proposes to do next
- Which ritual produced the plan
- What artifact was generated
- Which approval items are pending
- What the user can approve, reject, or inspect
- Whether the system is in deterministic fallback mode or model-assisted mode

The UI should make it obvious that approval is a pause point before sensitive writes, not just a notification.

## Layout Requirements

Create a dense but calm operational dashboard:

- Left sidebar: Agent Operating Contract summary, active runtime, permission legend
- Top status bar: workspace, model, local-only network, approval count
- Main upper area: Capability + Readiness output
- Main lower area: Action Plan + Approval output
- Right rail or lower panel: recent artifacts and audit trail
- Mobile layout: stack sections in the same priority order

## Interaction Requirements

Include controls for:

- Initialize workspace
- Refresh readiness
- Select model
- Toggle deterministic mode
- Generate daily plan
- Import `.ics`
- Export `.ics`
- Approve or reject an approval item
- Open generated document path
- Inspect raw agent contract JSON

## Visual Direction

Use a quiet local-ops aesthetic:

- Light theme by default
- High contrast text
- Professional spacing and small dashboard headings
- No hero section
- No decorative blobs, gradients, or marketing layout
- Stable dimensions for status pills, toolbar controls, and repeated rows
- Prefer tables, segmented controls, inline status chips, and compact panels over large card grids

## Technical Output

Generate code that can be adapted into this existing repo:

- Existing app uses plain `src/public/index.html`, `src/public/styles.css`, and `src/public/app.js`
- Prefer static HTML/CSS/vanilla JS compatible with those files
- Do not introduce a framework unless you clearly isolate the output as a conceptual React draft
- Do not require external services for the UI itself
- Use mock data only where backend endpoints do not exist yet, and label it in code comments as mock data

## Sample Data Shape

```json
{
  "agentContract": {
    "id": "chief-of-staff",
    "version": "0.1.0",
    "runtime": "local-first",
    "modelProvider": "Ollama",
    "trustBoundaries": ["localhost-only model calls", "workspace-scoped writes", "approval-gated sensitive actions", "delete blocked"]
  },
  "readiness": [
    { "name": "Workspace", "status": "Ready", "detail": "cos-workspace initialized" },
    { "name": "Ollama", "status": "Needs setup", "detail": "No local models found" },
    { "name": "Daily plan", "status": "Ready", "detail": "Deterministic fallback available" },
    { "name": "Calendar import/export", "status": "Ready", "detail": ".ics only" },
    { "name": "Slack", "status": "Planned", "detail": "Internet-approved adapter deferred" }
  ],
  "actionPlan": {
    "mode": "deterministic",
    "ritual": "daily-plan",
    "artifact": "documents/daily-plan-2026-05-01.md",
    "steps": [
      { "label": "Read inputs", "status": "completed" },
      { "label": "Generate plan", "status": "completed" },
      { "label": "Queue approvals", "status": "pending" }
    ]
  },
  "approvals": [
    { "id": "approval-1", "kind": "calendar", "title": "Export focus block", "status": "pending", "requiredPermission": "ask-first" }
  ]
}
```
