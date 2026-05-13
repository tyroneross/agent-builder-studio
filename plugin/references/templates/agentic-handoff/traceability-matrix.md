# Traceability Matrix Template

> Use as the single artifact that proves every P0 user need flows through the system end to end — from need to story to requirement to UX flow to entity to test, with a current status. The QA / Evaluation agent owns this matrix. A row that is missing any column is a build risk; a row whose test is not yet written is a buildable-but-unverified scope item.

| User need | Story | Requirement | UX flow | Entity/data | Test | Status |
|---|---|---|---|---|---|---|
| NEED-001 | US-001 | REQ-001 | FLOW-001 | ENT-001 | TEST-001 | pass / fail / missing |
| NEED-002 | US-002 | REQ-002 | FLOW-002 | ENT-002 | TEST-002 | pass / fail / missing |

## Conventions

- One row per P0 user need at minimum. P1 needs may share rows or be tracked in a sibling table.
- A `Status` of `missing` means the artifact in that column does not yet exist — surface as a build blocker.
- A `Status` of `fail` means the test exists but does not pass yet — track in the defect log.
- The Spec Review Agent should refuse to mark spec lint as passing if any P0 row has missing columns.
- The Coding Agent should not start build until every P0 row has at minimum a need, story, requirement, and test placeholder.

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` (ChatGPT addendum, "Traceability matrix template").
