---
name: flowforge
description: "Run structured multi-step workflows via FlowForge engine. Use when: (1) starting a work loop or contribution cycle (打工, contribute, work on issues, PR), (2) studying a project or topic (学习, study, research), (3) reflecting on completed work (反思, reflect, review), (4) any multi-step task that has a defined FlowForge workflow. Triggers on: 打工, 干活, work loop, start working, contribute, study, 学习, reflect, 反思, review code, audit. NOT for: simple one-off tasks, quick questions, or tasks without a matching workflow."
---

# FlowForge Workflow Runner

Execute multi-step workflows defined in YAML files using the FlowForge state machine engine.

## Prerequisites

FlowForge CLI must be installed. Check with:

```bash
flowforge --version
```

If the command fails or is not found, run the setup flow in [setup.md](setup.md) before proceeding.

## My Workflows

| Intent | Workflow |
|--------|----------|
| 打工 / contribute / work on issues / PR | `workloop` |
| 学习 / study / research | `study` |
| 反思 / reflect | `reflect` |
| 代码审查 / review code | `review` |
| 审计 / audit | `daily-audit` |
| 工具回顾 / tool review | `tool-review` |
| 进化 / evolve / 执行审计提案 | `evolve` |

## Core Loop

### 1. Start

```bash
flowforge start <workflow>
```

### 2. Get Action

```bash
flowforge run <workflow>
```

This returns JSON: `{ action: { type, task, branches, ... } }`

### 3. Execute by Action Type

**`type: 'spawn'`** → Node has `executor: subagent`. **MUST spawn a sub-agent:**

```
sessions_spawn(
  task: action.task,
  mode: "run",
  label: "flowforge-<workflow>-<node>"
)
```

Wait for sub-agent to complete. Collect its output.

⚠️ **NEVER execute spawn tasks yourself in the main session.** The whole point of subagent nodes is delegation. If you do it yourself, you're blocking the main session and defeating the purpose.

**`type: 'prompt'`** → Node needs human/agent judgment. Execute the task directly in the main session. This is for decision-making, not heavy work.

**`type: 'complete'`** → Workflow finished. Report results.

### 4. Advance

After getting the result (from sub-agent output or your own work):

```bash
echo "<result summary including 'Branch: N' if applicable>" | flowforge advance
```

Or:

```bash
flowforge advance --result "<result summary>"
```

The result should include `Branch: N` (e.g., "Branch: 1") if the node had branches, so the engine knows which path to take.

### 5. Repeat

Go back to step 2. Loop until `type: 'complete'`.

## Rules

- **spawn = sessions_spawn.** Not exec, not Claude Code CLI, not doing it yourself. OpenClaw sub-agents.
- **Never skip nodes.** Execute every node's task before advancing.
- **Run to completion.** Do not reply to the user mid-workflow. Execute all nodes, then report.
- **State persists.** Workflows survive session restarts. Use `flowforge active` to resume.
- **Post-run:** Record results in `memory/YYYY-MM-DD.md`.

## Manual Mode (when not using run/advance)

If you prefer step-by-step control:

```bash
flowforge status          # See current task
# ... execute task ...
flowforge next --branch N # Advance (N = branch number if branching)
```

## Creating New Workflows

See [references/yaml-format.md](references/yaml-format.md) for YAML spec.

```yaml
name: my-workflow
start: first-node
nodes:
  first-node:
    task: What to do
    executor: subagent    # spawn a sub-agent for this node
    next: second-node
  second-node:
    task: Make a decision
    branches:
      - condition: success
        next: done
      - condition: retry
        next: first-node
  done:
    task: Report results
    terminal: true
```
