# Meetings

Meeting transcript analyzer — local upload → extract → chunk → SQLite + knowledge graph → search.

## Environment setup

Copy `.env.example` to `.env.local` and fill in values before running the dev
server or the test suite:

```
cp apps/meetings/.env.example apps/meetings/.env.local
```

See `.env.example` for the full list of variables (Omniparse SDK path,
Ollama base URL, model names, and local store/DB paths) and their defaults.
`OMNIPARSE_SDK_PATH` is the only one without a working default — without it,
rich document types (xlsx/pptx/pdf/etc.) fall back to internal best-effort
text extraction and the app emits a warning naming the variable.

## Scripts

- `npm run dev --workspace meetings` — start the dev server on port 3032
- `npm run build --workspace meetings` — production build
- `npm test --workspace meetings` — run the test suite (`node --test tests/*.test.mjs`)
