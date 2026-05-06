# Chief of Staff Architecture

## Bottom Line

The app uses a modular local-first architecture: HTTP routes are thin, core
policy owns trust boundaries, rituals own CoS workflows, tools expose
deterministic capabilities, and integrations adapt external systems.

This keeps the current MVP small while giving the future full CoS app room to
grow into weekly review, meeting prep, richer memory, scheduler, and approved
work integrations.

## Current Layer Map

```text
src/
  server/          HTTP routing, request parsing, static assets
  core/            safety policy, workspace, audit log, approvals
  rituals/         daily/weekly/meeting/end-of-day operating workflows
  tools/           deterministic capabilities and permission metadata
  integrations/    Ollama, cloud LLM, calendar, future Apple/Gmail/Outlook/Slack adapters
  lib/             compatibility re-exports only
  public/          browser UI
```

## Dependency Rules

```text
server       -> core, rituals, tools, integrations
rituals      -> core, tools, integrations
tools        -> core, integrations
integrations -> core/policy when needed
core         -> core only
public       -> HTTP APIs only
lib          -> compatibility re-exports only
```

These rules are enforced by `tests/architecture/boundaries.test.mjs`.

## Why This Shape

### Core

Core owns invariants that must not drift:

- local workspace boundaries
- localhost-only network policy
- permission tiers
- audit log
- approval queue
- no-delete and no-overwrite constraints

The model, UI, and future integrations should not be able to bypass core.

### Rituals

Rituals are durable operating workflows, not just prompts:

- `daily-plan`
- `weekly-review`
- `meeting-prep`
- `end-of-day-review`

Each mature ritual should eventually have:

```text
schema.mjs
prompt.mjs
fallback.mjs
render.mjs
run.mjs
evals/
```

This makes each workflow testable without the UI or model provider.

### Tools

Tools are deterministic capabilities with permission metadata. This follows the
same separation encouraged by MCP-style tool design: schemas, structured
outputs, validation, and human confirmation for sensitive actions.

Tool categories:

- workspace and document tools
- task, commitment, decision, people, and meeting tools
- calendar import/export tools
- future system-approved and internet-approved adapters

### Integrations

Integrations are replaceable adapters:

- `model-providers/ollama`
- `model-providers/openai-compatible`
- `calendar/ics`
- future `calendar/apple-calendar`
- future `calendar/outlook`
- future `mail/gmail`
- future `slack`

The current app has no required cloud dependency. The cloud LLM adapter is
optional, configured by environment variables, and only used when the user
selects the cloud provider for a model-backed ritual.

## Memory Architecture

The full CoS should use a two-tier memory model:

1. **Core memory:** small, always-visible profile, current goals, preferences,
   active priorities, and standing constraints.
2. **External memory:** searchable tasks, commitments, decisions, meeting notes,
   people records, learning ledger, and old session notes.

This aligns with MemGPT/Letta-style memory hierarchy: keep the executive summary
in context, keep full history outside context, and retrieve only what a ritual
needs.

## Durable Execution

Long-running rituals should become checkpointable:

```text
run -> steps -> checkpoint -> approval pause -> resume -> audit -> artifact
```

For v1, the approval queue is the durable pause point. Later, each ritual should
persist run state with:

- `run_id`
- `ritual_id`
- `thread_id`
- step list
- model calls
- tool calls
- pending approvals
- final artifacts

## Future Larger Models

Do not collapse the architecture just because future models can read more.
Large-context models reduce retrieval pressure, but they do not replace:

- permission boundaries
- durable state
- audit logs
- tool schemas
- approval gates
- deterministic fallbacks
- modular tests

Future models should receive richer context packets from rituals and tools, not
direct access to the entire app.

## Planned Full CoS Modules

```text
src/core/
  policy/
  workspace/
  approvals/
  memory/
  scheduler/

src/rituals/
  daily-plan/
  weekly-plan/
  weekly-review/
  meeting-prep/
  end-of-day-review/
  open-loop-triage/

src/tools/
  tasks/
  commitments/
  decisions/
  people/
  meetings/
  calendar/
  documents/

src/integrations/
  model-providers/
  calendar/
  reminders/
  email/
  slack/
  filesystem/
```

## Trust Boundary

The app may read configured local CoS state automatically. It may create new
documents inside the CoS workspace. It must not delete files. It must not
overwrite existing user documents. Internet and system integrations require
explicit opt-in and approval.
