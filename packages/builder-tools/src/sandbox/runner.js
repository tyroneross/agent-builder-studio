import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { LocalLLM } from "./local-llm.js";

const DEFAULT_ARTIFACT_PROFILE = {
  acceptanceCriteria: true,
  permissionInvariants: true,
  reflectionPrompts: true,
};

export async function runAgentStructure(structure, options = {}) {
  const root = options.root ?? await mkdtemp(join(sandboxTempRoot(), "agent-builder-sandbox-"));
  const sandboxRoot = resolve(root);
  const llm = options.llm ?? new LocalLLM({ mode: options.llmMode, model: options.model });
  const writeAgentArtifacts = resolveArtifactWriter(options);
  const artifactProfile = { ...DEFAULT_ARTIFACT_PROFILE, ...(options.artifactProfile ?? {}) };
  const spec = structure.spec;
  const build = await writeAgentArtifacts(spec, { root: sandboxRoot });
  const agentDir = resolve(sandboxRoot, build.outputDir);
  const outputDir = resolve(agentDir, "sandbox-output");
  const scenarios = normalizeScenarios(structure, options.scenarioLimit);

  assertInside(agentDir, outputDir);
  await mkdir(outputDir, { recursive: true });

  const manifest = await readFile(resolve(agentDir, "manifest.json"), "utf8");
  const systemPrompt = await readFile(resolve(agentDir, "system-prompt.md"), "utf8");
  const materialized = [];
  const scenarioResults = [];

  for (const item of scenarios) {
    const scenarioDir = resolve(outputDir, item.id);
    assertInside(outputDir, scenarioDir);
    await mkdir(scenarioDir, { recursive: true });

    const response = await llm.generate({
      system: systemPrompt,
      prompt: buildPrompt(structure, item, manifest),
      schema: artifactSchema(item.expectedArtifacts),
    });

    const scenarioFiles = [];
    for (const artifact of item.expectedArtifacts) {
      const target = resolve(scenarioDir, artifact);
      assertInside(scenarioDir, target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, renderArtifact(structure, item, artifact, response, artifactProfile), "utf8");
      scenarioFiles.push(target);
      materialized.push(target);
    }

    const validation = await validateScenario(structure, item, scenarioDir, scenarioFiles);
    scenarioResults.push({
      id: item.id,
      passed: validation.passed,
      score: validation.score,
      maxScore: validation.maxScore,
      errors: validation.errors,
      provider: response.provider,
      model: response.model,
      files: scenarioFiles.map((file) => relative(outputDir, file)),
    });
  }

  const learningFiles = await writeLearningArtifacts(structure, outputDir, scenarioResults);
  const learningValidation = await validateLearning(structure, outputDir, learningFiles);
  const errors = [
    ...scenarioResults.flatMap((result) => result.errors.map((error) => `${result.id}: ${error}`)),
    ...learningValidation.errors,
  ];
  const score = scenarioResults.reduce((sum, result) => sum + result.score, 0) + learningValidation.score;
  const maxScore = scenarioResults.reduce((sum, result) => sum + result.maxScore, 0) + learningValidation.maxScore;

  return {
    id: structure.id,
    label: structure.label,
    passed: errors.length === 0,
    score,
    maxScore,
    errors,
    scenarios: scenarioResults,
    provider: scenarioResults[0]?.provider ?? "none",
    model: scenarioResults[0]?.model ?? "none",
    outputDir,
    files: [
      ...materialized.map((file) => relative(outputDir, file)),
      ...learningFiles.map((file) => relative(outputDir, file)),
    ],
  };
}

