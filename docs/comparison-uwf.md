# FlowForge vs United Workforce (UWF) — Comparison Notes

> Date: 2026-06-10. Based on review of shazhou-ww/united-workforce + shazhou-ww/ocas.

## What UWF Is

Stateless multi-agent workflow engine. YAML workflows with roles, status-based routing, directed graph. Threads are immutable CAS-linked chains — each `uwf thread step` runs one moderator→agent→extract cycle and exits.

Key components:
- **OCAS** (Object Content Addressable Store) — self-describing CAS with JSON Schema typed nodes, hash-linked DAG
- **Moderator** — evaluates status-based routing to pick next role
- **Agent adapters** — pluggable CLI binaries (hermes, builtin, claude-code)
- **Extract pipeline** — validates agent output against JSON Schema per role

## Architecture Differences

| | FlowForge | UWF |
|---|---|---|
| **State storage** | SQLite, mutable | OCAS (CAS), immutable DAG + variable pointers |
| **Execution model** | Cron-driven loop: status → work → next | No daemon: each `thread step` is an independent process |
| **Agent model** | External spawn (OpenClaw subagent) | Built-in agent framework with pluggable adapters |
| **Routing** | Manual `--branch N` by executing agent | Moderator auto-evaluates status → selects next role |
| **Workflow definition** | node + next/branches | node + role + status-based routing (directed graph) |
| **Data integrity** | Ordinary SQLite records | CAS hash chain, each step immutable, forkable |
| **Multi-agent** | Single agent self-use | Designed for multi-role orchestration |
| **Output validation** | Agent honor system | JSON Schema extract pipeline per role |

## UWF Design Ideas Worth Learning

1. **CAS immutable chains** — execution history is append-only hash-linked. Can `step fork` from any point. Our SQLite is mutable, weak on replay/audit.
2. **Structured output validation** — each step's output validated against JSON Schema, not relying on agent compliance.
3. **Stateless execution** — no background process, each step is a complete process. Cleaner than session-dependent loops.
4. **Agent adapter layer** — `createAgent` factory unifies different agent backends. Our agent invocation is hardcoded in task text.

## Why UWF Doesn't Fit Our Current Scenario

1. **Our bottleneck isn't the orchestration layer** — FlowForge is sufficient. We get stuck on task execution quality, not workflow engine limitations.
2. **Multi-agent orchestration has lighter alternatives** — Haru+Ren coordination uses Discord channels + team-lead skill, doesn't need engine-level multi-role routing.
3. **CAS adds maintenance cost** — We already have git history + memory files + evolution-log for audit. Another storage layer has unclear ROI.
4. **Only relevant if FlowForge becomes a general product** — agent adapter abstraction matters when other teams use FlowForge, not when it's just Kagura's self-discipline tool.

## What FlowForge Solves

1. **Step skipping** ✅ — forced node traversal, can't bypass scout/reflect/test
2. **Cross-session state loss** ✅ — `flowforge status` resumes from last position
3. **Lesson anchoring** ✅ — each node's task description is a living checklist of past failures
4. **Mandatory reflection** ✅ — reflect + gradient_gate are hard gates before terminal

## What FlowForge Does NOT Solve

1. **Task execution quality** ❌ — ensures you reach a node, can't ensure you do it well. Subagent says "done", FlowForge doesn't verify.
2. **Branch decision integrity** ❌ — `--branch N` is self-selected. Agent is both player and referee. No external validation of routing decisions.
3. **Zero parallelism** ❌ — one execution path per instance. Can't follow up 3 PRs + work 1 new issue simultaneously. Real work is parallel, FlowForge serializes it.
4. **No cross-workflow coordination** ❌ — workloop, study, channel-patrol run independently. Study insights don't auto-influence workloop topic selection.
5. **Workflow bloat** ❌ — workloop.yaml task descriptions are longer than code. Every lesson gets appended to task text, diluting agent attention.
6. **No feedback loop to workflow topology** ❌ — reflect says "review workloop.yaml" but rarely changes workflow structure. Lessons go into task text ≠ improving flow topology.

## One-Line Summary

FlowForge solves **"whether you do it"** (forced step traversal). It does NOT solve **"whether you do it well"** (execution quality and decision quality). Good discipline framework, not a quality framework.
