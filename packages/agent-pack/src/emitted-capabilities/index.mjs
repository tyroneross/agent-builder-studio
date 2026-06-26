// Emitted-capabilities resolver: conditional tools/skills/files the generator
// attaches to a package when the spec warrants them. One folder per
// capability; this index is the only import surface generator.js uses.
//
//   doc-ingest        item 01 (omniparse; supersedes item 06)
//   threat-modeler    item 04 (risk-surface trigger taxonomy)
//   pyramid-principle item 05 (doc-producing agents)
//   prompting-patterns item 09 (sections, exported separately)

import { detectDocIngest, DOC_INGEST_TOOL, docIngestSkillEntry, buildDocIngestRuntime } from "./doc-ingest.mjs";
import { detectRiskSurfaces, threatModelerSkillEntry, buildThreatModelerSkillMarkdown } from "./threat-modeler.mjs";
import { detectDocProducer, pyramidSkillEntry, buildPyramidSkillMarkdown } from "./pyramid-principle.mjs";

export { buildPromptingLadderSection, buildComponentModelSection } from "./prompting-patterns.mjs";
export { detectDocIngest, detectRiskSurfaces, detectDocProducer };

/**
 * Resolve every conditional capability for a normalized spec.
 *
 * @returns {{
 *   tools: Array<object>,          extra entries for tools.json
 *   skills: Array<object>,         extra skill-bank entries
 *   files: Array<{path:string, content:string}>,  extra package files
 *   dependencies: Record<string,string>,          extra portable package deps
 *   summary: Array<string>,        human-readable emission log
 * }}
 */
export function resolveEmittedCapabilities(spec, manifest) {
  const tools = [];
  const skills = [];
  const files = [];
  const dependencies = {};
  const summary = [];

  const ingest = detectDocIngest(spec);
  if (ingest.needed) {
    tools.push(DOC_INGEST_TOOL);
    skills.push(docIngestSkillEntry(manifest));
    files.push({ path: "runtime/doc-ingest.mjs", content: buildDocIngestRuntime() });
    dependencies["@tyroneross/omniparse"] = "^1.0.0";
    summary.push(`doc-ingest emitted (signals: ${ingest.signals.join(", ")})`);
  }

  const crossed = detectRiskSurfaces(spec);
  if (crossed.length > 0) {
    skills.push(threatModelerSkillEntry(manifest, crossed));
    files.push({ path: "skills/threat-modeler.skill.md", content: buildThreatModelerSkillMarkdown(spec, crossed) });
    summary.push(`threat-modeler emitted (surfaces: ${crossed.map((c) => c.id).join(", ")})`);
  }

  const producer = detectDocProducer(spec);
  if (producer.needed) {
    skills.push(pyramidSkillEntry(manifest));
    files.push({ path: "skills/pyramid-principle.skill.md", content: buildPyramidSkillMarkdown() });
    summary.push(`pyramid-principle emitted (signals: ${producer.signals.join(", ")})`);
  }

  return { tools, skills, files, dependencies, summary };
}
