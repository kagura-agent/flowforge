---
name: flowforge
description: "Run structured multi-step workflows via FlowForge engine. Use when: (1) starting a work loop or contribution cycle (打工, contribute, work on issues, PR), (2) studying a project or topic (学习, study, research), (3) reflecting on completed work (反思, reflect, review), (4) any multi-step task that has a defined FlowForge workflow. Triggers on: 打工, 干活, work loop, start working, contribute, study, 学习, reflect, 反思, review code, audit. NOT for: simple one-off tasks, quick questions, or tasks without a matching workflow."
---

# FlowForge Workflow Runner

Run multi-step workflows defined in FlowForge YAML files. FlowForge is the execution engine (state machine + persistence); this skill is the trigger and coordination layer.

## Prerequisites

FlowForge CLI must be installed. If `flowforge list` fails, read [references/setup.md](references/setup.md) and follow setup instructions.

## Core Workflow

### 1. Pick the Workflow

Run `flowforge list` to see available workflows. Match user intent to a workflow name:

| Intent | Workflow |
|--------|----------|
| 打工 / contribute / work on issues | `workloop` |
| 学习 / study / research | `study` |
| 反思 / reflect | `reflect` |
| 代码审查 / review | `review` |
| 审计 / audit | `daily-audit` |

If no workflow matches, say so — do not run without a workflow.

### 2. Start or Resume

```bash
# Check for active instance first
flowforge active

# If active instance exists for the matching workflow → resume
flowforge status

# If no active instance → start new
flowforge start <workflow>
```

### 3. Execute Current Node

After `flowforge status`, you get the current node's `task` (natural language) and available `branches`.

**Execute the task as described.** The task text is your instruction — follow it, do not skip steps.

For implementation-heavy nodes (writing code, fixing bugs): use ACP to delegate to Claude Code:
```
sessions_spawn(runtime: "acp", agentId: "claude", mode: "run", task: "<context + task>")
```

For lightweight nodes (checking status, reading files, making decisions): execute directly.

### 4. Advance

After completing the node's task, evaluate which branch applies and advance:

```bash
# Linear (no branches)
flowforge next

# Branched — pick the matching condition
flowforge next --branch 1   # first condition matched
flowforge next --branch 2   # second condition matched
```

### 5. Repeat

`flowforge status` → execute task → `flowforge next` → repeat until terminal node or session limit.

### 6. Post-Run

When the workflow reaches a terminal node or you need to pause:
- Record results in `memory/YYYY-MM-DD.md`
- If the workflow defines a reflect step, do not skip it

## Rules

- **Never skip nodes.** The workflow order exists for a reason. If a node feels unnecessary, that is the moment it is most needed.
- **Never run workflows from memory.** Always `flowforge status` to get the actual current node. Do not assume you know where you are.
- **Run to completion in one turn.** Do not reply to the user mid-workflow. Execute all nodes first, then report results at the end. If a node requires spawning a sub-agent, wait for it to finish, then advance — do not reply and pause.
- **State persists across sessions.** If a session ends mid-workflow, the next session picks up from `flowforge status`.
- **One active instance per workflow.** Use `flowforge reset` if stuck.