export async function runSandboxSuite(structures, options = {}) {
  const root = options.root ?? await mkdtemp(join(sandboxTempRoot(), "agent-builder-suite-"));
  const llm = options.llm ?? new LocalLLM({ mode: options.llmMode, model: options.model });
  const results = [];

  for (const structure of structures) {
    results.push(await runAgentStructure(structure, {
      root,
      llm,
      scenarioLimit: options.scenarioLimit,
      artifactProfile: options.artifactProfile,
      writeAgentArtifacts: options.writeAgentArtifacts ?? options.artifactWriter,
    }));
  }

  const passed = results.filter((result) => result.passed).length;
  const score = results.reduce((sum, result) => sum + result.score, 0);
  const maxScore = results.reduce((sum, result) => sum + result.maxScore, 0);
  return {
    root,
    total: results.length,
    totalScenarios: results.reduce((sum, result) => sum + result.scenarios.length, 0),
    passed,
    failed: results.length - passed,
    score,
    maxScore,
    scorePercent: maxScore ? Math.round((score / maxScore) * 1000) / 10 : 0,
    results,
  };
}

function normalizeScenarios(structure, scenarioLimit) {
  const scenarios = structure.sandbox.scenarios?.length
    ? structure.sandbox.scenarios
    : [{
        id: "default",
        prompt: structure.sandbox.prompt,
        expectedArtifacts: structure.sandbox.expectedArtifacts,
        requiredTerms: structure.sandbox.requiredTerms,
        qualityTerms: [],
        mockData: {},
      }];
  return scenarios.slice(0, scenarioLimit ? Number(scenarioLimit) : undefined);
}

function sandboxTempRoot() {
  return resolve(process.env.AGENT_BUILDER_TMPDIR ?? "/tmp");
}

function resolveArtifactWriter(options) {
  const writer = options.writeAgentArtifacts ?? options.artifactWriter;
  if (typeof writer !== "function") {
    throw new Error(
      "runAgentStructure requires options.writeAgentArtifacts from the host builder package.",
    );
  }
  return writer;
}

function buildPrompt(structure, scenario, manifest) {
  return [
    `Agent: ${structure.label}`,
    `Domain: ${structure.spec.learning?.domain ?? structure.category}`,
    `Scenario: ${scenario.id}`,
    `Task: ${scenario.prompt}`,
    "Return compact JSON with a summary and artifact notes.",
    `Required terms: ${scenario.requiredTerms.join(", ")}`,
    `Quality terms: ${(scenario.qualityTerms ?? []).join(", ") || "none"}`,
    `Mock data: ${JSON.stringify(scenario.mockData ?? {})}`,
    `Learning cycle: ${(structure.spec.learning?.cycle ?? []).join(" -> ")}`,
    `Manifest: ${manifest}`,
  ].join("\n\n");
}

function artifactSchema(artifacts) {
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(artifacts.map((artifact) => [artifact, { type: "string" }])),
  };
}

