# FlowForge — Enforced Workflow Engine for AI Agents

## Problem
AI agents skip steps, take shortcuts, and don't follow processes unless mechanically forced.
This tool enforces workflows by blocking state transitions until all required conditions are met.

## Core Concept
- **Workflow**: A named state machine defined in YAML
- **Instance**: A running instance of a workflow, tracking current state and history
- **Gate**: A condition that MUST be satisfied before moving to the next state
- Gates can be: manual checklist items, automated checks (shell commands), or time-based waits

## CLI Interface

```bash
# Workflow management
flowforge define <workflow.yaml>     # Register a workflow definition
flowforge list                       # List all workflow definitions
flowforge show <workflow>            # Show workflow definition with states

# Instance lifecycle
flowforge start <workflow> [--context key=value]  # Start a new instance
flowforge status [instance-id]       # Show current state, pending gates, history
flowforge active                     # List all active instances

# Gate operations (THE CORE)
flowforge check <instance-id>        # Run all auto-checks for current state
flowforge complete <instance-id> <gate-name>  # Mark a manual gate as done
flowforge advance <instance-id>      # Try to advance to next state (fails if gates not met)
flowforge force <instance-id> <state>  # Force transition (requires --reason, logged as violation)

# History
flowforge history <instance-id>      # Full transition history with timestamps
```

## Workflow YAML Schema

```yaml
name: contribute
description: "Open source contribution workflow"

context:
  - repo        # required context variables
  - issue_number

states:
  study:
    description: "Understand the project before coding"
    gates:
      - name: read_contributing
        type: manual
        description: "Read CONTRIBUTING.md and understand conventions"
      - name: check_no_competing_pr
        type: auto
        command: "gh pr list -R {{repo}} --search '{{issue_number}}' --state open --json number --jq length"
        expect: "0"
        description: "No competing PRs for this issue"
    next: implement

  implement:
    description: "Write the code"
    gates:
      - name: tests_pass
        type: auto
        command: "npm test"
        expect_exit: 0
        description: "All tests pass locally"
      - name: code_committed
        type: auto
        command: "git status --porcelain"
        expect: ""
        description: "All changes committed"
    next: submit

  submit:
    description: "Push and create PR"
    gates:
      - name: pr_created
        type: auto
        command: "gh pr view --json number --jq .number 2>/dev/null"
        expect_not: ""
        description: "PR exists on GitHub"
    next: post_submit_check

  post_submit_check:
    description: "Wait for CI and automated review"
    gates:
      - name: wait_ci
        type: wait
        duration: 5m
        description: "Wait 5 minutes for CI to start"
      - name: ci_passing
        type: auto
        command: "gh pr checks --json state --jq '.[] | select(.state != \"SUCCESS\" and .state != \"SKIPPED\") | .state' | head -1"
        expect: ""
        description: "All CI checks pass"
      - name: review_checked
        type: auto
        command: "gh pr view --json comments --jq '.comments | length'"
        expect_not: ""
        description: "Checked for review comments"
      - name: review_addressed
        type: manual
        description: "All automated review feedback has been addressed"
    next: await_human_review

  await_human_review:
    description: "Wait for maintainer review"
    gates:
      - name: has_review
        type: auto
        command: "gh pr view --json reviews --jq '[.reviews[] | select(.state == \"APPROVED\" or .state == \"CHANGES_REQUESTED\")] | length'"
        expect_not: "0"
        description: "Maintainer has reviewed"
    on:
      changes_requested: respond
    next: done

  respond:
    description: "Address review feedback"
    gates:
      - name: changes_pushed
        type: auto
        command: "git log --oneline -1 --format=%s"
        expect_not: ""
        description: "Fix commit pushed"
      - name: tests_pass
        type: auto
        command: "npm test"
        expect_exit: 0
    next: post_submit_check

  done:
    description: "PR merged or closed"
    terminal: true

# Enforcement rules
enforcement:
  block_parallel: true          # Can't start new instance while one is active
  require_reason_for_force: true  # Force transitions must explain why
  log_violations: true          # Track every time force was used
```

## Data Storage
- SQLite database at `~/.flowforge/flowforge.db`
- Tables: workflows, instances, gates, transitions, violations
- Each transition logged with timestamp, from_state, to_state, gates_satisfied

## Key Design Decisions
1. **Gates are blocking** — `advance` fails with a clear error showing which gates aren't met
2. **Auto-checks are re-runnable** — `check` can be run repeatedly until conditions are met
3. **Force exists but is logged** — escape hatch for emergencies, but creates a paper trail
4. **Context variables** — `{{repo}}`, `{{issue_number}}` are substituted in commands
5. **block_parallel** — prevents the exact problem of abandoning one PR to start another

## Tech Stack
- TypeScript + Node.js
- SQLite (better-sqlite3)
- YAML parsing (js-yaml)
- Single binary via esbuild
