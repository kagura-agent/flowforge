# CLAUDE.md — Contributor Guide for AI Agents

FlowForge is a lightweight workflow engine for AI agents. It runs YAML-defined state machines with branching, plateau detection, and subagent delegation.

## Project Structure

```
src/
  index.ts      — CLI entry point (Commander.js). All commands defined here.
  engine.ts     — Core engine: start, next, status, reset, getAction, advanceWithResult.
  workflow.ts   — YAML parser + validation. Defines Workflow/WorkflowNode/Branch types.
  db.ts         — SQLite persistence (better-sqlite3). Instances, history, workflows.
  engine.test.ts — Engine tests (vitest)
  workflow.test.ts — Workflow parser tests (vitest)
workflows/     — YAML workflow definitions (study.yaml, workloop.yaml, reflect.yaml, etc.)
scripts/       — Helper scripts (evaluate-candidate.sh, etc.)
dist/          — Built output (esbuild bundle)
bin/           — CLI entry script
```

## Quick Start

```bash
npm install
npm run build    # esbuild → dist/
npm test         # vitest
```

## Key Concepts

- **Workflow**: YAML file with `name`, `start`, and `nodes` map
- **Node**: Has `task` (instruction text), plus `next` (linear), `branches` (conditional), or `terminal: true`
- **Instance**: A running workflow. One active instance per workflow name at a time
- **History**: Every node visit is logged with timestamps. Used for plateau detection
- **Plateau**: If a node is visited ≥ `max_visits` times (default 5), engine warns

## Governance

Architecture constraints, security rules, and common pitfalls live in `.agent/`:
- `.agent/design.md` — What to preserve, how to extend
- `.agent/gotchas.md` — Traps that waste your time
