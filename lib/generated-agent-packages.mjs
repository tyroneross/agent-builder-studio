import { resolve } from "node:path";

import { layoutFlowSpec } from "./flow-layout.mjs";
import { GENERATED_AGENTS_DIR } from "./generated-paths.mjs";

export async function listGeneratedAgentStructures(options = {}) {
  const { readdir } = await import("node:fs/promises");
  const root = resolve(options.root ?? process.cwd());
  const generatedRoot = resolve(root, GENERATED_AGENTS_DIR);
  let entries = [];

  try {
    entries = await readdir(generatedRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const structures = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageDir = `${generatedRoot}/${entry.name}`;
    const structure = await readGeneratedAgentStructure(packageDir, root);
    if (structure) structures.push(structure);
  }

  return structures.sort((a, b) => a.label.localeCompare(b.label));
}

export async function readGeneratedAgentStructure(packageDir, root = process.cwd()) {
  try {
    const { readFile } = await import("node:fs/promises");
    const manifest = JSON.parse(await readFile(`${packageDir}/manifest.json`, "utf8"));
    const tools = JSON.parse(await readFile(`${packageDir}/tools.json`, "utf8"));
    const packageManifest = JSON.parse(await readFile(`${packageDir}/agent-package.json`, "utf8"));
    return generatedStructureFromManifest(manifest, tools, packageManifest, root);
  } catch {
    return null;
  }
}

export function generatedStructureFromManifest(manifest = {}, tools = {}, packageManifest = {}, root = process.cwd()) {
  void root;
  const slug = manifest.slug || packageManifest.slug || "generated-agent";
  const spec = layoutFlowSpec({
    projectName: manifest.name || packageManifest.name || slug,
    description: manifest.description || "",
    patternId: manifest.pattern?.id || "solo-tool-agent",
    structureId: `generated:${slug}`,
    runtime: manifest.runtime || "local-nextjs",
    framework: manifest.framework?.id || manifest.framework || "custom-loop",
    modelProvider: manifest.modelProvider || "openai",
    sandbox: manifest.sandbox || "workspace-write",
    autonomy: manifest.pattern?.autonomy,
    nodes: (manifest.graph?.nodes ?? []).map((node) => ({
      ...node,
      description: node.description || node.title || node.id,
      x: Number.isFinite(node.x) ? node.x : undefined,
      y: Number.isFinite(node.y) ? node.y : undefined,
    })),
    edges: manifest.graph?.edges ?? [],
    inputs: manifest.inputs ?? [],
    outputs: manifest.outputs ?? [],
    tools: tools.tools ?? [],
    memory: manifest.memory,
    permissions: manifest.permissions,
    evals: manifest.evals ?? [],
    learning: manifest.learning,
    modelProfiles: manifest.modelProfiles,
    sources: (manifest.sources ?? []).map((source) => source.id).filter(Boolean),
  });

  return {
    id: `generated:${slug}`,
    label: manifest.name || packageManifest.name || slug,
    short: manifest.description || "Generated installable agent package.",
    category: "generated",
    outputDir: packageManifest.canonicalBuilderOutput || `${GENERATED_AGENTS_DIR}/${slug}`,
    spec,
  };
}
