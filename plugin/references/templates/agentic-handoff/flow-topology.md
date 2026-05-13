# Flow Topology Template

> Use one flow-topology block per deployed agent system to make the orchestration shape explicit. The block names the topology pattern, who owns state, when the run stops, how retries and human checkpoints behave, what runs in parallel, and what feedback loops are wired in. Pair with the [agent manifest](agent-manifest.md) and any relevant [agent ADRs](agent-adr.md) that justify topology choice.

```yaml
flow_topology:
  pattern: "sequential | parallel | router | orchestrator_worker | evaluator_optimizer | interactive | hybrid"
  why_this_pattern:
  state_owner:                     # which component holds run state (orchestrator, graph checkpointer, session store)
  stop_condition:                  # what marks the run complete or aborted
  retry_policy:                    # retry budget, backoff, terminal failure handling
  human_checkpoint_policy:         # which gates require human approval; see human-checkpoint.md
  parallel_branches:
    - branch_name:
      input:
      output:
      merge_rule:                  # how parallel outputs are combined
  feedback_loops:
    - evaluator:
      criterion:
      max_iterations:
      escalation:                  # what happens if the loop fails to converge
```

Pick the simplest pattern that handles the work. Anthropic's guidance is to start with workflows (predefined code paths) and add agentic dynamism only when the work demonstrably needs it. Routers, orchestrator-worker, and evaluator-optimizer patterns each have specific failure modes — record `why_this_pattern` so a future maintainer can see whether the choice still fits.

**Reference:** `~/dev/research/topics/product-dev/product-dev.agentic-systems-template-pack-addendum-v2.md` (Perplexity v2 addendum, "Flow topology").
