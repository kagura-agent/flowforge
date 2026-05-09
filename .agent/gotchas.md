# Common Gotchas

## YAML node validation is strict

Every node must have exactly one of: `next`, `branches`, or `terminal: true`. The parser throws on missing/invalid combinations. If you add a new node, make sure it has an exit path.

## Branch indices are 1-based

CLI users type `--branch 1`, not `--branch 0`. The engine converts to 0-based internally. Off-by-one here breaks the entire flow.

## `start()` auto-closes stale instances

If an active instance already exists for a workflow, `start()` silently closes it and creates a new one. This means calling `start` is NOT idempotent — it resets progress. Don't call `start` when you mean `status`.

## History entries must be closed

`addHistory()` creates an open entry (no `left_at`). `closeHistory()` closes it. If you add new state transitions, make sure every `addHistory` has a matching `closeHistory` — unclosed entries break duration tracking.

## `advanceWithResult()` parses branch from free text

It regex-matches `branch: N` or `branch N` from the result string. This is fragile — if agent output contains "branch" in other contexts, it may advance the wrong way. When in doubt, use `next(branch)` directly.

## DB migrations run at import time

`db.ts` executes `CREATE TABLE IF NOT EXISTS` statements when the module is first imported. This means tests share the DB schema. Use `:memory:` or temp DBs in tests to avoid cross-test contamination.

## Workflow YAML is stored in DB

`define()` stores the raw YAML in the database. The engine loads workflows from DB, not from disk. If you edit a YAML file, you must re-run `flowforge start <file>` to update the DB copy.

## esbuild bundles everything

The build produces a single `dist/index.js` bundle. Dependencies like `better-sqlite3` (native addon) are excluded via `external`. If you add a new native dependency, add it to the `external` list in `esbuild.config.mjs`.
