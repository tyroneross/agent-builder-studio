# Evaluation Deliverable Template

> Use when the skill is in `evaluation` or `design + evaluation` mode. Findings first, fixes second. Never present an evaluation as a design.

---

## 1. Summary

One paragraph: what harness was reviewed, what the headline problems are, whether the design is salvageable in place or needs a rebuild.

## 2. Findings (ordered by severity / leverage)

For each finding:

- **Title** — short phrase
- **Severity** — critical / high / medium / low
- **Evidence** — file path, code snippet, log excerpt, or observed symptom. No vibes.
- **Why it matters** — failure mode, cost, user impact
- **Root cause** — harness component involved (cite `catalog/02-harness-components.md § N`)

Order by severity first, then by leverage (cheap-to-fix big-impact items above expensive-to-fix ones of the same severity).

## 3. Missing or Weak Primitives

Which harness primitives are absent or under-specified. Use the harness component vocabulary:

| Primitive | State | Notes |
|---|---|---|
| Capability registry | missing / weak / adequate | |
| Permission layer | missing / weak / adequate | |
| Approval gates | missing / weak / adequate | |
| Workflow state | missing / weak / adequate | |
| Resumability | missing / weak / adequate | |
| Context assembly | missing / weak / adequate | |
| Memory provenance | missing / weak / adequate | |
| Evaluation loop | missing / weak / adequate | |
| Observability | missing / weak / adequate | |

## 4. UX & Operational Gaps

- What the user can't see that they should
- What operators can't debug when something breaks
- Cost/latency surprises with no instrumentation
- Support paths that require code reading to resolve

## 5. Prioritized Upgrade Path

Ordered list. For each step:

- **Action** — what to change
- **Primitive affected** — from the table above
- **Expected effect** — which findings it closes
- **Effort** — rough t-shirt (S/M/L)
- **Risk** — what could regress

Favor sequences where the first two items close the critical findings and the rest are opportunistic improvements.

## 6. Confirmation Tests

For each fix, name the test or check that proves it landed:

- **Fix** — reference to upgrade path step
- **Test** — golden task, permission boundary probe, crash-recovery script, replay regression, eval metric threshold
- **Pass criteria** — concrete observable

No fix is "done" without a confirmation test the user can run.

## 7. Out Of Scope

Items surfaced during evaluation that are real issues but outside this engagement. List them so the user can triage later without rediscovering them.

---

*Template · Agent Builder original evaluation output contract*
