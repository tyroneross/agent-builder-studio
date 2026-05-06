# Chief of Staff

Standalone local-first Chief of Staff app generated from the Agent Builder
workbench.

## What It Does

- Runs locally on a MacBook Pro.
- Uses Ollama on `localhost` by default, with optional cloud LLM support.
- Keeps all state in a dedicated `cos-workspace/` folder.
- Creates daily plans, follow-up drafts, risks, and approval items.
- Imports and exports `.ics` calendar files.
- Queues write actions for approval.
- Avoids required cloud dependencies.

## Safety Defaults

- Internet access is disabled by default in v1.
- Cloud model calls are disabled until configured with environment variables
  and selected in the UI.
- System-level permissions are not requested.
- Local file reads are limited to data the user pastes or places in the CoS
  workspace.
- New documents are created only inside `cos-workspace/documents/`.
- Existing user documents are not overwritten.
- Delete operations are not implemented.
- Calendar, email, Slack, Gmail, Outlook, and Apple integrations are adapter
  slots only; live writes are deferred.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3031`.

Optional:

```bash
PORT=3031 COS_WORKSPACE_DIR=/path/to/cos-workspace npm start
```

Ollama should be running separately:

```bash
ollama serve
```

Optional cloud LLM support uses an OpenAI-compatible chat completions endpoint.
The app does not call the cloud provider while listing models; it only reads the
model names you configure.

```bash
CLOUD_LLM_PROVIDER_LABEL=OpenAI \
CLOUD_LLM_BASE_URL=https://api.openai.com/v1 \
CLOUD_LLM_API_KEY=... \
CLOUD_LLM_MODEL=... \
npm start
```

For OpenAI specifically, this shorter form also works:

```bash
OPENAI_API_KEY=... OPENAI_MODEL=... npm start
```

Use `CLOUD_LLM_MODELS=model-a,model-b` when you want multiple cloud choices in
the UI.

## Recommended Local Models For 24 GB RAM

Start with one of:

- `qwen3:8b-q4_K_M` for balanced local planning.
- `llama3.2:3b` for fast smoke tests.
- `gpt-oss:20b` if already installed and responsive on your machine.

Avoid making a large model always-on. This app calls the model only when you run
a ritual.

## App Shape

```text
chief-of-staff/
  src/server.mjs          local HTTP entrypoint
  src/server/             routes and request handling
  src/core/               policy, workspace, audit, approvals
  src/rituals/            daily/weekly/meeting operating workflows
  src/tools/              deterministic tool registry
  src/integrations/       Ollama, calendar, future adapters
  src/lib/                compatibility re-exports
  src/public/             browser UI
  tests/                  node:test checks
  docs/architecture.md    product and safety architecture
  sample-data/            sample calendar input
  cos-workspace/          created at runtime, ignored by git
```

## First Use

1. Start the app.
2. Click **Initialize Workspace**.
3. Paste goals, notes, and schedule text or `.ics` contents.
4. Pick an Ollama model, or run deterministic mode by unchecking model use.
   If cloud LLM variables are configured, pick the cloud provider and model.
5. Generate a daily plan.
6. Review approval items before taking any write action.

## Integration Plan

v1 supports pasted schedules and `.ics` import/export.

Next easiest integrations:

1. Apple Calendar export/import files: easiest on macOS because `.ics` works
   without account auth.
2. Apple Reminders via Shortcuts/AppleScript: practical, but needs explicit
   system permission.
3. Outlook calendar via exported `.ics`: easier than live Graph API for work
   laptops.
4. Gmail/Google Calendar: useful but OAuth and work-domain policies add setup.
5. Slack: high value for follow-ups, but should come after approval/audit
   behavior is mature.
