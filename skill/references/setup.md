# FlowForge Setup

## Install

FlowForge is a Node.js CLI tool with SQLite persistence.

### From Source

```bash
cd <flowforge-dir>
npm install
npm run build
```

### Verify

```bash
flowforge --version
flowforge list
```

If `flowforge` is not in PATH, use the full path: `node <flowforge-dir>/dist/flowforge.js`

## Define Workflows

Workflows are YAML files in `<flowforge-dir>/workflows/`. Register them:

```bash
flowforge define workflows/workloop.yaml
flowforge define workflows/study.yaml
```

## Workflow YAML Format

```yaml
name: my-workflow
description: "What this workflow does"
start: first-node

nodes:
  first-node:
    task: |
      Natural language description of what to do at this step.
    branches:
      - condition: "When X is true"
        next: node-a
      - condition: "When Y is true"
        next: node-b

  node-a:
    task: |
      Another step.
    next: node-b

  node-b:
    task: |
      Final step.
    terminal: true
```

### Node Fields

- `task`: Natural language instruction (required)
- `next`: Next node for linear progression
- `branches`: Array of `{condition, next}` for conditional branching
- `terminal: true`: Marks the end of the workflow

## Database

FlowForge uses SQLite (`flowforge.db` in the FlowForge directory) to persist:
- Workflow definitions
- Active instances (current node, history)

If the DB is corrupted or empty (0 bytes), delete it and re-define workflows:
```bash
rm flowforge.db
flowforge define workflows/*.yaml
```
