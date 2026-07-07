# Sample External Tool

This directory is a SAMPLE external tool for Agent Builder Studio. It is outside
`apps/`, uses the same `agent-tool.json` manifest contract, and can be
registered through the Studio tool registry.

## Run It

From the repo root:

```bash
node examples/sample-external-tool/index.mjs "hello from an external tool"
```

The CLI also accepts stdin:

```bash
printf "hello from stdin" | node examples/sample-external-tool/index.mjs
```

## Register It In Studio

Start Studio, then register the absolute directory path that contains
`agent-tool.json`:

```bash
TOOL_DIR="$(pwd)/examples/sample-external-tool"
curl -X POST http://localhost:3000/api/tools/register \
  -H "content-type: application/json" \
  -d "{\"path\":\"$TOOL_DIR\"}"
```

You can also use the dashboard register form and paste the same absolute path.
After registration, the tool should appear in the tool list as
`Sample External CLI`.

The manifest includes an absolute `entry.path` for this checkout because the
current contract requires external tool paths to start with `/`. If you copy the
sample elsewhere, update `entry.path` to that directory's absolute path before
registering it.

## Validate

```bash
node --test examples/sample-external-tool/test.mjs
node -e "import('@tyroneross/tool-spec').then(m=>{const r=m.loadToolManifest('examples/sample-external-tool');console.log('errors:',JSON.stringify(r.errors))})"
```
