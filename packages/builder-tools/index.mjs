import { fileURLToPath } from "node:url";

export {
  TASKS,
  buildTaskMessage,
  scoreTask,
  aggregateCondition,
} from "./src/doe/tasks.mjs";
export { LocalLLM } from "./src/sandbox/local-llm.js";
export {
  runAgentStructure,
  runSandboxSuite,
} from "./src/sandbox/runner.js";
export { buildLocalValidationScorecard } from "./src/sandbox/local-validation-scorecard.js";

export const DOE_ENGINE_PATH = fileURLToPath(new URL("./src/doe/doe.py", import.meta.url));
export const DOE_OBJECTIVES_PATH = fileURLToPath(new URL("./src/doe/objectives.py", import.meta.url));
