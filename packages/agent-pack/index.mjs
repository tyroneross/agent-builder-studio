// @tyroneross/agent-pack — deterministic agent-spec → installable package engine.
//
// Pure spec→artifacts: buildAgentArtifacts(spec) returns an in-memory file map;
// the filesystem write (writeAgentArtifacts) stays host-side. No LLM in the build
// path. This is the engine extracted from the agent-builder workbench so any host
// (Agent Builder Studio) can produce the full ~34-file bundle from the canonical
// spec — the spec stays the single source of truth; the package is a rebuildable
// projection of it.

export {
  buildAgentArtifacts,
  normalizeSpec,
  findPattern,
  slugify,
  validateSpec,
  toYaml,
} from "./src/generator.js";

export { FRAMEWORKS, PATTERNS, SOURCE_REGISTRY } from "./src/patterns.js";

export {
  HUMAN_CHECKPOINT_NODE_KINDS,
  READINESS_CHECKPOINT_NODE_KINDS,
  SPEC_PROFILE_DEFINITIONS,
  inferSpecProfile,
  profileContractPaths,
  mapToolPermissionTier,
  profileRequires,
} from "./src/spec-profile.js";

export {
  resolveEmittedCapabilities,
  buildComponentModelSection,
  buildPromptingLadderSection,
  detectDocIngest,
  detectRiskSurfaces,
  detectDocProducer,
} from "./src/emitted-capabilities/index.mjs";
