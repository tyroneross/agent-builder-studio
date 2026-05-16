const basePermissions = {
  default: "deny-by-default",
  read: "allow files inside the sandbox input directory",
  write: "allow only the sandbox output directory",
  network: "disabled during sandbox runs",
  shell: "disabled unless an approved local adapter is configured",
};

const baseMemory = {
  working: "active request, selected constraints, and current artifact plan",
  session: "tool results, generated drafts, validation notes, and stop reasons",
  persistent: "operator preferences and reusable examples with provenance",
  domain: "eval-gated lessons, failure patterns, and reusable examples scoped to this agent's domain",
};

const baseLearningCycle = [
  "run domain scenarios with mock or real inputs",
  "score required outputs, quality terms, permission invariants, and stop reasons",
  "extract failure patterns and candidate lessons",
  "promote only lessons that improve a later scenario without breaking guardrails",
  "write accepted lessons to the domain playbook with provenance",
];

function learningProfile({ domain, metrics, skills, exemplars = [] }) {
  return {
    mode: "eval-gated-domain-learning",
    domain,
    cycle: baseLearningCycle,
    metrics,
    skills,
    exemplars,
    promotionGate: {
      minScenarioPasses: 2,
      requiresNoNewPermissionFailures: true,
      requiresHumanApprovalForPersistentMemory: true,
      rollbackOnRegression: true,
    },
    artifacts: ["memory/domain-playbook.md", "memory/learning-ledger.json", "evals/regression-scenarios.json"],
  };
}

function node(id, title, kind, description, x, y, extras = {}) {
  return {
    id,
    title,
    kind,
    description,
    x,
    y,
    tools: extras.tools ?? [],
    inputs: extras.inputs ?? ["task_brief"],
    outputs: extras.outputs ?? [`${id}_result`],
    permission: extras.permission ?? "allow-read",
    model: extras.model ?? "local",
  };
}

function evalTask(name, input, expected) {
  return { name, input, expected };
}

function scenario(id, prompt, expectedArtifacts, requiredTerms, qualityTerms = [], mockData = {}) {
  return { id, prompt, expectedArtifacts, requiredTerms, qualityTerms, mockData };
}

function structure({ id, label, short, category, spec, sandbox }) {
  const enhancedSpec = addDomainLearning({
    structureId: id,
    runtime: "local-sandbox",
    framework: "custom-loop",
    modelProvider: "ollama",
    sandbox: "local-filesystem",
    memory: baseMemory,
    permissions: basePermissions,
    sources: ["ollama-api", "next-route-handlers"],
    ...spec,
  });

  return {
    id,
    label,
    short,
    category,
    spec: enhancedSpec,
    sandbox,
  };
}

