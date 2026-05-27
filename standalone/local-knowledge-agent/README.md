# Local Knowledge Agent

Standalone local agent for document ingest, SQLite storage, vector retrieval, knowledge graph extraction, and editable rich-text output.

This folder is independent of Agent Builder. Copy or zip the whole `local-knowledge-agent/` folder and install it on another machine with Node.js 22+.

## What It Does

- Upload or ingest multiple local files.
- Parse text, Markdown, CSV/TSV, JSON, RTF, PDF best-effort, and printable text.
- Use Omniparse when `OMNIPARSE_SDK_PATH` points to a local SDK entrypoint.
- Store chunks in `data/store/store.json`.
- Store documents, chunks, entities, relations, and runs in `data/store/knowledge.db`.
- Retrieve with `hybrid`, `semantic`, or `sql` search.
- Use Ollama for local chat and embeddings when available.
- Fall back to deterministic local hash vectors and extractive summaries when Ollama is unavailable.

## Quick Start

```sh
./install.sh
npm start
```

Open `http://localhost:3737`.

## CLI

```sh
npm run setup:check
node bin/local-knowledge-agent.mjs ingest fixtures/sample-notes.txt --no-ollama
node bin/local-knowledge-agent.mjs search "SQL search onboarding" --mode hybrid --no-ollama
node bin/local-knowledge-agent.mjs stats
```

## Storage

Runtime data is local and ignored by git:

```text
data/store/store.json
data/store/knowledge.db
```

## Model Defaults

For a 24GB Apple Silicon MacBook Pro, the recommended default is:

- Chat: `qwen3:14b`
- Embeddings: `nomic-embed-text`
- Context: `32768`
- Temperature: `0.1`

RAM profiles are defined in `src/model-profiles.mjs`.

## Package Contract

Install this folder as a unit. The package root contains:

- `install.sh` - local installer and setup check.
- `package.json` - scripts and Node engine contract.
- `bin/local-knowledge-agent.mjs` - CLI entrypoint.
- `src/agent.mjs` - ingest, storage, retrieval, graph, and output runtime.
- `src/server.mjs` - dependency-free local web UI.
- `local-knowledge-agent.agent.json` - portable manifest.
- `DEPENDENCIES.md` - dependency links and optional model installs.

