// Threat-modeler emitted skill (follow-up item 04).
//
// Trigger taxonomy: a generated spec "crosses a risk surface" when it touches
// any of the five surfaces below. Detection is keyword + structure based
// (tool side effects, permission posture, memory persistence) so it stays
// deterministic and testable. When >=1 surface is crossed the generator emits
// skills/threat-modeler.skill.md (condensed from the threat-modeler plugin at
// ~/dev/git-folder/threat-modeler/plugin/) plus a skill-bank entry naming the
// crossed surfaces.

import { specText } from "./doc-ingest.mjs";

const RISK_SURFACES = [
  {
    id: "auth-boundary",
    label: "Authentication / identity boundary",
    keywords: ["auth", "login", "oauth", "session", "sso", "identity", "permission grant"],
  },
  {
    id: "secrets",
    label: "Secrets and credentials",
    keywords: ["secret", "api key", "api_key", "credential", "token", "password", "keychain"],
  },
  {
    id: "network-exposure",
    label: "Network exposure / external calls",
    keywords: ["webhook", "http", "external api", "fetch", "endpoint", "network", "scrape", "crawl"],
  },
  {
    id: "sensitive-persistence",
    label: "Persistence of sensitive or user data",
    keywords: ["user data", "pii", "personal", "patient", "financial", "customer record", "health"],
  },
  {
    id: "destructive-writes",
    label: "Destructive or production writes",
    keywords: ["delete", "deploy", "production", "publish", "overwrite", "migration"],
  },
];

export function detectRiskSurfaces(spec) {
  const text = specText(spec);
  const crossed = [];
  for (const surface of RISK_SURFACES) {
    const hits = surface.keywords.filter((k) => text.includes(k));
    if (hits.length > 0) crossed.push({ id: surface.id, label: surface.label, signals: hits });
  }
  // Structural signals independent of wording:
  const writeTools = (spec.tools ?? []).filter((t) => !["none", "read"].includes(t.sideEffect));
  if (writeTools.length > 0 && !crossed.some((c) => c.id === "destructive-writes")) {
    crossed.push({
      id: "destructive-writes",
      label: "Destructive or production writes",
      signals: writeTools.map((t) => `tool:${t.name} sideEffect:${t.sideEffect}`),
    });
  }
  const persistentMemory = typeof spec.memory === "string" && /durable|persistent|long-term|vector|database/i.test(spec.memory);
  if (persistentMemory && !crossed.some((c) => c.id === "sensitive-persistence")) {
    crossed.push({ id: "sensitive-persistence", label: "Persistence of sensitive or user data", signals: [`memory:${spec.memory}`] });
  }
  return crossed;
}

export function threatModelerSkillEntry(manifest, crossed) {
  return {
    id: `${manifest.slug}-threat-modeler-skill`,
    type: "emitted-capability",
    title: "Threat modeler skill",
    purpose: "Produce a threat-model artifact before building or modifying any risk-surface element of this agent.",
    whenToUse: `Load BEFORE implementing changes that touch: ${crossed.map((c) => c.label).join("; ")}.`,
    inputs: ["proposed change or design", "crossed risk surfaces"],
    outputs: ["threat-model markdown artifact"],
    tools: [],
    permission: "ask-first",
    riskSurfaces: crossed,
    requiredFiles: ["skills/threat-modeler.skill.md"],
  };
}

export function buildThreatModelerSkillMarkdown(spec, crossed) {
  return `# Threat Modeler Skill

Auto-emitted because this agent's spec crosses risk surfaces:

${crossed.map((c) => `- **${c.label}** (signals: ${c.signals.join(", ")})`).join("\n")}

Condensed from the threat-modeler plugin (STRIDE + OWASP LLM/Agentic cross-map).

## When to run

Before building or modifying anything on a crossed surface: a new tool, MCP
server, LLM call path, persistent memory store, auth boundary, external API,
or user-data flow. A plan that introduces a risk-surface change without a
threat-model artifact is incomplete.

## Procedure

1. **Confirm the trigger.** Name the risk-surface signal(s). If none apply,
   stop — do not produce ritual threat models for safe changes.
2. **Frame the system.** Assets (what an attacker wants), actors (who can
   touch the system, including the LLM itself), trust boundaries.
3. **Describe the data flow.** Where untrusted input enters, where it is
   interpreted by an LLM, where side effects execute, where data persists.
4. **Apply STRIDE per element.** Spoofing, Tampering, Repudiation,
   Information disclosure, Denial of service, Elevation of privilege.
5. **Cross-map to OWASP.** LLM Top 10 (prompt injection, insecure output
   handling, excessive agency...) and Agentic threats (tool misuse, memory
   poisoning, cascading hallucination, goal manipulation).
6. **Mitigations + residual risk + decision log.** Every identified threat
   gets a mitigation, an explicit acceptance, or an open question with an
   owner. Record what was decided and why.

## Output contract

A markdown artifact stored with the agent package (suggested:
\`memory/threat-models/<change>.md\`) containing: assets, actors, data-flow
description, STRIDE table, OWASP cross-map, mitigations, residual risk,
decision log. Keep it honest: an empty mitigation column means the work is
not done.

## Operating rules

- Untrusted content (documents, web pages, user uploads) routed into prompts
  is an injection path — say so explicitly in the model.
- Tools with side effects (${(spec.tools ?? []).filter((t) => !["none", "read"].includes(t.sideEffect)).map((t) => `\`${t.name}\``).join(", ") || "none declared"}) are elevation-of-privilege candidates.
- Never store credentials in prompts, manifests, memory files, or examples.
- Re-run this skill when the tool registry, permission policy, or memory
  configuration changes.
`;
}
