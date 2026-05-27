# Install

## Requirements

Required:

- Node.js 22 or newer.
- npm, normally installed with Node.js.
- A writable local folder for `data/store/`.

Optional:

- Ollama for local LLM generation and local embeddings.
- Omniparse local SDK for richer parsing of PDFs, spreadsheets, presentations, and other structured files.

## Install Steps

From this folder:

```sh
./install.sh
```

This runs:

```sh
npm install --ignore-scripts
mkdir -p data/store
npm run setup:check
```

## Start The Web UI

```sh
npm start
```

Open:

```text
http://localhost:3737
```

## Use Without Ollama

The agent still works without Ollama. It uses:

- deterministic local hash vectors for semantic search
- extractive local summaries
- SQLite text/entity search

Example:

```sh
node bin/local-knowledge-agent.mjs ingest fixtures/sample-notes.txt --no-ollama
node bin/local-knowledge-agent.mjs search "onboarding risk" --no-ollama
```

## Use With Ollama

Install the recommended local models:

```sh
ollama pull qwen3:14b
ollama pull nomic-embed-text
```

Then ingest normally:

```sh
node bin/local-knowledge-agent.mjs ingest fixtures/sample-notes.txt
```

## Use With Omniparse

Set the SDK entrypoint before running ingest:

```sh
export OMNIPARSE_SDK_PATH=/path/to/Omniparse/packages/sdk/dist/index.mjs
```

If Omniparse is absent or fails, the agent falls back to internal parsers.

## Verify

```sh
npm run setup:check
npm run smoke:test
```

The smoke test writes to a temporary directory and does not mutate `data/store/`.

