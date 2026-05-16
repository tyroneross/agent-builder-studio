import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentArtifacts, slugify } from "../lib/generator.js";
import { writeAgentArtifacts } from "../lib/build-files.js";
import { PATTERNS } from "../lib/patterns.js";
import { findAgentStructure } from "../agent-structures/index.js";

async function makeTestRoot(prefix) {
  const base = process.env.AGENT_BUILDER_TMPDIR || join(process.cwd(), ".tmp");
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, prefix));
}

test("slugify returns a safe stable folder name", () => {
  assert.equal(slugify("Research Agent: OpenAI + Claude"), "research-agent-openai-claude");
  assert.equal(slugify("../Bad Name"), "bad-name");
  assert.equal(slugify(""), "agent");
});

test("all bundled patterns generate the core artifact set", () => {
  for (const pattern of PATTERNS) {
    const result = buildAgentArtifacts({ patternId: pattern.id, projectName: pattern.name }, { createdAt: "test" });
    const paths = result.files.map((file) => file.path).sort();
    assert.deepEqual(paths, [
      "INSTALL.md",
      "README.md",
      "agent-package.json",
      "agent.yaml",
      "context/input-contract.md",
      "evals/golden-tasks.json",
      "evals/regression-scenarios.json",
      "manifest.json",
      "memory/domain-playbook.md",
      "memory/learning-ledger.json",
      "package.json",
      "prompts/prompt-builder-contract.md",
      "runtime/README.md",
      "runtime/adapter-contract.md",
      "runtime/adapters/claude-subagents.md",
      "runtime/adapters/custom-loop.md",
      "runtime/adapters/deepagents.md",
      "runtime/adapters/langgraph.md",
      "runtime/adapters/nvidia-nemo-agent-toolkit.md",
      "runtime/adapters/openai-agents-sdk.md",
      "runtime/adapters/pydantic-ai.md",
      "runtime/custom-loop-adapter.mjs",
      "scripts/setup-check.mjs",
      "setup/env.example",
      "setup/install-checklist.md",
      "setup/local-models.md",
      "setup/requirements.json",
      "setup/vector-store.md",
      "sources.md",
      "system-prompt.md",
      "tools.json",
    ]);
    assert.match(result.files.find((file) => file.path === "agent.yaml").content, /permissions:/);
    assert.match(result.files.find((file) => file.path === "tools.json").content, /inputSchema/);
    assert.match(result.files.find((file) => file.path === "prompts\/prompt-builder-contract.md").content, /Prompt Builder Invocation/);
  }
});

