# Design Constraints

## Engine stays minimal

The engine (`engine.ts`) is a pure state machine driver. It should not contain domain logic (what study means, what workloop does). All domain knowledge lives in YAML workflow `task` fields. The engine just advances nodes.

## Workflows are the product

YAML workflow files are the primary user-facing artifact. They define agent behavior. Treat changes to workflow YAML with the same care as code changes — they directly alter agent execution.

## One active instance per workflow

The engine enforces at most one active instance per workflow name. Starting a new instance auto-closes the previous one. This is intentional — it prevents orphaned state machines.

## SQLite is the truth

All state lives in `flowforge.db`. No JSON files, no in-memory state that survives restarts. The DB schema is in `db.ts` with `CREATE TABLE IF NOT EXISTS` (idempotent migrations).

## No ORM, no abstraction layers

`better-sqlite3` is used directly. Queries are plain SQL strings in `db.ts`. Don't introduce query builders or ORMs.

## CLI is a thin wrapper

`index.ts` parses args and calls engine functions. Business logic belongs in `engine.ts`, not the CLI layer. Output formatting is inline (console.log) — no separate formatter module needed at current scale.

## Extend via YAML, not code

New workflow behavior should be expressed as new YAML nodes, branches, and task descriptions. Code changes should only be needed for new engine capabilities (new node types, new execution modes), not for new workflow patterns.

## Plateau detection is a guardrail, not a blocker

When a node is visited ≥ `max_visits` times, the engine warns but does NOT block progression. The agent decides whether to heed the warning. This is by design — hard blocks in agent workflows cause worse failures than loops.
