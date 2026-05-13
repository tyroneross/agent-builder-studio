# Assumption Log Template

> Use one entry per assumption the agent system makes when human input is sparse. The assumption log is how an agent system stays honest under ambiguity — every inference is named, scored for confidence, scored for impact-if-wrong and reversibility, given a validation path, and tracked to a status. Pair with the [confidence score](../../methodology/13-agentic-product-dev-synthesis.md#confidence-scoring) decision rule when deciding whether the agent may proceed on the assumption or must escalate.

```yaml
assumption_id: "ASSUMP-001"
statement: "The product is intended for alpha users only."
source: "inferred from 'v0 alpha' language"
confidence: "medium"
impact_if_wrong: "high | medium | low"
reversibility: "high | medium | low"
validation_path: "Ask product owner or inspect target launch plan."
owner: "human | agent"
status: "open | validated | rejected | superseded"
```

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-design-chatgpt.md` (ChatGPT addendum, "Assumption log template").
