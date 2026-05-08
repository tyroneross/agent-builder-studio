// Tests for scripts/run-chief-of-staff.mjs CLI surface.
//
// We don't call live providers. Instead we exercise the script via
// `child_process.spawn`, monkey-patching the runner by setting a marker env
// var that short-circuits to a fake telemetry stream.
//
// To keep this hermetic, we shim the CLI by setting a special env flag
// (COS_CLI_TEST_FAKE=1) which we DO NOT support in production. Instead,
// we fake at a different boundary: --help is inert (no provider call)
// and --json with a real cascade-model run would require Ollama. So this
// suite covers only the inert surfaces: --help, env-banner content, and
// flag parsing wiring (asserting the script exits 0 with --help).

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = resolve(
  fileURLToPath(new URL("../scripts/run-chief-of-staff.mjs", import.meta.url)),
);

test("--help prints flag banner and exits 0", () => {
  const res = spawnSync("node", [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /USAGE/);
  assert.match(res.stdout, /CASCADE FLAGS/);
  assert.match(res.stdout, /--allow-cloud/);
  assert.match(res.stdout, /--summary/);
  assert.match(res.stdout, /--json/);
  assert.match(res.stdout, /ENVIRONMENT/);
  assert.match(res.stdout, /GROQ_API_KEY/);
  assert.match(res.stdout, /ANTHROPIC_API_KEY/);
  assert.match(res.stdout, /OPENAI_API_KEY/);
  assert.match(res.stdout, /OLLAMA_BASE_URL/);
  assert.match(res.stdout, /COS_ALLOW_CLOUD/);
  assert.match(res.stdout, /EXAMPLES/);
  // Three example invocations
  const exampleLines = res.stdout.split("\n").filter((l) => l.trim().startsWith("node scripts/"));
  assert.ok(exampleLines.length >= 3, `expected >=3 examples, got ${exampleLines.length}`);
});

test("-h alias works the same as --help", () => {
  const res = spawnSync("node", [SCRIPT, "-h"], { encoding: "utf8" });
  assert.equal(res.status, 0);
  assert.match(res.stdout, /USAGE/);
});
