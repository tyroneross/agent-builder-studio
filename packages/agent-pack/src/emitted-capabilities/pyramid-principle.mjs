// Pyramid-principle emitted skill (follow-up item 05).
//
// Generated agents that PRODUCE documents (reports, memos, briefs, summaries,
// decks, emails) get a condensed pyramid-principle writing skill in their
// skill bank (source: ~/dev/git-folder/pyramid-principle/skills/).

import { specText } from "./doc-ingest.mjs";

const DOC_PRODUCER_SIGNALS = [
  "report",
  "memo",
  "brief",
  "summary",
  "summarize",
  "writeup",
  "write-up",
  "document",
  "one-pager",
  "deck",
  "presentation",
  "email draft",
  "newsletter",
  "executive",
  "narrative",
];

export function detectDocProducer(spec) {
  // Outputs and node outputs are the strongest signal; description is backup.
  const outputText = [
    ...(spec.outputs ?? []),
    ...(spec.nodes ?? []).flatMap((n) => n.outputs ?? []),
    spec.description ?? "",
  ]
    .join(" \n ")
    .toLowerCase();
  const hits = DOC_PRODUCER_SIGNALS.filter((s) => outputText.includes(s));
  if (hits.length > 0) return { needed: true, signals: hits };
  // Fall back to full-spec text only for the unambiguous signals.
  const text = specText(spec);
  const strong = ["report", "memo", "executive summary", "one-pager"].filter((s) => text.includes(s));
  return { needed: strong.length > 0, signals: strong };
}

export function pyramidSkillEntry(manifest) {
  return {
    id: `${manifest.slug}-pyramid-principle-skill`,
    type: "emitted-capability",
    title: "Pyramid-principle writing skill",
    purpose: "Structure every produced document answer-first: governing thought on top, MECE key line beneath, evidence below.",
    whenToUse: "Load when a node produces a report, memo, brief, summary, or any prose deliverable for a human reader.",
    inputs: ["synthesis results", "audience", "the question being answered"],
    outputs: ["pyramid-structured document"],
    tools: [],
    permission: "allow",
    requiredFiles: ["skills/pyramid-principle.skill.md"],
  };
}

export function buildPyramidSkillMarkdown() {
  return `# Pyramid Principle Writing Skill

Auto-emitted because this agent produces documents. Condensed from the
pyramid-principle skill family (Minto).

## Core rule

Start with the answer. The governing thought — the single sentence the reader
came for — goes first. Everything beneath it exists to support it.

## The three rules of valid groupings

1. Ideas at any level must SUMMARIZE the ideas grouped below them.
2. Ideas in each grouping must be the SAME KIND of idea (MECE: mutually
   exclusive, collectively exhaustive).
3. Ideas in each grouping must be LOGICALLY ORDERED — pick one: deductive,
   chronological, structural, or by importance.

## SCQA introduction

Open documents with Situation (agreed context), Complication (what changed),
Question (what the reader now asks), Answer (your governing thought). Keep it
short; the reader should hit the answer within the first paragraph.

## Vertical and horizontal logic

- Vertical: each statement raises a question in the reader's mind; the level
  below must answer exactly that question and nothing else.
- Horizontal: ideas within a level relate deductively (premise -> therefore)
  or inductively (parallel members of one class). Never mix within a grouping.

## Working procedure for this agent

1. Name the reader's question.
2. Write the one-sentence answer (governing thought).
3. Lay out the key line: 2-5 MECE supports, logically ordered.
4. Attach evidence under each support; cut anything that supports nothing.
5. Final check: can a skimming reader extract the position from headings and
   first sentences alone? If not, restructure — do not pad.

## LLM adaptation

Local/small models drift into chronology-of-work narratives ("first I did X").
Reject that shape: the reader needs the answer, not the journey. Re-order
before emitting.
`;
}
