# Dependencies

## Required

### Node.js 22+

Purpose: runtime, local web server, CLI, and built-in SQLite support through `node:sqlite`.

Link: https://nodejs.org/

Check:

```sh
node --version
```

The major version must be `22` or newer.

## Optional

### Ollama

Purpose: local chat model calls and local embedding model calls.

Link: https://ollama.com/

Recommended 24GB MacBook Pro models:

```sh
ollama pull qwen3:14b
ollama pull nomic-embed-text
```

Lower RAM alternatives:

```sh
ollama pull qwen3:8b
ollama pull qwen3:4b
```

Higher RAM alternatives:

```sh
ollama pull qwen3:30b
ollama pull bge-m3
```

### Omniparse

Purpose: local parsing for richer PDFs, spreadsheets, presentations, and code files.

Local path expected by default when available:

```text
/Users/tyroneross/dev/git-folder/Omniparse/packages/sdk/dist/index.mjs
```

Configure:

```sh
export OMNIPARSE_SDK_PATH=/path/to/Omniparse/packages/sdk/dist/index.mjs
```

If this is not configured, the package still runs with internal fallback parsing.

## No npm Runtime Dependencies

`package.json` intentionally has no third-party npm dependencies. The package uses Node built-ins plus optional external tools you install separately.
