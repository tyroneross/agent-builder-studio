# Artifact Version Template

> Use as the header block on every versioned artifact (requirements, UX blueprint, architecture, data spec, test plan, code, risk register). One agent must not silently overwrite another agent's artifact — every change bumps the version, lists what changed, names the source inputs that drove the change, and records confidence. Pair with the [traceability matrix](traceability-matrix.md) so the chain from need → requirement → test → status stays auditable.

```yaml
artifact_id: "REQ-SET-001"
artifact_type: "requirements | ux | architecture | data | test | code | risk"
version: "0.3"
status: "draft | review | approved | superseded"
created_by: "AGENT-REQ-001"
reviewed_by:
  - "AGENT-SEC-001"
source_inputs:
  - "00-product-brief.md@0.2"
  - "01-user-context.md@0.2"
changes_since_last_version:
  - "Added P0 acceptance criteria for US-003."
open_questions:
  - "OQ-004"
confidence: "low | medium | high"
```

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` (ChatGPT addendum, "Artifact versioning template").