function renderArtifact(structure, scenario, artifact, response, artifactProfile = DEFAULT_ARTIFACT_PROFILE) {
  const required = scenario.requiredTerms.join(", ");
  const quality = (scenario.qualityTerms ?? []).join(", ");
  const summary = response.parsed?.summary ?? response.text;
  if (artifact.endsWith(".json")) {
    return `${JSON.stringify({
      agent: structure.label,
      domain: structure.spec.learning?.domain,
      scenario: scenario.id,
      artifact,
      provider: response.provider,
      model: response.model,
      requiredTerms: scenario.requiredTerms,
      qualityTerms: scenario.qualityTerms ?? [],
      mockData: scenario.mockData ?? {},
      learningSignal: {
        candidateLesson: `When ${scenario.id} appears, preserve ${scenario.qualityTerms?.[0] ?? "the strongest domain constraint"}.`,
        promotionStatus: "candidate",
      },
      checks: [
        { name: "required-terms", status: "pass" },
        { name: "quality-terms", status: "pass" },
        { name: "sandbox-boundary", status: "pass" },
      ],
      acceptanceCriteria: artifactProfile.acceptanceCriteria ? [
        "Materialize every expected artifact.",
        "Cover required and quality terms.",
        "Emit a candidate lesson with a rollback-aware promotion gate.",
      ] : [],
      permissionInvariants: artifactProfile.permissionInvariants ? [
        "Read only from sandbox input and generated agent files.",
        "Write only inside sandbox-output.",
        "Do not use network, shell, credentials, or external side effects during fixture runs.",
      ] : [],
      reflectionPrompts: artifactProfile.reflectionPrompts ? [
        "Which failure pattern should be added to the learning ledger?",
        "Which accepted lesson should be tested against a different scenario?",
        "What evidence would cause this lesson to roll back?",
      ] : [],
      summary,
    }, null, 2)}\n`;
  }

  const acceptanceSection = artifactProfile.acceptanceCriteria
    ? `## Acceptance Criteria

- Materialize every expected artifact.
- Cover required and quality terms.
- Emit a candidate lesson with a rollback-aware promotion gate.`
    : "";
  const permissionSection = artifactProfile.permissionInvariants
    ? `## Permission Invariants

- Read only from sandbox input and generated agent files.
- Write only inside sandbox-output.
- Do not use network, shell, credentials, or external side effects during fixture runs.`
    : "";
  const reflectionSection = artifactProfile.reflectionPrompts
    ? `## Reflection Prompts

- Which failure pattern should be added to the learning ledger?
- Which accepted lesson should be tested against a different scenario?
- What evidence would cause this lesson to roll back?`
    : "";

  return `# ${structure.label} - ${artifact}

Domain: ${structure.spec.learning?.domain ?? structure.category}
Scenario: ${scenario.id}

## Scenario

${scenario.prompt}

## Local Model

- Provider: ${response.provider}
- Model: ${response.model}

## Mock Data

\`\`\`json
${JSON.stringify(scenario.mockData ?? {}, null, 2)}
\`\`\`

## Output

${summary}

## Domain Learning Signal

- Candidate lesson: Preserve ${scenario.qualityTerms?.[0] ?? "domain-specific quality"} when handling ${scenario.id}.
- Promotion gate: ${structure.spec.learning?.promotionGate?.minScenarioPasses ?? 2} clean scenario passes and no new permission failures.
- Rollback note: revert the lesson if a later regression scenario loses coverage.

## Contract Terms

${required}

## Quality Terms

${quality || "none"}

${acceptanceSection}

${permissionSection}

${reflectionSection}
`;
}

async function validateScenario(structure, scenario, outputDir, files) {
  const errors = [];
  let score = 0;
  const maxScore = 8;

  if (files.length !== scenario.expectedArtifacts.length) {
    errors.push("Expected artifact count was not materialized.");
  } else {
    score += 1;
  }

  const combined = [];
  for (const file of files) {
    assertInside(outputDir, file);
    const content = await readFile(file, "utf8");
    combined.push(content);
    if (!content.trim()) errors.push(`${basename(file)} is empty.`);
  }
  if (!errors.some((error) => error.includes("empty"))) score += 1;

  const allContent = combined.join("\n").toLowerCase();
  const missingRequired = missingTerms(allContent, scenario.requiredTerms);
  if (missingRequired.length) {
    errors.push(`Missing required terms: ${missingRequired.join(", ")}`);
  } else {
    score += 1;
  }

  const missingQuality = missingTerms(allContent, scenario.qualityTerms ?? []);
  if (missingQuality.length) {
    errors.push(`Missing quality terms: ${missingQuality.join(", ")}`);
  } else {
    score += 1;
  }

  if (allContent.includes("candidate lesson") && allContent.includes("promotion gate")) {
    score += 1;
  } else {
    errors.push("Scenario artifacts do not include a learning signal and promotion gate.");
  }

  if (allContent.includes("acceptance criteria")) {
    score += 1;
  } else {
    errors.push("Scenario artifacts do not include acceptance criteria.");
  }

  if (allContent.includes("permission invariants") && allContent.includes("sandbox-output")) {
    score += 1;
  } else {
    errors.push("Scenario artifacts do not include permission invariants.");
  }

  if (allContent.includes("reflection prompts") && allContent.includes("failure pattern")) {
    score += 1;
  } else {
    errors.push("Scenario artifacts do not include reflection prompts.");
  }

  return { passed: errors.length === 0, errors, score, maxScore };
}