test("writer creates files only inside generated agents folder", async () => {
  const root = await makeTestRoot("agent-builder-test-");
  try {
    const result = await writeAgentArtifacts(
      {
        patternId: "solo-tool-agent",
        projectName: "Local Agent",
        description: "A local test agent.",
      },
      { root },
    );

    assert.equal(result.outputDir, "generated/agents/local-agent");
    assert.equal(result.outputRoot, "generated/agents");
    assert.equal(result.installableDir, "generated/agents/local-agent");
    const packageManifest = JSON.parse(await readFile(join(root, result.outputDir, "agent-package.json"), "utf8"));
    const packageJson = JSON.parse(await readFile(join(root, result.outputDir, "package.json"), "utf8"));
    const requirements = JSON.parse(await readFile(join(root, result.outputDir, "setup/requirements.json"), "utf8"));
    const manifest = await readFile(join(root, result.outputDir, "manifest.json"), "utf8");
    const install = await readFile(join(root, result.outputDir, "INSTALL.md"), "utf8");
    const inputContract = await readFile(join(root, result.outputDir, "context/input-contract.md"), "utf8");
    const envExample = await readFile(join(root, result.outputDir, "setup/env.example"), "utf8");
    const setupCheck = await readFile(join(root, result.outputDir, "scripts/setup-check.mjs"), "utf8");
    const runtimeAdapter = await readFile(join(root, result.outputDir, "runtime/custom-loop-adapter.mjs"), "utf8");
    const runtimeGuide = await readFile(join(root, result.outputDir, "runtime/adapters/custom-loop.md"), "utf8");
    const tools = await readFile(join(root, result.outputDir, "tools.json"), "utf8");
    assert.equal(packageManifest.schemaVersion, "agent-builder.package.v1");
    assert.equal(packageManifest.selfContained, true);
    assert.equal(packageManifest.canonicalBuilderOutput, "generated/agents/local-agent");
    assert.equal(packageManifest.copyPolicy, "copy-directory-as-unit");
    assert.equal(packageJson.scripts["setup:check"], "node scripts/setup-check.mjs");
    assert.equal(packageJson.scripts["runtime:check"], "node runtime/custom-loop-adapter.mjs --fixture");
    assert.equal(requirements.schemaVersion, "agent-builder.setup-requirements.v1");
    assert.ok(requirements.requiredFiles.includes("setup/requirements.json"));
    assert.ok(requirements.requiredFiles.includes("runtime/adapter-contract.md"));
    assert.match(manifest, /"schemaVersion": "agent-builder.v1"/);
    assert.match(install, /Copy the entire `generated\/agents\/local-agent\/` folder/);
    assert.match(inputContract, /Required Inputs/);
    assert.match(envExample, /AGENT_PACKAGE_ROOT=/);
    assert.match(setupCheck, /missingFiles/);
    assert.match(runtimeAdapter, /runFixture/);
    assert.match(runtimeGuide, /Custom loop Adapter Guide/);
    assert.match(tools, /"schemaVersion": "agent-builder.tools.v1"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("earnings Webex structure preserves local draft and provenance contracts", () => {
  const structure = findAgentStructure("earnings-webex-draft-agent");
  assert.ok(structure);

  const result = buildAgentArtifacts(structure.spec, { createdAt: "test" });
  const manifest = JSON.parse(result.files.find((file) => file.path === "manifest.json").content);
  const tools = JSON.parse(result.files.find((file) => file.path === "tools.json").content);
  const prompt = result.files.find((file) => file.path === "system-prompt.md").content;
  const promptContract = result.files.find((file) => file.path === "prompts/prompt-builder-contract.md").content;
  const readme = result.files.find((file) => file.path === "README.md").content;
  const sources = result.files.find((file) => file.path === "sources.md").content;

  assert.equal(manifest.modelProvider, "ollama");
  assert.equal(manifest.runtime, "local-sandbox");
  assert.equal(manifest.framework.id, "custom-loop");
  assert.equal(manifest.modelProfiles.hardwareTarget, "24GB Apple Silicon MacBook Pro");
  assert.equal(manifest.modelProfiles.primary.model, "qwen3:14b");
  assert.ok(manifest.inputs.includes("pasted_earnings_pdf_text"));
  assert.ok(manifest.inputs.includes("pasted_ppt_text"));
  assert.ok(manifest.outputs.includes("webex_paste_ready_update"));
  assert.ok(manifest.outputs.includes("quality_check"));
  assert.ok(!manifest.graph.nodes.some((node) => node.kind === "approval"));
  assert.equal(manifest.prompting.source, "prompt-builder");
  assert.equal(manifest.prompting.contractFile, "prompts/prompt-builder-contract.md");
  assert.ok(manifest.evals.some((item) => item.name === "no-webex-side-effect"));
  assert.ok(manifest.evals.some((item) => item.name === "source-provenance-required"));

  assert.ok(!tools.tools.some((tool) => tool.name.includes("webex_thread_reply")));
  assert.ok(tools.tools.every((tool) => tool.sideEffect === "none"));
  assert.match(prompt, /Local Model Profile/);
  assert.match(prompt, /qwen3:14b/);
  assert.match(prompt, /copy-paste-ready update/);
  const requirements = JSON.parse(result.files.find((file) => file.path === "setup/requirements.json").content);
  const localModels = result.files.find((file) => file.path === "setup/local-models.md").content;
  const envExample = result.files.find((file) => file.path === "setup/env.example").content;
  assert.equal(requirements.localModels.required, true);
  assert.equal(requirements.localModels.runner, "Ollama");
  assert.match(localModels, /ollama run qwen3:14b/);
  assert.match(envExample, /OLLAMA_BASE_URL=http:\/\/localhost:11434/);
  assert.match(promptContract, /STATE SCHEMA/i);
  assert.match(promptContract, /TOOL REGISTRY/i);
  assert.match(promptContract, /Skill And Plugin Prompt Requirements/);
  assert.match(promptContract, /OpenAI/);
  assert.match(promptContract, /Anthropic/);
  assert.match(promptContract, /Perplexity/);
  assert.match(readme, /draft-only/);
  assert.match(readme, /does not send messages/);
  assert.match(sources, /Prompt Builder Caller Contract/);
  assert.match(sources, /OpenAI Prompt Guidance/);
  assert.match(sources, /Anthropic Prompting Best Practices/);
  assert.match(sources, /Perplexity Prompt Guide/);
  assert.match(sources, /Ollama Qwen3 Models/);
  assert.match(sources, /Ollama Gemma 3 Models/);
  assert.doesNotMatch(sources, /Webex Messaging MCP Server/);
});

test("investment opportunity structure captures scoring, validation, dashboard, and markdown recall", () => {
  const structure = findAgentStructure("investment-opportunity-agent");
  assert.ok(structure);

  const result = buildAgentArtifacts(structure.spec, { createdAt: "test" });
  const manifest = JSON.parse(result.files.find((file) => file.path === "manifest.json").content);
  const tools = JSON.parse(result.files.find((file) => file.path === "tools.json").content);
  const prompt = result.files.find((file) => file.path === "system-prompt.md").content;
  const readme = result.files.find((file) => file.path === "README.md").content;

  assert.equal(manifest.structureId, "investment-opportunity-agent");
  assert.equal(manifest.runtime, "local-nextjs");
  assert.equal(manifest.sandbox, "local-sandbox-approved-web-research");
  assert.ok(manifest.inputs.includes("deal_material_files"));
  assert.ok(manifest.inputs.includes("deal_folder_selection"));
  assert.ok(manifest.inputs.includes("llm_wiki_investment_notes"));
  assert.ok(manifest.outputs.includes("claim_validation_table"));
  assert.ok(manifest.outputs.includes("upside_case"));
  assert.ok(manifest.outputs.includes("bear_case"));
  assert.ok(manifest.outputs.includes("score_source_details"));
  assert.ok(manifest.outputs.includes("scoring_sensitivity_model"));
  assert.ok(manifest.outputs.includes("folder_change_log_json"));
  assert.ok(manifest.outputs.includes("deck_content_diff_log"));
  assert.ok(manifest.outputs.includes("external_research_validation_report"));
  assert.ok(manifest.outputs.includes("human_score_and_notes_markdown"));
  assert.ok(manifest.evals.some((item) => item.name === "claim-validation-required"));
  assert.ok(manifest.evals.some((item) => item.name === "human-notes-saved"));
  assert.ok(manifest.evals.some((item) => item.name === "score-sources-visible"));
  assert.ok(manifest.evals.some((item) => item.name === "folder-change-log-required"));
  assert.ok(manifest.evals.some((item) => item.name === "external-source-validation-visible"));
  assert.ok(manifest.evals.some((item) => item.name === "deck-content-diff-visible"));

  assert.ok(tools.tools.some((tool) => tool.name === "ingest_deal_materials" && /fingerprint selected folder/.test(tool.responsibility)));
  assert.ok(tools.tools.some((tool) => tool.name === "validate_claims_with_research" && tool.permission === "ask-first"));
  assert.ok(tools.tools.some((tool) => tool.name === "save_review_markdown" && tool.sideEffect === "write"));
  assert.match(prompt, /private investment opportunities/);
  assert.match(prompt, /approved external research/);
  assert.match(prompt, /upside case/);
  assert.match(prompt, /bear case/);
  assert.match(prompt, /score_source_details/);
  assert.match(readme, /Require approval for writes/);
});
