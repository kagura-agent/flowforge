import { parseWorkflow, type Workflow, type WorkflowNode, type Branch } from "./workflow.js";
import * as db from "./db.js";

export interface FlowAction {
  type: 'spawn' | 'prompt' | 'complete';
  instanceId: number;
  workflowName: string;
  node: string;
  task: string;
  branches?: Branch[];
  previousResult?: string;
}

function loadWorkflow(name: string): Workflow {
  const row = db.getWorkflow(name);
  if (!row) throw new Error(`Workflow '${name}' not found. Use 'flowforge list' to see available workflows.`);
  return parseWorkflow(row.yaml_content);
}

function requireActiveInstance(workflowName?: string) {
  if (!workflowName) {
    // When no -w flag, check if multiple instances are active
    const all = db.listActiveInstances();
    if (all.length > 1) {
      const lines = all.map(a => `  - ${a.workflow_name} (#${a.id}, at node '${a.current_node}')`);
      throw new Error(
        `Multiple active instances — use -w to specify which one:\n${lines.join("\n")}\n\nExample: flowforge next -w ${all[0].workflow_name}`
      );
    }
  }
  const inst = db.getActiveInstance(workflowName);
  if (!inst) throw new Error("No active instance. Use 'flowforge start <workflow>' first.");
  return inst;
}

export function define(yamlContent: string) {
  const wf = parseWorkflow(yamlContent);
  db.upsertWorkflow(wf.name, yamlContent);
  return wf.name;
}

export function start(workflowName: string) {
  const wf = loadWorkflow(workflowName);
  const existing = db.getActiveInstance(workflowName);
  let previousId: number | null = null;
  if (existing) {
    // Auto-close stale active instance instead of throwing
    db.closeHistory(existing.id, existing.current_node, null);
    db.setInstanceStatus(existing.id, "done");
    previousId = existing.id;
  }
  const id = db.createInstance(workflowName, wf.start);
  db.addHistory(id, wf.start);
  return { id, node: wf.start, previouslyClosed: previousId };
}

export function status(workflowName?: string) {
  const inst = requireActiveInstance(workflowName);
  const wf = loadWorkflow(inst.workflow_name);
  const node = wf.nodes[inst.current_node];
  if (!node) throw new Error(`Node '${inst.current_node}' not found in workflow`);

  return {
    instanceId: inst.id,
    workflowName: inst.workflow_name,
    workflowDescription: wf.description,
    currentNode: inst.current_node,
    task: node.task,
    branches: node.branches || null,
    hasNext: !!node.next,
    nextNode: node.next || null,
    terminal: !!node.terminal,
  };
}

export function next(branch?: number, workflowName?: string, force?: boolean, fromNode?: string, result?: string) {
  const inst = requireActiveInstance(workflowName);

  // Guard: if fromNode is specified, only advance if we're still at that node.
  // This prevents double-advance when both subagent and parent try to advance.
  if (fromNode && inst.current_node !== fromNode) {
    return {
      from: fromNode,
      to: inst.current_node,
      branchTaken: null,
      task: '',
      branches: null,
      hasNext: true,
      terminal: false,
      skipped: true,  // Signal: already advanced past this node
    };
  }

  const wf = loadWorkflow(inst.workflow_name);
  const node = wf.nodes[inst.current_node];
  if (!node) throw new Error(`Node '${inst.current_node}' not found`);

  let nextNode: string;
  let branchTaken: string | null = null;

  if (node.branches) {
    if (branch === undefined) {
      const lines = node.branches.map((b, i) => `  ${i + 1}. ${b.condition} → ${b.next}`);
      throw new Error(
        `This node has branches. Use --branch <N>:\n${lines.join("\n")}`
      );
    }
    if (branch < 1 || branch > node.branches.length) {
      const lines = node.branches.map((b, i) => `  ${i + 1}. ${b.condition} → ${b.next}`);
      throw new Error(
        `Invalid branch ${branch}. Valid options (1-${node.branches.length}):\n${lines.join("\n")}\n\nExample: flowforge next --branch 1`
      );
    }
    const chosen = node.branches[branch - 1];
    nextNode = chosen.next;
    branchTaken = chosen.condition;
  } else if (node.next) {
    nextNode = node.next;
  } else if (node.terminal) {
    // Terminal node — close history and mark instance as done
    db.closeHistory(inst.id, inst.current_node, null);
    db.setInstanceStatus(inst.id, "done");
    return {
      from: inst.current_node,
      to: "(end)",
      branchTaken: null,
      task: "",
      branches: null,
      hasNext: false,
      terminal: true,
    };
  } else {
    throw new Error("Node has no next, branches, or terminal — this should not happen");
  }

  // Graduated loop detection (inspired by AIDE's LoopDetector pattern):
  //   observe  → visits < limit: silent, just track
  //   nudge    → visits = limit: warn + inject reflection into task
  //   block    → visits >= limit + 2: hard block, refuse to advance without --force
  let plateauWarning: string | undefined;
  let plateauLevel: 'ok' | 'nudge' | 'block' = 'ok';
  const visits = db.getNodeVisitCount(inst.id, nextNode);
  const limit = wf.nodes[nextNode]?.max_visits ?? 5;
  if (visits >= limit + 2) {
    plateauLevel = 'block';
    plateauWarning = `⛔ BLOCKED: Node '${nextNode}' visited ${visits} times (limit: ${limit}). You are looping without progress. Use --force to override, or choose a different branch/strategy.`;
  } else if (visits >= limit) {
    plateauLevel = 'nudge';
    plateauWarning = `⚠️ LOOP DETECTED: Node '${nextNode}' visited ${visits} times (limit: ${limit}). Before continuing, reflect: Are you making real progress or repeating the same approach? What would you do differently?`;
  }

  // Block advancement if plateau level is 'block' (unless forced)
  if (plateauLevel === 'block' && !force) {
    return {
      from: inst.current_node,
      to: nextNode,
      branchTaken,
      task: '',
      branches: null,
      hasNext: false,
      plateauWarning,
      plateauLevel,
      blocked: true,
    };
  }

  // Close current history entry, move to next node, open new history entry
  // Store only a bounded, deliberately redacted handoff summary. Raw command
  // output belongs in a purpose-built artifact, not the workflow database.
  const resultSummary = result?.trim().slice(0, 2000) || null;
  db.closeHistory(inst.id, inst.current_node, branchTaken, resultSummary);
  db.updateInstanceNode(inst.id, nextNode);
  db.addHistory(inst.id, nextNode);

  const nextNodeDef = wf.nodes[nextNode];

  // Auto-close if we just moved to a terminal node
  if (nextNodeDef.terminal) {
    db.closeHistory(inst.id, nextNode, null);
    db.setInstanceStatus(inst.id, "done");
    return {
      from: inst.current_node,
      to: nextNode,
      branchTaken,
      task: nextNodeDef.task,
      branches: null,
      hasNext: false,
      terminal: true,
      plateauWarning,
      plateauLevel,
      blocked: false,
    };
  }

  return {
    from: inst.current_node,
    to: nextNode,
    branchTaken,
    task: nextNodeDef.task,
    branches: nextNodeDef.branches || null,
    hasNext: !!nextNodeDef.next,
    plateauWarning,
    plateauLevel,
    blocked: false,
  };
}

