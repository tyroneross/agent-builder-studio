import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadToolManifest } from "@tyroneross/tool-spec";

const toolDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(toolDir, "index.mjs");

test("agent-tool.json satisfies the tool manifest contract", () => {
  const { manifest, errors } = loadToolManifest(toolDir);

  assert.deepEqual(errors, []);
  assert.equal(manifest.id, "sample-external-cli");
  assert.equal(manifest.type, "cli");
  assert.equal(manifest.entry.kind, "cli");
  assert.equal(manifest.entry.path, toolDir);
});

test("index.mjs summarizes argument input", () => {
  const result = spawnSync(process.execPath, [cliPath, "hello external fixture"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Sample external tool says hello\./);
  assert.match(result.stdout, /Input summary: 3 words received\./);
  assert.match(result.stdout, /Preview: hello external fixture/);
});

test("index.mjs reads stdin when no argument is provided", () => {
  const result = spawnSync(process.execPath, [cliPath], {
    encoding: "utf8",
    input: "hello from stdin",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Input summary: 3 words received\./);
  assert.match(result.stdout, /Preview: hello from stdin/);
});