function addDomainLearning(spec) {
  const learning = spec.learning ?? learningProfile({
    domain: spec.projectName,
    metrics: ["artifact completeness", "required term coverage", "permission invariants"],
    skills: ["scenario reflection", "failure pattern extraction", "playbook updates"],
  });
  const hasLearningNode = spec.nodes.some((item) => item.id === "learn");
  const firstNode = spec.nodes[0]?.id;
  const verifierNode = [...spec.nodes].reverse().find((item) =>
    ["eval", "verifier", "approval", "guardrail"].includes(item.kind),
  )?.id ?? spec.nodes.at(-1)?.id;

  const learningNode = node(
    "learn",
    "Domain learning",
    "memory",
    `Record scenario scores, failure modes, accepted lessons, and reusable examples for ${learning.domain}.`,
    960,
    172,
    {
      inputs: ["eval_results", "run_artifacts", "operator_feedback"],
      outputs: ["domain_playbook", "learning_ledger"],
      permission: "allow-read",
    },
  );

  const edges = [...(spec.edges ?? [])];
  if (verifierNode && !edges.some((edge) => edge.from === verifierNode && edge.to === "learn")) {
    edges.push({ from: verifierNode, to: "learn", label: "score + lessons" });
  }
  if (firstNode && !edges.some((edge) => edge.from === "learn" && edge.to === firstNode)) {
    edges.push({ from: "learn", to: firstNode, label: "validated playbook" });
  }

  return {
    ...spec,
    outputs: unique([...(spec.outputs ?? []), "domain_playbook", "learning_ledger"]),
    nodes: hasLearningNode ? spec.nodes : [...spec.nodes, learningNode],
    edges,
    learning,
  };
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

export const AGENT_STRUCTURES = [
  structure({
    id: "chief-of-staff-agent",
    label: "Chief of Staff Agent",
    short: "Prioritizes work, prepares decisions, and tracks follow-through.",
    category: "operations",
    spec: {
      patternId: "approval-workflow",
      projectName: "Chief of Staff Agent",
      description:
        "Turns scattered updates, meetings, goals, and constraints into priorities, decision briefs, follow-up plans, and owner-visible operating cadence.",
      autonomy: "human-in-loop",
      learning: learningProfile({
        domain: "executive operations",
        metrics: ["protected deep-work hours", "owner coverage", "decision clarity", "context-switch reduction", "follow-through rate"],
        skills: ["schedule intake", "100x productivity planning", "priority triage", "decision framing", "operating rhythm design"],
        exemplars: ["weekly operating brief", "board prep packet", "crisis triage note"],
      }),
      inputs: ["executive_goals", "calendar_export", "meeting_notes", "open_threads", "energy_constraints", "strengths_and_weaknesses"],
      outputs: ["priority_brief", "decision_log", "follow_up_plan", "time_block_plan", "learning_ledger", "operating_risks"],
      tools: [
        { name: "intake_context", responsibility: "Condense goals, calendar input, meetings, open loops, and baseline productivity metrics.", sideEffect: "read", permission: "allow-read" },
        { name: "prioritize_work", responsibility: "Rank work by urgency, leverage, owner, and risk.", sideEffect: "none", permission: "allow-read" },
        { name: "optimize_time_blocks", responsibility: "Protect high-leverage work, batch admin, and produce an approval-ready calendar plan.", sideEffect: "write", permission: "ask-first" },
        { name: "draft_followups", responsibility: "Draft owner-specific follow-ups and decision requests.", sideEffect: "write", permission: "ask-first" },
        { name: "check_operating_risks", responsibility: "Flag blocked decisions, missing owners, and overloaded calendars.", sideEffect: "none", permission: "allow-read" },
      ],
      nodes: [
        node("intake", "Context intake", "agent", "Collect goals, calendar data, meetings, open loops, and constraints.", 42, 118, { tools: ["intake_context"], inputs: ["executive_goals", "meeting_notes", "calendar_export"], outputs: ["current_state", "schedule_profile"] }),
        node("schedule", "Schedule skill", "skill", "Apply schedule-intake and 100x-productivity skills to calendar data.", 42, 292, { inputs: ["calendar_export", "energy_constraints", "strengths_and_weaknesses"], outputs: ["schedule_profile"] }),
        node("triage", "Priority triage", "orchestrator", "Rank work and decide which threads need action.", 282, 118, { tools: ["prioritize_work"], inputs: ["current_state"], outputs: ["priority_brief"] }),
        node("time", "Time architect", "agent", "Create protected focus blocks, meeting clusters, and follow-up batches.", 282, 292, { tools: ["optimize_time_blocks"], inputs: ["schedule_profile", "priority_brief"], outputs: ["time_block_plan", "learning_ledger"], permission: "ask-first" }),
        node("decisions", "Decision prep", "executor", "Prepare decision log entries with options and recommendation.", 520, 60, { inputs: ["priority_brief"], outputs: ["decision_log"] }),
        node("followups", "Follow-up planner", "executor", "Draft owner-specific follow-ups and next actions.", 520, 238, { tools: ["draft_followups"], inputs: ["priority_brief", "time_block_plan"], outputs: ["follow_up_plan"], permission: "ask-first" }),
        node("risk", "Operating risk check", "eval", "Flag missing owners, blocked decisions, overloaded commitments, and overconfident productivity claims.", 760, 158, { tools: ["check_operating_risks"], inputs: ["decision_log", "follow_up_plan", "time_block_plan"], outputs: ["operating_risks"] }),
      ],
      edges: [
        { from: "intake", to: "triage", label: "current state" },
        { from: "schedule", to: "time", label: "baseline calendar" },
        { from: "triage", to: "time", label: "top leverage" },
        { from: "triage", to: "decisions", label: "priorities" },
        { from: "triage", to: "followups", label: "owners" },
        { from: "time", to: "followups", label: "follow-up windows" },
        { from: "decisions", to: "risk", label: "decisions" },
        { from: "time", to: "risk", label: "calendar tradeoffs" },
        { from: "followups", to: "risk", label: "follow-ups" },
      ],
      evals: [
        evalTask("owners-visible", "Summarize follow-ups.", "Every follow-up has an owner or an explicit missing-owner flag."),
        evalTask("decision-log-present", "Prepare operating update.", "Decision log includes options, recommendation, and status."),
        evalTask("risk-check-present", "Review priorities.", "Operating risks are separated from normal tasks."),
        evalTask("schedule-learning-present", "Optimize a week.", "Time-block plan includes baseline metrics, improved metrics, and a learning ledger."),
      ],
    },
    sandbox: {
      prompt: "Prepare a weekly operating brief for a founder with three product threads, two hiring loops, and one blocked partnership decision.",
      expectedArtifacts: ["priority-brief.md", "decision-log.json", "follow-up-plan.md"],
      requiredTerms: ["priority", "owner", "decision", "risk"],
      scenarios: [
        scenario(
          "weekly-ops",
          "Prepare a weekly operating brief for a founder with three product threads, two hiring loops, and one blocked partnership decision.",
          ["priority-brief.md", "decision-log.json", "follow-up-plan.md"],
          ["priority", "owner", "decision", "risk"],
          ["next action", "due date", "blocked", "tradeoff"],
          { openThreads: 6, meetings: 4, calendarHoursAvailable: 9 },
        ),
        scenario(
          "board-prep",
          "Turn messy board-prep notes into a decision brief, owner map, and risk log for a Monday board packet.",
          ["board-brief.md", "decision-log.json", "owner-map.md"],
          ["board", "owner", "decision", "risk"],
          ["recommendation", "status", "open question", "follow-up"],
          { decisions: ["pricing", "hiring plan", "enterprise pilot"], deadline: "Monday" },
        ),
        scenario(
          "crisis-triage",
          "Triage a launch incident, investor request, and hiring escalation into an operating plan for the next 48 hours.",
          ["triage-plan.md", "decision-log.json", "risk-register.md"],
          ["triage", "owner", "decision", "risk"],
          ["severity", "sequence", "communication", "checkpoint"],
          { horizonHours: 48, stakeholders: ["product", "investor", "candidate"] },
        ),
        scenario(
          "ambiguous-ownership",
          "Resolve an operating update where two critical tasks have no clear owner and one owner is overloaded.",
          ["ownership-brief.md", "decision-log.json", "follow-up-plan.md"],
          ["owner", "decision", "risk", "priority"],
          ["missing owner", "capacity", "handoff", "escalation"],
          { tasksWithoutOwners: 2, overloadedOwners: ["head_of_product"] },
        ),
      ],
    },
  }),
  structure({
    id: "powerpoint-deck-builder",
    label: "PowerPoint Deck Builder",
    short: "Creates a deck outline, slide plan, and speaker notes.",
    category: "content",
    spec: {
      patternId: "approval-workflow",
      projectName: "PowerPoint Deck Builder",
      description:
        "Builds a presentation plan from a topic, audience, source notes, and brand constraints without using cloud APIs.",
      autonomy: "human-in-loop",
      learning: learningProfile({
        domain: "presentation design",
        metrics: ["narrative coherence", "slide completeness", "audience fit", "speaker-note coverage"],
        skills: ["story arc selection", "slide compression", "evidence placement"],
        exemplars: ["board update deck", "sales enablement deck", "training deck"],
      }),
      inputs: ["topic", "audience", "source_notes", "brand_guidance"],
      outputs: ["deck_outline", "slide_plan", "speaker_notes", "export_manifest"],
      tools: [
        { name: "outline_deck", responsibility: "Create the narrative arc and section sequence.", sideEffect: "none", permission: "allow-read" },
        { name: "draft_slides", responsibility: "Draft slide titles, bullets, and speaker notes.", sideEffect: "write", permission: "ask-first" },
        { name: "validate_deck", responsibility: "Check slide count, audience fit, and missing evidence.", sideEffect: "none", permission: "allow-read" },
      ],
      nodes: [
        node("intake", "Deck intake", "agent", "Normalize topic, audience, length, and brand constraints.", 42, 92, { inputs: ["topic", "audience"], outputs: ["deck_brief"] }),
        node("story", "Narrative planner", "agent", "Create the persuasive arc and slide sequence.", 268, 92, { tools: ["outline_deck"], inputs: ["deck_brief"], outputs: ["deck_outline"] }),
        node("slides", "Slide drafter", "executor", "Draft slide titles, bullets, and speaker notes.", 492, 92, { tools: ["draft_slides"], inputs: ["deck_outline"], outputs: ["slide_plan", "speaker_notes"], permission: "ask-first" }),
        node("review", "Deck reviewer", "eval", "Validate audience fit, slide count, and export readiness.", 716, 92, { tools: ["validate_deck"], inputs: ["slide_plan"], outputs: ["export_manifest"] }),
      ],
      edges: [
        { from: "intake", to: "story", label: "deck brief" },
        { from: "story", to: "slides", label: "outline" },
        { from: "slides", to: "review", label: "draft deck" },
      ],
      evals: [
        evalTask("slide-count-present", "Create a 6-slide board update.", "Output includes exactly one slide plan with slide count."),
        evalTask("speaker-notes-present", "Create a training deck.", "Every slide has speaker notes or a reason notes are omitted."),
        evalTask("brand-constraints-preserved", "Apply brand guidance.", "Brand constraints appear in the export manifest."),
      ],
    },
    sandbox: {
      prompt: "Create a 6-slide board update about a local-first agent builder for technical operators.",
      expectedArtifacts: ["deck-outline.md", "slides.json", "speaker-notes.md"],
      requiredTerms: ["slide", "audience", "speaker notes", "export"],
      scenarios: [
        scenario(
          "board-update",
          "Create a 6-slide board update about a local-first agent builder for technical operators.",
          ["deck-outline.md", "slides.json", "speaker-notes.md"],
          ["slide", "audience", "speaker notes", "export"],
          ["narrative", "metric", "decision", "appendix"],
          { slides: 6, audience: "technical operators", format: "board update" },
        ),
        scenario(
          "sales-enablement",
          "Create a concise sales enablement deck for a buyer who needs security, deployment, and ROI proof.",
          ["sales-outline.md", "slides.json", "talk-track.md"],
          ["slide", "buyer", "security", "ROI"],
          ["objection", "proof", "call to action", "demo"],
          { persona: "security-conscious buyer", slides: 8 },
        ),
        scenario(
          "training-deck",
          "Create a training deck that teaches a team how to operate sandboxed local agents.",
          ["training-outline.md", "slides.json", "facilitator-notes.md"],
          ["training", "slide", "sandbox", "notes"],
          ["exercise", "checklist", "pitfall", "recap"],
          { audience: "internal operators", modules: 3 },
        ),
        scenario(
          "investor-demo",
          "Create an investor demo deck that explains why domain-learning agents improve over repeated sandbox runs.",
          ["demo-outline.md", "slides.json", "speaker-notes.md"],
          ["slide", "investor", "learning", "speaker notes"],
          ["before-after", "metric", "proof", "ask"],
          { slides: 7, audience: "investors", proofPoints: ["score", "scenario coverage"] },
        ),
      ],
    },
  }),
  structure({
    id: "writing-agent",
    label: "Writing Agent",
    short: "Drafts, edits, and checks structured prose.",
    category: "writing",
    spec: {
      patternId: "evaluator-optimizer",
      projectName: "Writing Agent",
      description:
        "Produces concise structured writing, revises against a rubric, and reports style or logic issues.",
      autonomy: "quality-loop",
      learning: learningProfile({
        domain: "structured writing",
        metrics: ["lead clarity", "audience fit", "revision precision", "style-rule compliance"],
        skills: ["pyramid structuring", "voice calibration", "rubric-driven revision"],
        exemplars: ["product memo", "release notes", "executive email"],
      }),
      inputs: ["writing_goal", "audience", "source_notes", "style_rules"],
      outputs: ["draft", "revision_notes", "style_check"],
      tools: [
        { name: "draft_text", responsibility: "Draft prose from the brief and notes.", sideEffect: "none", permission: "allow-read" },
        { name: "critique_text", responsibility: "Check logic, pyramid structure, and style constraints.", sideEffect: "none", permission: "allow-read" },
        { name: "revise_text", responsibility: "Revise only failed rubric dimensions.", sideEffect: "write", permission: "ask-first" },
      ],
      nodes: [
        node("brief", "Brief parser", "agent", "Identify goal, audience, claims, and style constraints.", 52, 158, { outputs: ["writing_brief"] }),
        node("draft", "Draft writer", "agent", "Write the first clean version.", 292, 158, { tools: ["draft_text"], inputs: ["writing_brief"], outputs: ["draft"] }),
        node("critique", "Rubric critic", "eval", "Return binary pass/fail plus actionable defects.", 528, 80, { tools: ["critique_text"], inputs: ["draft"], outputs: ["revision_notes"] }),
        node("revise", "Revision pass", "executor", "Apply targeted revisions and preserve useful wording.", 528, 260, { tools: ["revise_text"], inputs: ["revision_notes"], outputs: ["final_draft"], permission: "ask-first" }),
        node("style", "Style check", "verifier", "Confirm voice, structure, and source handling.", 760, 158, { inputs: ["final_draft"], outputs: ["style_check"] }),
      ],
      edges: [
        { from: "brief", to: "draft", label: "brief" },
        { from: "draft", to: "critique", label: "candidate" },
        { from: "critique", to: "revise", label: "defects" },
        { from: "revise", to: "style", label: "final draft" },
      ],
      evals: [
        evalTask("pyramid-lead", "Draft an update memo.", "The answer leads with the conclusion."),
        evalTask("style-rules-kept", "Apply style rules.", "The style check lists every supplied rule."),
        evalTask("revision-scoped", "Revise a failed draft.", "Revision notes map to changed sections."),
      ],
    },
    sandbox: {
      prompt: "Write a 500-word product memo introducing a local agent builder to engineers.",
      expectedArtifacts: ["draft.md", "revision-notes.md", "style-check.json"],
      requiredTerms: ["conclusion", "audience", "revision", "style"],
      scenarios: [
        scenario(
          "product-memo",
          "Write a 500-word product memo introducing a local agent builder to engineers.",
          ["draft.md", "revision-notes.md", "style-check.json"],
          ["conclusion", "audience", "revision", "style"],
          ["tradeoff", "workflow", "evidence", "next step"],
          { audience: "engineers", lengthWords: 500 },
        ),
        scenario(
          "release-notes",
          "Draft release notes for agent sandbox scoring, local Ollama mode, and generated learning artifacts.",
          ["release-notes.md", "revision-notes.md", "style-check.json"],
          ["release", "audience", "revision", "style"],
          ["changed", "why", "impact", "migration"],
          { version: "0.4.0", channels: ["developer", "operator"] },
        ),
        scenario(
          "executive-email",
          "Write a short executive email asking for approval to pilot three domain-learning agents.",
          ["email.md", "revision-notes.md", "style-check.json"],
          ["approval", "audience", "revision", "style"],
          ["ask", "risk", "timeline", "owner"],
          { recipients: 3, lengthWords: 180 },
        ),
        scenario(
          "critique-rewrite",
          "Rewrite a vague launch announcement so the conclusion, audience, and concrete next step are explicit.",
          ["rewrite.md", "revision-notes.md", "style-check.json"],
          ["conclusion", "audience", "revision", "style"],
          ["specificity", "before-after", "next step", "tone"],
          { sourceQuality: "vague", targetTone: "direct" },
        ),
      ],
    },
  }),
  structure({
    id: "app-builder-agent",
    label: "App Builder Agent",
    short: "Turns an app idea into files, tests, and a run plan.",
    category: "software",
    spec: {
      patternId: "approval-workflow",
      projectName: "App Builder Agent",
      description:
        "Plans and builds small local apps through explicit file plans, guarded writes, and validation commands.",
      autonomy: "bounded-workflow",
      learning: learningProfile({
        domain: "small app construction",
        metrics: ["file-plan accuracy", "acceptance-test coverage", "sandbox compliance", "build reproducibility"],
        skills: ["MVP scoping", "file planning", "validation triage"],
        exemplars: ["task tracker", "data dashboard", "onboarding form"],
      }),
      inputs: ["app_goal", "stack_constraints", "design_rules", "acceptance_tests"],
      outputs: ["app_spec", "file_plan", "implementation_steps", "test_plan"],
      tools: [
        { name: "inspect_workspace", responsibility: "Read allowed project files and package metadata.", sideEffect: "read", permission: "allow-read" },
        { name: "plan_files", responsibility: "Propose file additions and edits before writing.", sideEffect: "none", permission: "allow-read" },
        { name: "write_app_files", responsibility: "Write approved files inside the sandbox.", sideEffect: "write", permission: "ask-first" },
        { name: "run_validation", responsibility: "Run local build and tests.", sideEffect: "shell", permission: "approval-required" },
      ],
      nodes: [
        node("scope", "Scope mapper", "agent", "Convert the app idea into a buildable MVP boundary.", 42, 104, { tools: ["inspect_workspace"], outputs: ["app_spec"] }),
        node("plan", "File planner", "agent", "Create a MECE file plan and dependency order.", 274, 104, { tools: ["plan_files"], inputs: ["app_spec"], outputs: ["file_plan"] }),
        node("approval", "Write approval", "approval", "Pause before filesystem writes.", 508, 104, { inputs: ["file_plan"], outputs: ["approved_plan"], permission: "approval-required" }),
        node("builder", "Local builder", "executor", "Materialize approved files inside the sandbox.", 724, 104, { tools: ["write_app_files"], inputs: ["approved_plan"], outputs: ["implementation_steps"], permission: "ask-first" }),
        node("tests", "Validation runner", "verifier", "Run test and build commands and summarize failures.", 724, 280, { tools: ["run_validation"], inputs: ["implementation_steps"], outputs: ["test_plan"], permission: "approval-required" }),
      ],
      edges: [
        { from: "scope", to: "plan", label: "spec" },
        { from: "plan", to: "approval", label: "file plan" },
        { from: "approval", to: "builder", label: "approved" },
        { from: "builder", to: "tests", label: "files" },
      ],
      evals: [
        evalTask("file-plan-first", "Build a small dashboard.", "Agent emits a file plan before implementation."),
        evalTask("sandbox-only", "Write app files.", "All outputs stay inside sandbox output directory."),
        evalTask("validation-command", "Finish build.", "Agent names the validation command and result."),
      ],
    },
    sandbox: {
      prompt: "Build a tiny task tracker app with a list, add form, and local-only persistence plan.",
      expectedArtifacts: ["app-spec.md", "file-plan.json", "test-plan.md"],
      requiredTerms: ["component", "route", "test", "sandbox"],
      scenarios: [
        scenario(
          "task-tracker",
          "Build a tiny task tracker app with a list, add form, and local-only persistence plan.",
          ["app-spec.md", "file-plan.json", "test-plan.md"],
          ["component", "route", "test", "sandbox"],
          ["state", "validation", "empty state", "storage"],
          { screens: ["list", "add"], storage: "local-only" },
        ),
        scenario(
          "metrics-dashboard",
          "Plan a local metrics dashboard with CSV import, insight cards, and chart placeholders.",
          ["app-spec.md", "file-plan.json", "test-plan.md"],
          ["dashboard", "component", "test", "sandbox"],
          ["CSV", "chart", "accessibility", "build command"],
          { inputs: ["csv"], charts: 2 },
        ),
        scenario(
          "onboarding-form",
          "Plan an onboarding form app with field validation, review screen, and local export.",
          ["app-spec.md", "file-plan.json", "test-plan.md"],
          ["form", "route", "test", "sandbox"],
          ["validation", "review", "export", "error state"],
          { steps: 2, exportFormat: "json" },
        ),
        scenario(
          "agent-config-editor",
          "Plan a small UI for editing an agent YAML file with validation and preview before saving.",
          ["app-spec.md", "file-plan.json", "test-plan.md"],
          ["YAML", "component", "test", "sandbox"],
          ["preview", "schema", "save gate", "invalid state"],
          { fileType: "agent.yaml", actions: ["edit", "validate", "preview"] },
        ),
      ],
    },
  }),
  structure({
    id: "research-brief-agent",
    label: "Research Brief Agent",
    short: "Collects local sources and writes a cited brief.",
    category: "research",
    spec: {
      patternId: "research-orchestrator",
      projectName: "Research Brief Agent",
      description:
        "Builds a cited brief from approved local or official sources with confidence labels and open questions.",
      autonomy: "delegated-breadth",
      learning: learningProfile({
        domain: "technical research synthesis",
        metrics: ["source quality", "claim provenance", "open-question clarity", "decision usefulness"],
        skills: ["question framing", "source triage", "claim extraction"],
        exemplars: ["framework choice brief", "security review brief", "local model feasibility brief"],
      }),
      inputs: ["research_question", "source_scope", "decision_context"],
      outputs: ["source_index", "claim_table", "research_brief", "open_questions"],
      tools: [
        { name: "collect_sources", responsibility: "Collect source metadata and excerpts.", sideEffect: "read", permission: "allow-read" },
        { name: "extract_claims", responsibility: "Extract claims with source and confidence.", sideEffect: "none", permission: "allow-read" },
        { name: "write_brief", responsibility: "Synthesize findings into a decision brief.", sideEffect: "write", permission: "ask-first" },
      ],
      nodes: [
        node("question", "Question framer", "agent", "Make the research question concrete and scoped.", 42, 180, { outputs: ["research_plan"] }),
        node("sources", "Source collector", "agent", "Collect approved source excerpts and metadata.", 282, 80, { tools: ["collect_sources"], inputs: ["research_plan"], outputs: ["source_index"] }),
        node("claims", "Claim extractor", "agent", "Extract claims with confidence and date context.", 282, 280, { tools: ["extract_claims"], inputs: ["source_index"], outputs: ["claim_table"] }),
        node("synthesis", "Brief writer", "orchestrator", "Write the brief from verified claims only.", 540, 180, { tools: ["write_brief"], inputs: ["claim_table"], outputs: ["research_brief"], permission: "ask-first" }),
        node("gaps", "Open questions", "eval", "List unsupported claims and unresolved decisions.", 770, 180, { inputs: ["research_brief"], outputs: ["open_questions"] }),
      ],
      edges: [
        { from: "question", to: "sources", label: "scope" },
        { from: "sources", to: "claims", label: "sources" },
        { from: "claims", to: "synthesis", label: "claims" },
        { from: "synthesis", to: "gaps", label: "brief" },
      ],
      evals: [
        evalTask("citation-present", "Write a brief.", "Every claim has a source marker or is labeled inferred."),
        evalTask("open-questions", "Synthesize incomplete evidence.", "Open questions section is present."),
        evalTask("source-scope-respected", "Use approved sources only.", "No source outside the allowed scope appears."),
      ],
    },
    sandbox: {
      prompt: "Research whether a local-first visual agent builder should start with a custom loop or a framework.",
      expectedArtifacts: ["source-index.json", "claim-table.json", "research-brief.md"],
      requiredTerms: ["source", "confidence", "framework", "open question"],
      scenarios: [
        scenario(
          "framework-choice",
          "Research whether a local-first visual agent builder should start with a custom loop or a framework.",
          ["source-index.json", "claim-table.json", "research-brief.md"],
          ["source", "confidence", "framework", "open question"],
          ["criterion", "tradeoff", "official", "recommendation"],
          { sourceScope: ["official docs", "research papers"], decision: "framework strategy" },
        ),
        scenario(
          "security-review",
          "Research security considerations for local tool-calling agents with filesystem write access.",
          ["source-index.json", "claim-table.json", "research-brief.md"],
          ["source", "confidence", "security", "open question"],
          ["sandbox", "permission", "credential", "audit"],
          { sourceScope: ["official docs", "security papers"], decision: "sandbox controls" },
        ),
        scenario(
          "local-model-feasibility",
          "Research whether local models are reliable enough for agent planning and artifact generation.",
          ["source-index.json", "claim-table.json", "research-brief.md"],
          ["source", "confidence", "local model", "open question"],
          ["tool use", "evaluation", "constraint", "fallback"],
          { sourceScope: ["model docs", "agent eval papers"], decision: "local default" },
        ),
        scenario(
          "outside-us-agent-labs",
          "Research notable non-US agent labs, startups, and open-source projects relevant to local agent builders.",
          ["source-index.json", "claim-table.json", "research-brief.md"],
          ["source", "confidence", "startup", "open question"],
          ["region", "framework", "evidence", "date"],
          { sourceScope: ["official docs", "lab blogs", "papers"], regions: ["Europe", "Asia"] },
        ),
      ],
    },
  }),
  structure({
    id: "code-review-agent",
    label: "Code Review Agent",
    short: "Finds risks, missing tests, and contract drift.",
    category: "software",
    spec: {
      patternId: "solo-tool-agent",
      projectName: "Code Review Agent",
      description:
        "Reviews code changes with a bug-first stance, focusing on behavioral regressions, dependency drift, and missing tests.",
      autonomy: "human-in-loop",
      learning: learningProfile({
        domain: "code review",
        metrics: ["bug specificity", "contract coverage", "test-gap detection", "false-positive control"],
        skills: ["diff triage", "contract tracing", "risk prioritization"],
        exemplars: ["API route review", "sandbox permission review", "test coverage review"],
      }),
      inputs: ["diff_summary", "changed_files", "test_output"],
      outputs: ["findings", "risk_summary", "test_gaps"],
      tools: [
        { name: "inspect_diff", responsibility: "Read changed files and line references.", sideEffect: "read", permission: "allow-read" },
        { name: "trace_contracts", responsibility: "Map changed interfaces to consumers.", sideEffect: "read", permission: "allow-read" },
        { name: "write_findings", responsibility: "Write findings with severity and line refs.", sideEffect: "write", permission: "ask-first" },
      ],
      nodes: [
        node("diff", "Diff inspector", "agent", "Read the changed files and extract behavioral deltas.", 48, 110, { tools: ["inspect_diff"], outputs: ["diff_notes"] }),
        node("contracts", "Contract tracer", "agent", "Trace interfaces and dependent consumers.", 286, 110, { tools: ["trace_contracts"], inputs: ["diff_notes"], outputs: ["contract_risks"] }),
        node("findings", "Findings writer", "orchestrator", "Prioritize bugs, regressions, and test gaps.", 526, 110, { tools: ["write_findings"], inputs: ["contract_risks"], outputs: ["findings"], permission: "ask-first" }),
        node("verify", "Review verifier", "eval", "Reject vague or uncited review comments.", 760, 110, { inputs: ["findings"], outputs: ["risk_summary", "test_gaps"] }),
      ],
      edges: [
        { from: "diff", to: "contracts", label: "deltas" },
        { from: "contracts", to: "findings", label: "risks" },
        { from: "findings", to: "verify", label: "review" },
      ],
      evals: [
        evalTask("findings-first", "Review a diff.", "Findings lead the output before summary."),
        evalTask("line-reference-required", "Report a bug.", "Every finding has a file or artifact reference."),
        evalTask("test-gap-visible", "Review untested code.", "Missing tests are called out explicitly."),
      ],
    },
    sandbox: {
      prompt: "Review a small app-builder change that adds a build endpoint and generator.",
      expectedArtifacts: ["findings.md", "risk-summary.json", "test-gaps.md"],
      requiredTerms: ["finding", "risk", "test", "contract"],
      scenarios: [
        scenario(
          "build-endpoint",
          "Review a small app-builder change that adds a build endpoint and generator.",
          ["findings.md", "risk-summary.json", "test-gaps.md"],
          ["finding", "risk", "test", "contract"],
          ["line", "severity", "regression", "validation"],
          { changedFiles: ["app/api/build/route.js", "lib/generator.js"] },
        ),
        scenario(
          "permission-bypass",
          "Review a proposed tool runner change that may bypass sandbox write permissions.",
          ["findings.md", "risk-summary.json", "test-gaps.md"],
          ["finding", "risk", "permission", "contract"],
          ["sandbox", "exploit", "guard", "test"],
          { changedFiles: ["sandbox/runner.js", "tools/write.js"] },
        ),
        scenario(
          "missing-tests",
          "Review a UI change that adds agent structure selection but no regression tests.",
          ["findings.md", "risk-summary.json", "test-gaps.md"],
          ["finding", "risk", "test", "contract"],
          ["UI", "state", "selection", "coverage"],
          { changedFiles: ["app/page.js"], testsChanged: false },
        ),
        scenario(
          "dependency-drift",
          "Review a dependency upgrade that changes a framework API used by the generated agent runtime.",
          ["findings.md", "risk-summary.json", "test-gaps.md"],
          ["finding", "risk", "dependency", "contract"],
          ["version", "breaking change", "official docs", "guard"],
          { package: "next", from: "16.2.3", to: "16.2.4" },
        ),
      ],
    },
  }),
  structure({
    id: "earnings-webex-draft-agent",
    label: "Earnings Webex Draft Agent",
    short: "Turns pasted earnings PDFs, transcripts, and decks into a Webex-ready draft.",
    category: "finance",
    spec: {
      patternId: "solo-tool-agent",
      projectName: "Earnings Webex Draft Agent",
      description:
        "Transforms pasted earnings-report PDF text, transcript text, and presentation-deck text into a concise, source-aware update that a human can copy and paste into Webex.",
      autonomy: "local-draft-only",
      runtime: "local-sandbox",
      framework: "custom-loop",
      modelProvider: "ollama",
      sandbox: "local-only-no-network",
      modelProfiles: {
        hardwareTarget: "24GB Apple Silicon MacBook Pro",
        runner: "Ollama",
        contextPolicy: "Default to qwen3:14b with 16K-32K effective prompt budget. Ask for source chunks when the pasted transcript, PDF, and deck exceed the active model context.",
        primary: {
          model: "qwen3:14b",
          install: "ollama run qwen3:14b",
          use: "Primary local reasoning and synthesis model for earnings claim reconciliation and Webex drafting.",
        },
        fallbacks: [
          {
            model: "gemma3:12b",
            install: "ollama run gemma3:12b",
            use: "Fallback for long-source summarization when Qwen is slower or less concise.",
          },
          {
            model: "llama3.1:8b",
            install: "ollama run llama3.1:8b",
            use: "Fast fallback for short updates, formatting passes, and low-latency drafts.",
          },
        ],
        stretch: [
          {
            model: "gemma3:27b",
            install: "ollama run gemma3:27b",
            use: "Optional quality pass if memory pressure is acceptable and the source bundle is chunked.",
          },
          {
            model: "qwen3:30b",
            install: "ollama run qwen3:30b",
            use: "Optional stretch profile for deeper reasoning with smaller chunks and minimal concurrent apps.",
          },
        ],
      },
      learning: learningProfile({
        domain: "earnings-report communications",
        metrics: ["claim traceability", "metric consistency", "guidance-change accuracy", "copy-paste brevity", "unsupported-claim control"],
        skills: ["earnings source reconciliation", "KPI extraction", "executive update drafting", "disclosure-risk spotting", "Webex paste formatting"],
        exemplars: ["quarterly earnings recap", "guidance revision alert", "earnings Q&A risk note"],
      }),
      inputs: [
        "pasted_earnings_pdf_text",
        "pasted_transcript_text",
        "pasted_ppt_text",
        "company_context",
        "audience_profile",
        "webex_thread_context",
      ],
      outputs: [
        "source_inventory",
        "earnings_claim_table",
        "webex_paste_ready_update",
        "quality_check",
        "open_questions",
        "model_run_notes",
        "learning_ledger",
      ],
      tools: [
        { name: "normalize_pasted_earnings_material", responsibility: "Segment pasted PDF, transcript, and deck text into source-labeled sections without reading files or calling external services.", sideEffect: "none", permission: "allow-read" },
        { name: "extract_and_reconcile_earnings_claims", responsibility: "Extract revenue, margin, EPS, guidance, segment, cash-flow, and management-commentary claims, then flag cross-source conflicts and missing evidence.", sideEffect: "none", permission: "allow-read" },
        { name: "draft_webex_paste_update", responsibility: "Draft a concise Webex-ready message with a bottom-line lead, bullets, source markers, and open questions.", sideEffect: "none", permission: "allow-read" },
        { name: "check_paste_ready_update", responsibility: "Reject unsupported numbers, stale guidance, overconfident interpretations, and output that is too long or hard to paste into Webex.", sideEffect: "none", permission: "allow-read" },
      ],
      nodes: [
        node("intake", "Paste intake", "agent", "Normalize pasted PDF, transcript, and deck text into source-labeled sections.", 42, 92, { tools: ["normalize_pasted_earnings_material"], inputs: ["pasted_earnings_pdf_text", "pasted_transcript_text", "pasted_ppt_text"], outputs: ["source_inventory"] }),
        node("extract", "Financial extractor", "agent", "Extract material metrics, guidance, segment notes, management commentary, and Q&A signals with source pointers.", 276, 92, { tools: ["extract_and_reconcile_earnings_claims"], inputs: ["source_inventory", "company_context"], outputs: ["raw_earnings_claims"] }),
        node("reconcile", "Claim reconciler", "orchestrator", "Resolve cross-source conflicts and separate source-backed facts from inferred interpretation.", 510, 92, { inputs: ["raw_earnings_claims"], outputs: ["earnings_claim_table", "open_questions"] }),
        node("draft", "Webex draft writer", "executor", "Draft a copy-paste-ready update with a bottom-line lead, concise bullets, source markers, and explicit open questions.", 510, 286, { tools: ["draft_webex_paste_update"], inputs: ["earnings_claim_table", "audience_profile", "webex_thread_context"], outputs: ["webex_paste_ready_update"] }),
        node("verify", "Paste-ready verifier", "eval", "Check unsupported claims, stale guidance, missing source markers, length, and Webex paste readability.", 744, 188, { tools: ["check_paste_ready_update"], inputs: ["earnings_claim_table", "webex_paste_ready_update", "open_questions"], outputs: ["quality_check", "model_run_notes"] }),
      ],
      edges: [
        { from: "intake", to: "extract", label: "sources" },
        { from: "extract", to: "reconcile", label: "claims" },
        { from: "reconcile", to: "draft", label: "claim table" },
        { from: "draft", to: "verify", label: "candidate update" },
        { from: "reconcile", to: "verify", label: "source evidence" },
      ],
      evals: [
        evalTask("source-provenance-required", "Draft an earnings update from pasted mixed sources.", "Every material financial claim has a source marker or is listed under open questions."),
        evalTask("conflict-visible", "Summarize a transcript and deck with conflicting margin commentary.", "Conflicting claims are flagged instead of averaged or silently resolved."),
        evalTask("no-webex-side-effect", "Prepare a Webex update.", "Agent returns only paste-ready text and never posts, calls Webex APIs, or requires a Webex credential."),
        evalTask("paste-ready-format", "Prepare a Webex reply for executives.", "Draft starts with the bottom line, uses concise bullets, and includes open questions."),
        evalTask("no-unsourced-guidance", "Summarize guidance changes.", "Guidance claims are source-backed, timestamped, or explicitly marked unresolved."),
      ],
      sources: ["ollama-api", "ollama-qwen3", "ollama-gemma3", "ollama-llama3.1"],
    },
    sandbox: {
      prompt: "Create a copy-paste-ready Webex update for a quarterly earnings report using pasted press-release PDF text, call transcript text, and investor deck text.",
      expectedArtifacts: ["source-inventory.json", "earnings-claim-table.json", "webex-paste-ready-update.md", "quality-check.json"],
      requiredTerms: ["revenue", "guidance", "source", "paste-ready", "Webex"],
      scenarios: [
        scenario(
          "quarterly-recap",
          "Create a copy-paste-ready Webex update for a quarterly earnings report using pasted press-release PDF text, call transcript text, and investor deck text.",
          ["source-inventory.json", "earnings-claim-table.json", "webex-paste-ready-update.md", "quality-check.json"],
          ["revenue", "guidance", "source", "paste-ready", "Webex"],
          ["margin", "EPS", "cash flow", "open question"],
          { pastedSources: ["press release text", "transcript text", "investor deck text"], audience: "executive thread" },
        ),
        scenario(
          "guidance-revision",
          "Draft a thread reply when the deck updates full-year guidance but the transcript gives more cautious language.",
          ["claim-conflicts.json", "webex-paste-ready-update.md", "quality-check.json"],
          ["guidance", "source", "conflict", "paste-ready"],
          ["range", "management commentary", "uncertainty", "timestamp"],
          { conflict: "deck guidance vs transcript caution", thread: "earnings watchlist" },
        ),
        scenario(
          "q-and-a-risk",
          "Summarize Q&A risks from the transcript and connect them to metrics in the PDF without inventing analyst sentiment.",
          ["earnings-claim-table.json", "risk-notes.md", "webex-paste-ready-update.md"],
          ["Q&A", "risk", "source", "open question"],
          ["analyst", "management answer", "metric", "unsupported"],
          { transcriptSections: ["prepared remarks", "Q&A"], unsupportedSentiment: true },
        ),
        scenario(
          "missing-source",
          "Prepare a Webex update where one key segment number is missing source support.",
          ["quality-check.json", "open-questions.md", "webex-paste-ready-update.md"],
          ["missing evidence", "source", "open question", "paste-ready"],
          ["no unsupported claim", "segment margin", "human check", "model notes"],
          { missingEvidence: ["segment margin"], outputMode: "copy paste only" },
        ),
      ],
    },
  }),
  structure({
    id: "investment-opportunity-agent",
    label: "Investment Opportunity Agent",
    short: "Reviews deal materials, validates claims, scores fit, and saves recommendation notes.",
    category: "finance",
    spec: {
      patternId: "evaluator-optimizer",
      projectName: "Investment Opportunity Agent",
      description:
        "Assesses private investment opportunities from presentations, PDFs, deal notes, user preference signals, and approved external research, then produces a sourced score, upside case, bear case, review dashboard, and markdown recommendation note.",
      autonomy: "human-in-loop-research",
      runtime: "local-nextjs",
      framework: "custom-loop",
      modelProvider: "openai",
      sandbox: "local-sandbox-approved-web-research",
      learning: learningProfile({
        domain: "private investment diligence",
        metrics: ["preference fit", "claim support", "traction quality", "moat durability", "risk-adjusted upside", "saved recommendation clarity"],
        skills: ["deal-material intake", "investment-thesis matching", "claim validation", "traction and moat scoring", "weight sensitivity analysis", "folder-change detection", "upside and bear-case framing", "markdown recall writing"],
        exemplars: ["CBANSV pitch review", "AI workflow SaaS diligence", "healthcare AI caution review"],
      }),
      inputs: [
        "deal_material_files",
        "deal_folder_selection",
        "prior_folder_change_log",
        "extracted_deck_or_pdf_text",
        "deal_terms",
        "user_preference_profile",
        "llm_wiki_investment_notes",
        "approved_external_research_sources",
      ],
      outputs: [
        "opportunity_summary",
        "preference_fit_scorecard",
        "claim_validation_table",
        "investment_score",
        "upside_case",
        "bear_case",
        "score_source_details",
        "scoring_sensitivity_model",
        "folder_change_log_json",
        "deck_content_diff_log",
        "external_research_validation_report",
        "review_dashboard_html",
        "human_score_and_notes_markdown",
        "learning_ledger",
      ],
      tools: [
        { name: "ingest_deal_materials", responsibility: "Read approved local presentation, PDF, spreadsheet, and note text; preserve source labels and page or slide pointers; extract local text signals where possible; fingerprint selected folder files against a prior folder log when provided.", sideEffect: "read", permission: "allow-read" },
        { name: "load_investment_preferences", responsibility: "Load user-provided preferences, prior LLM-wiki investment feedback, portfolio patterns, and deal-specific constraints before scoring.", sideEffect: "read", permission: "allow-read" },
        { name: "extract_investment_claims", responsibility: "Extract numeric and factual claims about revenue, traction, pipeline, retention, margins, valuation, market, regulation, IP, and team background.", sideEffect: "none", permission: "allow-read" },
        { name: "validate_claims_with_research", responsibility: "Use only approved external research sources or search tools to support, refute, or label each material claim as unresolved with citations, matched terms, and source-fetch status.", sideEffect: "read", permission: "ask-first" },
        { name: "save_review_markdown", responsibility: "Write the human's score, recommendation, notes, final decision rationale, and optional folder-change log to repo-local recall files.", sideEffect: "write", permission: "ask-first" },
      ],
      nodes: [
        node("intake", "Deal intake", "agent", "Normalize presentations, PDFs, spreadsheets, and notes into source-labeled deal material.", 42, 96, { tools: ["ingest_deal_materials"], inputs: ["deal_material_files", "extracted_deck_or_pdf_text"], outputs: ["source_inventory", "deal_brief"] }),
        node("folder-log", "Folder change log", "tool", "Compare all selected deal-folder files against the prior saved log and flag changed, added, removed, and text-diffed deck/material files.", 42, 238, { tools: ["ingest_deal_materials"], inputs: ["deal_folder_selection", "prior_folder_change_log"], outputs: ["folder_change_log_json", "deck_content_diff_log"] }),
        node("preferences", "Preference fit", "tool", "Map the opportunity against user investment preferences, prior investment wiki notes, and stated constraints.", 282, 56, { tools: ["load_investment_preferences"], inputs: ["user_preference_profile", "llm_wiki_investment_notes"], outputs: ["preference_fit_scorecard"] }),
        node("claims", "Claim extractor", "tool", "Extract factual and numerical claims that materially affect investment judgment.", 282, 188, { tools: ["extract_investment_claims"], inputs: ["deal_brief", "deal_terms"], outputs: ["raw_claim_table"] }),
        node("research", "External validation", "tool", "Support, refute, or mark claims unresolved using approved external research, citation notes, matched terms, and source-fetch status.", 522, 188, { tools: ["validate_claims_with_research"], inputs: ["raw_claim_table", "approved_external_research_sources"], outputs: ["claim_validation_table", "external_research_validation_report"], permission: "ask-first" }),
        node("score", "Investment scorer", "orchestrator", "Score the deal across preference fit, traction, moat, market, team, economics, valuation, and evidence confidence.", 522, 56, { inputs: ["deal_brief", "preference_fit_scorecard", "claim_validation_table"], outputs: ["investment_score", "recommendation"] }),
        node("sensitivity", "Scoring sensitivity", "executor", "Expose user-editable scoring weights and show how preference changes affect the score and recommendation.", 746, 18, { inputs: ["investment_score", "preference_fit_scorecard"], outputs: ["scoring_sensitivity_model"] }),
        node("cases", "Scenario writer", "executor", "Write a concise upside case and bear case tied to validated facts, unresolved claims, and decision risks.", 746, 80, { inputs: ["investment_score", "claim_validation_table"], outputs: ["upside_case", "bear_case"] }),
        node("dashboard", "Review dashboard", "executor", "Create a simple HTML dashboard with clickable score details, editable weights, deck slide or page locators, external-source links, and external validation status.", 746, 238, { inputs: ["opportunity_summary", "investment_score", "scoring_sensitivity_model", "upside_case", "bear_case", "external_research_validation_report"], outputs: ["review_dashboard_html", "score_source_details"] }),
        node("save", "Markdown recall", "memory", "Persist the human score, recommendation, notes, scoring weights, folder log, content diff, external validation, and rationale as markdown for future recall.", 962, 238, { tools: ["save_review_markdown"], inputs: ["review_dashboard_html", "human_score", "human_notes", "human_recommendation", "scoring_sensitivity_model", "folder_change_log_json", "deck_content_diff_log", "external_research_validation_report"], outputs: ["human_score_and_notes_markdown"], permission: "ask-first" }),
        node("verify", "Diligence verifier", "eval", "Reject unsupported numbers, unlabeled uncertainty, missing bear case, missing upside case, and markdown without source context.", 962, 84, { inputs: ["claim_validation_table", "investment_score", "upside_case", "bear_case", "human_score_and_notes_markdown"], outputs: ["quality_check"] }),
      ],
      edges: [
        { from: "intake", to: "preferences", label: "deal brief" },
        { from: "intake", to: "claims", label: "source-labeled material" },
        { from: "intake", to: "folder-log", label: "folder inventory" },
        { from: "claims", to: "research", label: "claims" },
        { from: "preferences", to: "score", label: "fit scorecard" },
        { from: "research", to: "score", label: "validation table" },
        { from: "score", to: "sensitivity", label: "score model" },
        { from: "sensitivity", to: "dashboard", label: "editable weights" },
        { from: "score", to: "cases", label: "score + risks" },
        { from: "score", to: "dashboard", label: "summary" },
        { from: "cases", to: "dashboard", label: "scenarios" },
        { from: "dashboard", to: "save", label: "human inputs" },
        { from: "folder-log", to: "verify", label: "change log" },
        { from: "research", to: "verify", label: "evidence" },
        { from: "cases", to: "verify", label: "scenario cases" },
        { from: "save", to: "verify", label: "markdown recall" },
      ],
      evals: [
        evalTask("preference-fit-visible", "Assess an AI SaaS investment from a deck.", "Scorecard explains how the opportunity fits or conflicts with the user's stated investment preferences."),
        evalTask("claim-validation-required", "Review a deck with ARR, retention, pipeline, and customer-count claims.", "Every material number is supported, refuted, deck-only, or unresolved with source context."),
        evalTask("upside-and-bear-required", "Produce an investment recommendation.", "Output includes separate upside and bear cases tied to evidence quality and risks."),
        evalTask("human-notes-saved", "Human enters score and recommendation.", "Dashboard produces a markdown note with score, recommendation, notes, and source context."),
        evalTask("score-sources-visible", "Inspect score details.", "Every score dimension has a recommendation, deck slide or page locator when deck-derived, and external URLs when public validation is used."),
        evalTask("folder-change-log-required", "Select a deal folder with a revised deck.", "Output flags changed, added, removed, and material deck-like files against the prior saved folder log."),
        evalTask("external-source-validation-visible", "Run approved external source validation.", "Output includes external validation verdicts, source links, matched terms, and fetch status for claims with public URLs."),
        evalTask("deck-content-diff-visible", "Select a folder with revised deck text.", "Output includes extracted claim signals and text-level added or removed signals when local extraction is possible."),
        evalTask("not-investment-advice", "Summarize the opportunity.", "Output is framed as diligence support and avoids presenting the score as financial advice."),
      ],
      sources: ["openai-agents-js", "openai-guardrails", "perplexity-prompt-guide"],
    },
    sandbox: {
      prompt: "Assess a private AI workflow SaaS investment from a pitch deck, user preference notes, and approved web research.",
      expectedArtifacts: ["opportunity-summary.md", "investment-scorecard.json", "claim-validation-table.json", "review-dashboard.html", "human-notes.md"],
      requiredTerms: ["investment", "score", "preference", "claim", "upside", "bear", "recommendation"],
      scenarios: [
        scenario(
          "ai-workflow-saas",
          "Assess a private AI workflow SaaS investment from a pitch deck, user preference notes, and approved web research.",
          ["opportunity-summary.md", "investment-scorecard.json", "claim-validation-table.json", "review-dashboard.html", "human-notes.md"],
          ["investment", "score", "preference", "claim", "upside", "bear", "recommendation"],
          ["traction", "moat", "source", "deck-only"],
          { company: "AI workflow SaaS", priorPreference: "AI-native workflow apps with shipped revenue" },
        ),
        scenario(
          "healthcare-ai-caution",
          "Assess a healthcare AI company where revenue exists but regulatory and customer-conversion claims need validation.",
          ["opportunity-summary.md", "investment-scorecard.json", "claim-validation-table.json", "risk-notes.md", "human-notes.md"],
          ["healthcare", "score", "claim", "upside", "bear", "recommendation"],
          ["HIPAA", "pipeline", "validation", "caution"],
          { company: "Healthcare AI", caution: "health diligence is harder without strong validation" },
        ),
        scenario(
          "hardware-wildcard",
          "Assess a hardware-enabled wildcard with strong demand claims but manufacturing and deployment risk.",
          ["opportunity-summary.md", "investment-scorecard.json", "claim-validation-table.json", "review-dashboard.html", "human-notes.md"],
          ["hardware", "score", "claim", "upside", "bear", "recommendation"],
          ["pipeline", "manufacturing", "gross margin", "source"],
          { company: "Hardware recovery platform", wildcard: true },
        ),
        scenario(
          "missing-public-support",
          "Assess an opportunity where the deck claims strong retention and pipeline but public research cannot support the numbers.",
          ["opportunity-summary.md", "claim-validation-table.json", "open-questions.md", "review-dashboard.html", "human-notes.md"],
          ["missing evidence", "score", "claim", "upside", "bear", "recommendation"],
          ["unresolved", "deck-only", "source", "diligence"],
          { unsupportedClaims: ["retention", "pipeline"], requireOpenQuestions: true },
        ),
      ],
    },
  }),
  structure({
    id: "data-analysis-agent",
    label: "Data Analysis Agent",
    short: "Plans analysis, produces insight tables, and chart specs.",
    category: "analysis",
    spec: {
      patternId: "evaluator-optimizer",
      projectName: "Data Analysis Agent",
      description:
        "Analyzes local tabular data through a transparent plan, summary statistics, chart specs, and caveats.",
      autonomy: "quality-loop",
      learning: learningProfile({
        domain: "local data analysis",
        metrics: ["metric relevance", "chart rationale", "caveat coverage", "data-quality handling"],
        skills: ["dataset profiling", "metric selection", "chart specification"],
        exemplars: ["usage analysis", "funnel analysis", "cohort analysis"],
      }),
      inputs: ["dataset_profile", "question", "constraints"],
      outputs: ["analysis_plan", "insight_table", "chart_specs", "caveats"],
      tools: [
        { name: "profile_dataset", responsibility: "Inspect schema and missing values.", sideEffect: "read", permission: "allow-read" },
        { name: "compute_summary", responsibility: "Compute local summary statistics.", sideEffect: "none", permission: "allow-read" },
        { name: "draft_chart_specs", responsibility: "Write chart specs without rendering external assets.", sideEffect: "write", permission: "ask-first" },
      ],
      nodes: [
        node("profile", "Dataset profiler", "agent", "Summarize schema, fields, and caveats.", 50, 120, { tools: ["profile_dataset"], outputs: ["dataset_profile"] }),
        node("plan", "Analysis planner", "agent", "Choose metrics and comparisons before computing.", 286, 120, { inputs: ["dataset_profile"], outputs: ["analysis_plan"] }),
        node("compute", "Summary worker", "executor", "Compute local summaries and insight rows.", 522, 120, { tools: ["compute_summary"], inputs: ["analysis_plan"], outputs: ["insight_table"] }),
        node("charts", "Chart spec writer", "executor", "Create chart specs and caveats.", 742, 70, { tools: ["draft_chart_specs"], inputs: ["insight_table"], outputs: ["chart_specs", "caveats"], permission: "ask-first" }),
        node("verify", "Analysis verifier", "eval", "Check that conclusions follow the data profile and caveats.", 742, 250, { inputs: ["analysis_plan", "insight_table", "chart_specs"], outputs: ["analysis_check"] }),
      ],
      edges: [
        { from: "profile", to: "plan", label: "profile" },
        { from: "plan", to: "compute", label: "analysis plan" },
        { from: "compute", to: "charts", label: "insights" },
        { from: "charts", to: "verify", label: "chart specs" },
      ],
      evals: [
        evalTask("plan-before-insight", "Analyze a dataset.", "Analysis plan appears before conclusions."),
        evalTask("caveats-present", "Summarize data.", "Caveats include missingness or sample-size limits."),
        evalTask("chart-spec-valid", "Create charts.", "Chart specs include type, x, y, and rationale."),
      ],
    },
    sandbox: {
      prompt: "Analyze sample product usage data and recommend two charts for weekly review.",
      expectedArtifacts: ["analysis-plan.md", "insight-table.json", "chart-specs.json"],
      requiredTerms: ["metric", "chart", "caveat", "dataset"],
      scenarios: [
        scenario(
          "usage-review",
          "Analyze sample product usage data and recommend two charts for weekly review.",
          ["analysis-plan.md", "insight-table.json", "chart-specs.json"],
          ["metric", "chart", "caveat", "dataset"],
          ["trend", "segment", "sample size", "rationale"],
          { rows: 120, columns: ["user_id", "week", "actions", "plan"] },
        ),
        scenario(
          "funnel-dropoff",
          "Analyze a signup funnel and identify where activation drops off.",
          ["analysis-plan.md", "insight-table.json", "chart-specs.json"],
          ["metric", "funnel", "caveat", "dataset"],
          ["conversion", "dropoff", "cohort", "recommendation"],
          { steps: ["visit", "signup", "invite", "first_run"], rows: 500 },
        ),
        scenario(
          "retention-cohort",
          "Analyze four weekly cohorts and recommend a retention chart plus caveats.",
          ["analysis-plan.md", "insight-table.json", "chart-specs.json"],
          ["metric", "cohort", "chart", "caveat"],
          ["retention", "baseline", "missingness", "interpretation"],
          { cohorts: 4, metric: "week_4_retention" },
        ),
        scenario(
          "anomaly-check",
          "Analyze a weekly metrics table with one suspicious spike and decide whether to flag it as an anomaly.",
          ["analysis-plan.md", "insight-table.json", "chart-specs.json"],
          ["metric", "anomaly", "chart", "caveat"],
          ["baseline", "outlier", "confidence", "follow-up"],
          { weeks: 12, suspiciousWeek: 9, metric: "runs_created" },
        ),
      ],
    },
  }),
];

export function findAgentStructure(id) {
  return AGENT_STRUCTURES.find((structure) => structure.id === id);
}
