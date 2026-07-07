import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

import * as builderTools from "../index.mjs";

test("barrel exports Node entrypoints and Python subprocess paths", () => {
  assert.equal(typeof builderTools.LocalLLM, "function");
  assert.equal(typeof builderTools.runAgentStructure, "function");
  assert.equal(typeof builderTools.runSandboxSuite, "function");
  assert.equal(typeof builderTools.buildLocalValidationScorecard, "function");
  assert.equal(typeof builderTools.buildTaskMessage, "function");
  assert.equal(typeof builderTools.scoreTask, "function");
  assert.equal(typeof builderTools.aggregateCondition, "function");
  assert.ok(existsSync(builderTools.DOE_ENGINE_PATH));
  assert.ok(existsSync(builderTools.DOE_OBJECTIVES_PATH));
});
