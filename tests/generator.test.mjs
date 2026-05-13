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
      "README.md",
      "agent.yaml",
      "evals/golden-tasks.json",
      "evals/regression-scenarios.json",
      "manifest.json",
      "memory/domain-playbook.md",
      "memory/learning-ledger.json",
      "prompts/prompt-builder-contract.md",
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
    const manifest = await readFile(join(root, result.outputDir, "manifest.json"), "utf8");
    const tools = await readFile(join(root, result.outputDir, "tools.json"), "utf8");
    assert.match(manifest, /"schemaVersion": "agent-builder.v1"/);
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
