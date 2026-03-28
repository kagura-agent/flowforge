# FlowForge

Enforced workflow engine for AI agents — YAML-defined, CLI-driven state machine that prevents agents from skipping steps.

## Install

```bash
npm install -g @kagura-agent/flowforge
```

## Quick Start

### 1. Create a workflow YAML

```yaml
name: my-workflow
description: Example workflow
start: plan

nodes:
  plan:
    task: Plan the implementation
    next: execute

  execute:
    task: Execute the plan
    next: review

  review:
    task: Review the results
    terminal: true
```

Save this as `workflows/my-workflow.yaml` (FlowForge auto-discovers workflows from the `workflows/` directory).

### 2. Run the workflow

```bash
# Workflows are auto-loaded from workflows/ directory
flowforge list

# Start an instance
flowforge start my-workflow

# Check current status
flowforge status

# Complete current node and advance
flowforge next

# View execution history
flowforge log
```

## Workflow Auto-Loading

FlowForge automatically discovers and loads workflows from:
1. `./workflows/` in your current directory
2. `~/.flowforge/workflows/` in your home directory

Simply drop `.yaml` or `.yml` files into these directories and they're immediately available. No need to manually run `flowforge define`.

## YAML Format Reference

### Node Types

**Linear node** (moves to single next node):
```yaml
nodes:
  step1:
    task: Do something
    next: step2
```

**Branching node** (multiple possible paths):
```yaml
nodes:
  check:
    task: Evaluate condition
    branches:
      - condition: success
        next: continue
      - condition: failure
        next: retry
```

**Terminal node** (end of workflow):
```yaml
nodes:
  done:
    task: Finalize and report
    terminal: true
```

### Node Fields

- `task` (required): Natural language description of what to do at this node
- `next` (optional): Name of next node for linear flow
- `branches` (optional): Array of condition-based paths for branching
- `terminal` (optional): Set to `true` to mark as end node

## CLI Commands

| Command | Description |
|---------|-------------|
| `flowforge define <yaml>` | Register or update a workflow |
| `flowforge start <workflow>` | Start new workflow instance |
| `flowforge status` | Show current node, task, and branches |
| `flowforge next [--branch N]` | Complete current node and advance |
| `flowforge log` | View execution history |
| `flowforge list` | List all defined workflows |
| `flowforge active` | List active workflow instances |
| `flowforge reset` | Reset current instance to start |

## Example Workflow

```yaml
name: code-contribution
description: Generic open source contribution workflow
start: study

nodes:
  study:
    task: |
      Read project structure, contribution guidelines, and identify
      the issue or feature to work on
    next: implement

  implement:
    task: Write code changes according to project patterns
    next: test

  test:
    task: Run tests and verify implementation works
    branches:
      - condition: tests pass
        next: submit
      - condition: tests fail
        next: implement

  submit:
    task: Create pull request with clear description
    next: verify

  verify:
    task: Monitor PR feedback and address review comments
    terminal: true
```

Save as `contribution.yaml`, then:

```bash
flowforge define contribution.yaml
flowforge start code-contribution
```

## How It Works

FlowForge enforces step-by-step execution:

1. Define workflows as YAML (nodes + transitions)
2. Start an instance of a workflow
3. Execute the task at current node
4. Advance with `flowforge next` (or `--branch N` for branching nodes)
5. Repeat until terminal node

State persists in SQLite database at `~/.flowforge/`. Workflows can be paused and resumed across sessions.

## Use Cases

- **AI agent workflows**: Prevent agents from skipping critical steps (e.g., always run tests before submitting)
- **Structured processes**: Codify learning, contribution, or review workflows
- **State machines**: Implement branching logic with conditions and history tracking

## License

MIT
