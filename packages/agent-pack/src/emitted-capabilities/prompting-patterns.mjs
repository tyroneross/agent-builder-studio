// Prompting-pattern ladder + plugin-architecture component model (item 09).
//
// Encoded from the decision-doctor-cc design docs so every generated agent
// inherits reliable-workflow structure by default:
//   docs/'Advanced Prompting Patterns for Reliable AI Workflows.md'
//   docs/'AI Plugin Architecture  Skills, Scripts, Hooks, MCP Servers & Scaffolding.md'
// (both at ~/dev/git-folder/decision-doctor-cc/). These sections are emitted
// into prompts/prompt-builder-contract.md and skills/skill-contract.md.

export function buildPromptingLadderSection() {
  return `## Prompting Pattern Ladder

Start with the simplest prompt that can work; climb ONLY when the current
rung's failure mode demands it:

1. Direct structured prompt — single-step tasks that are easy to review.
2. Add examples (few-shot) — when output style or category boundaries are ambiguous.
3. Add a schema — when output feeds code, a database, or another AI step.
4. Add reasoning scaffolding — when the task requires multi-step judgment.
5. Add retrieval (RAG) — when the answer must be grounded in external documents.
6. Add tools (ReAct, bounded) — when the model must inspect, calculate, fetch, or change something.
7. Add evaluation prompts — when the prompt will be reused or shipped in a product.

If a technique adds cost, latency, or complexity without changing the failure
mode, do not use it.

### Quick pattern map

| Failure mode / need | Pattern |
|---|---|
| Better summary | Chain-of-Density |
| Hard answer | Concise reasoning scaffold |
| Reliable categories | Few-shot + schema |
| Decision among paths | Tree-of-Thoughts |
| External facts | RAG |
| API or file actions | ReAct with bounded tools |
| Iterative quality | Reflexion + explicit criteria |
| Software-ready output | Structured outputs |
| Confidence before shipping | Evaluation prompts |

### Local-model note (measured)

The in-repo DOE (evals/doe/) measured 3B local models: a hard "Return ONLY
the JSON object" suffix RAISES JSON pass rate (+0.10) and cuts latency, while
inlining the full JSON schema in the prompt LOWERS it (-0.22; small models
echo the schema). Prefer terse field lists + strict suffix on the local lane;
reserve full schema enforcement for providers with native structured outputs.
`;
}

export function buildComponentModelSection() {
  return `## Component Placement Model

When adapting this package into a host (Claude Code, Codex, or another
agent runtime), place each behavior by WHO decides to act:

| Component | Who triggers | Determinism | Context cost |
|---|---|---|---|
| Rules / CLAUDE.md-style briefs | Always on | Probabilistic (model interprets) | Always paid |
| Skills | The agent (auto-detected) | Probabilistic | Paid when relevant |
| Commands | The user (explicit invocation) | Deterministic (injected) | Paid when used |
| Hooks | The system (lifecycle events) | Deterministic (enforced) | Zero (outside model) |
| Scripts | Called by hooks or skills | Deterministic | Zero (outside model) |
| MCP servers | The agent (tool calls) | Semi-deterministic | Paid per invocation |
| Subagents | The parent agent or user | Isolated probabilistic | Separate budget |

Placement rules:

- Anything that MUST happen (validation, safety gates, telemetry) belongs in
  hooks or scripts — never in prose the model may skip.
- Knowledge the agent should discover contextually belongs in skills, with
  clear trigger descriptions.
- One-shot operator workflows belong in commands.
- Per-node skills from skills/skill-bank.json map to host skills or subagents
  ONLY when isolated context is useful; otherwise keep them as sections of
  the operating skill.
`;
}