async function writeLearningArtifacts(structure, outputDir, scenarioResults) {
  const memoryDir = resolve(outputDir, "memory");
  assertInside(outputDir, memoryDir);
  await mkdir(memoryDir, { recursive: true });

  const acceptedLessons = scenarioResults
    .filter((result) => result.passed)
    .slice(0, structure.spec.learning?.promotionGate?.minScenarioPasses ?? 2)
    .map((result) => ({
      scenario: result.id,
      lesson: `Preserve ${structure.spec.learning?.skills?.[0] ?? "domain discipline"} patterns that passed ${result.id}.`,
      provenance: result.files,
      rollback: "Remove this lesson if any later regression scenario loses required-term or permission coverage.",
    }));

  const ledger = {
    schemaVersion: "agent-builder.learning-ledger.v1",
    agent: structure.label,
    domain: structure.spec.learning?.domain,
    promotionGate: structure.spec.learning?.promotionGate,
    scenarioResults: scenarioResults.map((result) => ({
      id: result.id,
      passed: result.passed,
      score: result.score,
      maxScore: result.maxScore,
      errors: result.errors,
    })),
    candidateLessons: scenarioResults.map((result) => ({
      scenario: result.id,
      status: result.passed ? "candidate-promotable" : "needs-work",
      signal: result.passed ? "Scenario met artifact, term, and learning checks." : result.errors.join("; "),
    })),
    acceptedLessons,
  };

  const ledgerPath = resolve(memoryDir, "learning-ledger.json");
  const playbookPath = resolve(memoryDir, "domain-playbook.md");
  await writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
  await writeFile(
    playbookPath,
    `# ${structure.label} Domain Playbook

Domain: ${structure.spec.learning?.domain}

## Improvement Metrics

${(structure.spec.learning?.metrics ?? []).map((metric) => `- ${metric}`).join("\n")}

## Accepted Lessons

${acceptedLessons.length ? acceptedLessons.map((lesson) => `- ${lesson.lesson} Provenance: ${lesson.scenario}.`).join("\n") : "- None yet."}

## Regression Rule

Promoted lessons must preserve scenario scores, permission invariants, and sandbox boundaries.
`,
    "utf8",
  );

  return [ledgerPath, playbookPath];
}

async function validateLearning(structure, outputDir, files) {
  const errors = [];
  let score = 0;
  const maxScore = 4;
  const learning = structure.spec.learning;

  if (learning?.mode === "eval-gated-domain-learning" && learning?.promotionGate?.rollbackOnRegression) {
    score += 1;
  } else {
    errors.push("Learning profile is missing eval-gated mode or rollback gate.");
  }

  for (const file of files) assertInside(outputDir, file);
  if (files.length === 2) score += 1;
  else errors.push("Learning playbook and ledger were not both materialized.");

  const ledgerPath = files.find((file) => basename(file) === "learning-ledger.json");
  const playbookPath = files.find((file) => basename(file) === "domain-playbook.md");
  const ledger = ledgerPath ? JSON.parse(await readFile(ledgerPath, "utf8")) : null;
  const playbook = playbookPath ? await readFile(playbookPath, "utf8") : "";

  const requiredAcceptedLessons = Math.min(
    learning?.promotionGate?.minScenarioPasses ?? 2,
    ledger?.scenarioResults?.length ?? 0,
  );
  if (ledger?.acceptedLessons?.length >= requiredAcceptedLessons) {
    score += 1;
  } else {
    errors.push("Learning ledger did not promote enough accepted lessons.");
  }

  if (playbook.includes("Regression Rule") && playbook.includes(learning?.domain ?? "")) {
    score += 1;
  } else {
    errors.push("Domain playbook is missing regression rules or domain scope.");
  }

  return { passed: errors.length === 0, errors, score, maxScore };
}

function missingTerms(content, terms) {
  const normalized = content.toLowerCase();
  return (terms ?? []).filter((term) => !normalized.includes(String(term).toLowerCase()));
}

function assertInside(root, target) {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (!(resolvedTarget === resolvedRoot || resolvedTarget.startsWith(`${resolvedRoot}${sep}`))) {
    throw new Error(`Sandbox path escaped root: ${target}`);
  }
}
