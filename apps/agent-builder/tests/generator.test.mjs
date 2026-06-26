import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { buildAgentArtifacts, slugify } from "@tyroneross/agent-pack";
import { writeAgentArtifacts } from "../lib/build-files.js";
import { PATTERNS } from "@tyroneross/agent-pack";
import { findAgentStructure } from "../agent-structures/index.js";
import { inferSpecProfile, mapToolPermissionTier } from "@tyroneross/agent-pack";

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
  const corePaths = [
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
    "setup/host-deployment.md",
    "setup/install-checklist.md",
    "setup/local-models.md",
    "setup/requirements.json",
    "setup/vector-store.md",
    "skills/skill-bank.json",
    "skills/skill-contract.md",
    "sources.md",
    "system-prompt.md",
    "tools.json",
  ];
  const knownEmittedPaths = new Set([
    "runtime/doc-ingest.mjs",
    "skills/threat-modeler.skill.md",
    "skills/pyramid-principle.skill.md",
  ]);

  for (const pattern of PATTERNS) {
    const result = buildAgentArtifacts({ patternId: pattern.id, projectName: pattern.name }, { createdAt: "test" });
    const paths = result.files.map((file) => file.path).sort();
    const manifest = JSON.parse(result.files.find((file) => file.path === "manifest.json").content);
    const allowedPaths = new Set([...corePaths, ...manifest.specProfile.contractFiles, ...knownEmittedPaths]);
    assert.equal(new Set(paths).size, paths.length);
    for (const path of corePaths) assert.ok(paths.includes(path), `${pattern.id} missing ${path}`);
    assert.ok(paths.includes("contracts/spec-profile.json"));
    for (const path of manifest.specProfile.contractFiles) {
      assert.ok(paths.includes(path), `${pattern.id} missing profile contract ${path}`);
    }
    for (const path of paths) assert.ok(allowedPaths.has(path), `${pattern.id} emitted unexpected file ${path}`);
    assert.ok(manifest.specProfile.validationFocus.length >= 3);
    assert.match(result.files.find((file) => file.path === "agent.yaml").content, /permissions:/);
    assert.match(result.files.find((file) => file.path === "tools.json").content, /inputSchema/);
    assert.match(result.files.find((file) => file.path === "prompts\/prompt-builder-contract.md").content, /Prompt Builder Invocation/);
  }
});

test("profile inference does not treat incidental v text as Type V topology", () => {
  const profile = inferSpecProfile(
    {
      projectName: "Review Helper",
      description: "Local evaluator for review drafts.",
      runtime: "local-sandbox",
      nodes: [{ id: "review", kind: "agent" }],
      tools: [],
    },
    { type: "Review evaluator" },
  );
  assert.equal(profile.id, "personal");

  const multiAgentProfile = inferSpecProfile(
    {
      projectName: "Research Orchestrator",
      description: "Delegates to workers.",
      runtime: "local-sandbox",
      nodes: [{ id: "orchestrator", kind: "orchestrator" }],
      tools: [],
    },
    { type: "Type III" },
  );
  assert.equal(multiAgentProfile.id, "team");

  const markVProfile = inferSpecProfile(
    {
      projectName: "Mark V Draft Helper",
      description: "Local draft helper.",
      runtime: "local-sandbox",
      nodes: [{ id: "draft", kind: "agent" }],
      tools: [],
    },
    { type: "Mark V helper" },
  );
  assert.equal(markVProfile.id, "personal");
});

test("invalid explicit validation profile is rejected", () => {
  assert.throws(
    () => buildAgentArtifacts({ patternId: "solo-tool-agent", projectName: "Bad Profile", validationProfile: "enterprize" }),
    /Unknown validation profile/,
  );
});

test("destructive or unknown side effects do not map to T0", () => {
  assert.equal(mapToolPermissionTier({ name: "wipe", sideEffect: "destructive", permission: "approval-required" }), "T5");
  assert.equal(mapToolPermissionTier({ name: "custom", sideEffect: "custom-side-effect", permission: "ask-first" }), "T5");
  assert.equal(mapToolPermissionTier({ name: "missing", responsibility: "No declared side effect.", permission: "ask-first" }), "T5");
  assert.equal(mapToolPermissionTier({ name: "deploy-prod", responsibility: "Deploys production credentials.", sideEffect: "read", permission: "ask-first" }), "T5");
  assert.equal(mapToolPermissionTier({ name: "auto-deploy", responsibility: "Runs deployment.", sideEffect: "read", permission: "ask-first" }), "T5");
  assert.equal(mapToolPermissionTier({ name: "read", responsibility: "checks permission before fetching", sideEffect: "read", permission: "allow-read" }), "T1");
});