export function log(workflowName?: string) {
  const inst = requireActiveInstance(workflowName);
  return {
    workflowName: inst.workflow_name,
    instanceId: inst.id,
    entries: db.getHistory(inst.id),
  };
}

export function list() {
  return db.listWorkflows();
}

export function active() {
  return db.listActiveInstances();
}

export function reset(workflowName?: string) {
  const inst = requireActiveInstance(workflowName);
  const wf = loadWorkflow(inst.workflow_name);

  // Mark old instance as done
  db.closeHistory(inst.id, inst.current_node, null);
  db.setInstanceStatus(inst.id, "done");

  // Start fresh
  const id = db.createInstance(inst.workflow_name, wf.start);
  db.addHistory(id, wf.start);
  return { id, node: wf.start };
}

export function getAction(workflowName?: string, previousResult?: string): FlowAction {
  const inst = requireActiveInstance(workflowName);
  const wf = loadWorkflow(inst.workflow_name);
  const node = wf.nodes[inst.current_node];
  if (!node) throw new Error(`Node '${inst.current_node}' not found`);

  const resumeResult = previousResult ?? db.getMostRecentResult(inst.id);
  let task = node.task;
  if (resumeResult) {
    task = `${task}\n\nPrevious node result (redacted handoff):\n${resumeResult}`;
  }

  if (node.terminal) {
    return {
      type: 'complete',
      instanceId: inst.id,
      workflowName: inst.workflow_name,
      node: inst.current_node,
      task,
      previousResult: resumeResult,
    };
  }

  if (node.executor === 'subagent') {
    // Append self-advance instruction so subagents can advance the workflow
    // even if the parent session expires (common in cron-triggered flows).
    // --from-node guard prevents double-advance if parent also advances.
    const advanceCmd = `cd ${process.env.HOME || '~'}/.openclaw/workspace/flowforge && node dist/flowforge.js next -w ${inst.workflow_name} --from-node ${inst.current_node}`;
    const advanceFooter = [
      '',
      '---',
      '⚠️ **WORKFLOW ADVANCEMENT (mandatory final step):**',
      'After completing ALL tasks above, run this command to advance the workflow:',
      '```',
      advanceCmd,
      '```',
      'Do NOT skip this step. The workflow will stall if you don\'t advance it.',
    ].join('\n');

    return {
      type: 'spawn',
      instanceId: inst.id,
      workflowName: inst.workflow_name,
      node: inst.current_node,
      task: task + advanceFooter,
      branches: node.branches,
      previousResult,
    };
  }

  return {
    type: 'prompt',
    instanceId: inst.id,
    workflowName: inst.workflow_name,
    node: inst.current_node,
    task,
    branches: node.branches,
    previousResult: resumeResult,
  };
}

export function cleanup(staleHours: number = 24) {
  return db.cleanupStaleInstances(staleHours);
}

export function advanceWithResult(result: string, workflowName?: string): FlowAction {
  // Parse result to extract branch choice (looks for 'Branch: N' or 'branch N' pattern)
  let branch: number | undefined;
  const branchMatch = result.match(/\bbranch:?\s*(\d+)\b/i);
  if (branchMatch) {
    branch = parseInt(branchMatch[1], 10);
  }

  // Advance to next node
  const nextResult = next(branch, workflowName, false, undefined, result);

  if (nextResult.terminal) {
    return {
      type: 'complete',
      instanceId: 0, // instance already closed by next()
      workflowName: workflowName || '',
      node: nextResult.to,
      task: nextResult.task || '',
    };
  }

  // Get the next action
  return getAction(workflowName);
}