test("profile inference handles aliases, flags, runtimes, and false-positive production text", () => {
  const base = {
    projectName: "Profile Fixture",
    description: "Local draft helper.",
    runtime: "local-sandbox",
    nodes: [{ id: "draft", title: "Draft", kind: "agent" }],
    tools: [],
  };

  assert.equal(inferSpecProfile({ ...base, validationProfile: "production" }).id, "enterprise");
  assert.equal(inferSpecProfile({ ...base, validationProfile: { id: "workflow" } }).id, "team");
  assert.equal(inferSpecProfile({ ...base, enterprise: true }).id, "enterprise");
  assert.equal(inferSpecProfile({ ...base, riskTier: "high" }).id, "enterprise");
  assert.equal(inferSpecProfile({ ...base, runtime: "hosted-worker" }).id, "team");
  assert.equal(inferSpecProfile({ ...base, description: "Pre-production draft helper." }).id, "personal");
  assert.equal(inferSpecProfile({ ...base, description: "Local customer database helper." }).id, "personal");
  assert.equal(inferSpecProfile({ ...base, validationProfile: "" }).id, "personal");
  assert.equal(inferSpecProfile({ ...base, validationProfile: false }).id, "personal");
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
    const agentYaml = await readFile(join(root, result.outputDir, "agent.yaml"), "utf8");
    const requirements = JSON.parse(await readFile(join(root, result.outputDir, "setup/requirements.json"), "utf8"));
    const manifest = await readFile(join(root, result.outputDir, "manifest.json"), "utf8");
    const install = await readFile(join(root, result.outputDir, "INSTALL.md"), "utf8");
    const inputContract = await readFile(join(root, result.outputDir, "context/input-contract.md"), "utf8");
    const envExample = await readFile(join(root, result.outputDir, "setup/env.example"), "utf8");
    const hostDeployment = await readFile(join(root, result.outputDir, "setup/host-deployment.md"), "utf8");
    const skillBank = JSON.parse(await readFile(join(root, result.outputDir, "skills/skill-bank.json"), "utf8"));
    const skillContract = await readFile(join(root, result.outputDir, "skills/skill-contract.md"), "utf8");
    const setupCheck = await readFile(join(root, result.outputDir, "scripts/setup-check.mjs"), "utf8");
    const runtimeAdapter = await readFile(join(root, result.outputDir, "runtime/custom-loop-adapter.mjs"), "utf8");
    const runtimeGuide = await readFile(join(root, result.outputDir, "runtime/adapters/custom-loop.md"), "utf8");
    const tools = await readFile(join(root, result.outputDir, "tools.json"), "utf8");
    const specProfileContract = JSON.parse(await readFile(join(root, result.outputDir, "contracts/spec-profile.json"), "utf8"));
    const systemBoundary = await readFile(join(root, result.outputDir, "contracts/system-boundary.yaml"), "utf8");
    const toolContracts = await readFile(join(root, result.outputDir, "contracts/tool-contracts.yaml"), "utf8");
    const observability = await readFile(join(root, result.outputDir, "contracts/observability.yaml"), "utf8");
    const manifestJson = JSON.parse(manifest);
    assert.equal(packageManifest.schemaVersion, "agent-builder.package.v1");
    assert.equal(packageManifest.selfContained, true);
    assert.equal(packageManifest.canonicalBuilderOutput, "generated/agents/local-agent");
    assert.equal(packageManifest.copyPolicy, "copy-directory-as-unit");
    assert.equal(packageManifest.entrypoints.skillBank, "skills/skill-bank.json");
    assert.equal(packageManifest.entrypoints.skillContract, "skills/skill-contract.md");
    assert.equal(packageManifest.entrypoints.hostDeployment, "setup/host-deployment.md");
    assert.equal(packageManifest.entrypoints.specProfile, "contracts/spec-profile.json");
    assert.equal(packageManifest.specProfile.id, "personal");
    assert.equal(packageJson.scripts["setup:check"], "node scripts/setup-check.mjs");
    assert.equal(packageJson.scripts["runtime:check"], "node runtime/custom-loop-adapter.mjs --fixture");
    assert.match(agentYaml, /specProfile:/);
    assert.match(agentYaml, /interaction:/);
    assert.match(agentYaml, /governance:/);
    assert.equal(requirements.schemaVersion, "agent-builder.setup-requirements.v1");
    assert.equal(requirements.specProfile.id, "personal");
    assert.ok(requirements.requiredFiles.includes("setup/requirements.json"));
    assert.ok(requirements.requiredFiles.includes("runtime/adapter-contract.md"));
    assert.ok(requirements.requiredFiles.includes("skills/skill-bank.json"));
    assert.ok(requirements.requiredFiles.includes("skills/skill-contract.md"));
    assert.ok(requirements.requiredFiles.includes("setup/host-deployment.md"));
    assert.ok(requirements.requiredFiles.includes("contracts/spec-profile.json"));
    assert.ok(requirements.requiredFiles.includes("contracts/system-boundary.yaml"));
    assert.ok(requirements.requiredFiles.includes("contracts/tool-contracts.yaml"));
    assert.ok(requirements.requiredFiles.includes("contracts/observability.yaml"));
    assert.match(manifest, /"schemaVersion": "agent-builder.v1"/);
    assert.equal(manifestJson.specProfile.id, "personal");
    assert.equal(specProfileContract.profile.id, "personal");
    assert.match(systemBoundary, /system_boundary:/);
    assert.match(toolContracts, /permission_tier:/);
    assert.match(observability, /required_events:/);
    assert.match(install, /Copy the entire `generated\/agents\/local-agent\/` folder/);
    assert.match(inputContract, /Required Inputs/);
    assert.match(envExample, /AGENT_PACKAGE_ROOT=/);
    assert.equal(skillBank.schemaVersion, "agent-builder.skill-bank.v1");
    assert.ok(skillBank.skills.some((skill) => skill.id === "local-agent-operating-skill"));
    assert.match(skillContract, /# Skill Contract/);
    assert.match(skillContract, /Skill Chaining/);
    assert.match(hostDeployment, /API-key Runtime/);
    assert.match(hostDeployment, /Claude/);
    assert.match(hostDeployment, /Codex/);
    assert.match(setupCheck, /missingFiles/);
    assert.match(runtimeAdapter, /skillBank/);
    assert.match(runtimeAdapter, /runFixture/);
    assert.match(runtimeGuide, /Custom loop Adapter Guide/);
    assert.match(tools, /"schemaVersion": "agent-builder.tools.v1"/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("team validation profile emits workflow contracts without enterprise lifecycle", () => {
  const result = buildAgentArtifacts(
    {
      patternId: "approval-workflow",
      projectName: "Team Approval Agent",
      description: "Routes internal team requests through review and approval.",
    },
    { createdAt: "test" },
  );

  const paths = result.files.map((file) => file.path);
  const manifest = JSON.parse(result.files.find((file) => file.path === "manifest.json").content);
  const humanCheckpoints = result.files.find((file) => file.path === "contracts/human-checkpoints.yaml").content;
  const guardrails = result.files.find((file) => file.path === "contracts/guardrails.yaml").content;
  const flowTopology = result.files.find((file) => file.path === "contracts/flow-topology.yaml").content;

  assert.equal(manifest.specProfile.id, "team");
  assert.ok(paths.includes("contracts/flow-topology.yaml"));
  assert.ok(paths.includes("contracts/guardrails.yaml"));
  assert.ok(paths.includes("contracts/human-checkpoints.yaml"));
  assert.ok(!paths.includes("contracts/agent-registry.yaml"));
  assert.ok(!paths.includes("contracts/lifecycle.yaml"));
  assert.match(humanCheckpoints, /human_checkpoints:/);
  assert.match(guardrails, /tool_guardrails:/);
  assert.match(flowTopology, /flow_topology:/);
});

test("human checkpoint contract only lists human approval or review nodes", () => {
  const result = buildAgentArtifacts(
    {
      patternId: "solo-tool-agent",
      projectName: "Automated Eval Team Agent",
      validationProfile: "team",
      nodes: [
        { id: "run", title: "Run", kind: "agent", inputs: ["request"], outputs: ["answer"], tools: [] },
        { id: "eval", title: "Eval", kind: "eval", inputs: ["answer"], outputs: ["quality_check"], tools: [] },
      ],
      edges: [{ from: "run", to: "eval" }],
      evals: [{ name: "a" }, { name: "b" }, { name: "c" }],
      tools: [],
    },
    { createdAt: "test" },
  );

  const humanCheckpoints = result.files.find((file) => file.path === "contracts/human-checkpoints.yaml").content;
  assert.match(humanCheckpoints, /human_checkpoints:/);
  assert.doesNotMatch(humanCheckpoints, /node_id: eval/);
});

test("tools with omitted side effects are tiered consistently across contracts", () => {
  const result = buildAgentArtifacts(
    {
      patternId: "solo-tool-agent",
      projectName: "Missing Side Effect Agent",
      tools: [
        {
          name: "opaque_tool",
          responsibility: "Runs an integration without declaring side effects.",
          permission: "ask-first",
        },
        {
          name: "search_tool",
          responsibility: "Fetches reference data.",
          sideEffect: "network",
          permission: "ask-first",
        },
      ],
      nodes: [
        {
          id: "run",
          title: "Run",
          kind: "agent",
          inputs: ["request"],
          outputs: ["answer"],
          tools: ["opaque_tool", "search_tool"],
        },
      ],
      edges: [],
    },
    { createdAt: "test" },
  );

  const manifest = JSON.parse(result.files.find((file) => file.path === "manifest.json").content);
  const tools = JSON.parse(result.files.find((file) => file.path === "tools.json").content);
  const systemBoundary = result.files.find((file) => file.path === "contracts/system-boundary.yaml").content;
  const toolContracts = result.files.find((file) => file.path === "contracts/tool-contracts.yaml").content;

  assert.equal(tools.tools.find((tool) => tool.name === "opaque_tool").permissionTier, "T5");
  assert.equal(manifest.governance.toolTiers.find((tool) => tool.tool === "opaque_tool").permissionTier, "T5");
  assert.match(systemBoundary, /- opaque_tool/);
  assert.match(systemBoundary, /- search_tool/);
  assert.match(systemBoundary, /permission_tier: T5/);
  assert.doesNotMatch(systemBoundary.split("actions_that_change_the_world:")[1], /tool: search_tool/);
  assert.match(toolContracts, /side_effect: unspecified/);
  assert.match(toolContracts, /permission_tier: T5/);
});

test("enterprise validation profile emits governed runtime contracts", () => {
  const result = buildAgentArtifacts(
    {
      patternId: "approval-workflow",
      projectName: "Enterprise Intake Agent",
      description: "Routes production customer requests into governed workflow actions.",
      validationProfile: "enterprise",
      owners: {
        primary: "platform-owner@example.com",
        team: "Platform Operations",
        runtimeIdentity: "enterprise-intake-agent-runtime",
        humanOperators: ["ops-reviewer@example.com"],
      },
    },
    { createdAt: "test" },
  );

  const paths = result.files.map((file) => file.path);
  const manifest = JSON.parse(result.files.find((file) => file.path === "manifest.json").content);
  const packageManifest = JSON.parse(result.files.find((file) => file.path === "agent-package.json").content);
  const requirements = JSON.parse(result.files.find((file) => file.path === "setup/requirements.json").content);
  const agentRegistry = result.files.find((file) => file.path === "contracts/agent-registry.yaml").content;
  const lifecycle = result.files.find((file) => file.path === "contracts/lifecycle.yaml").content;
  const toolContracts = result.files.find((file) => file.path === "contracts/tool-contracts.yaml").content;

  assert.equal(manifest.specProfile.id, "enterprise");
  assert.equal(manifest.specProfile.explicit, true);
  assert.ok(manifest.specProfile.requiredContracts.includes("agent-registry"));
  assert.ok(manifest.specProfile.requiredContracts.includes("lifecycle"));
  for (const path of [
    "contracts/spec-profile.json",
    "contracts/system-boundary.yaml",
    "contracts/agent-registry.yaml",
    "contracts/tool-contracts.yaml",
    "contracts/flow-topology.yaml",
    "contracts/guardrails.yaml",
    "contracts/human-checkpoints.yaml",
    "contracts/observability.yaml",
    "contracts/lifecycle.yaml",
  ]) {
    assert.ok(paths.includes(path), `missing ${path}`);
    assert.ok(packageManifest.files.includes(path), `package manifest missing ${path}`);
    assert.ok(requirements.requiredFiles.includes(path), `requirements missing ${path}`);
  }
  assert.match(agentRegistry, /platform-owner@example\.com/);
  assert.match(agentRegistry, /runtime_identity:/);
  assert.match(lifecycle, /promotion_gates:/);
  assert.match(toolContracts, /permission_tier:/);
});

test("skill validation profile emits only the skill-level profile contract", () => {
  const result = buildAgentArtifacts(
    {
      patternId: "solo-tool-agent",
      projectName: "Reusable Skill Package",
      validationProfile: "skill",
    },
    { createdAt: "test" },
  );
  const paths = result.files.map((file) => file.path);
  const manifest = JSON.parse(result.files.find((file) => file.path === "manifest.json").content);
  const requirements = JSON.parse(result.files.find((file) => file.path === "setup/requirements.json").content);

  assert.equal(manifest.specProfile.id, "skill");
  assert.deepEqual(manifest.specProfile.contractFiles, ["contracts/spec-profile.json", "skills/skill-contract.md"]);
  assert.ok(paths.includes("contracts/spec-profile.json"));
  assert.ok(paths.includes("skills/skill-contract.md"));
  assert.ok(!paths.includes("contracts/system-boundary.yaml"));
  assert.ok(requirements.requiredFiles.includes("contracts/spec-profile.json"));
  assert.ok(requirements.requiredFiles.includes("skills/skill-contract.md"));
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
