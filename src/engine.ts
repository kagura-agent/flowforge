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
  if (!row) {
    const all = db.listWorkflows();
    const hint = all.length
      ? `\nKnown workflows: ${all.map(w => w.name).join(', ')}`
      : '\nNo workflows defined yet.';
    throw new Error(`Workflow '${name}' not found.${hint}`);
  }
  return parseWorkflow(row.yaml_content);
}

function requireActiveInstance(workflowName?: string) {
  const inst = db.getActiveInstance(workflowName);
  if (!inst) {
    const workflows = db.listWorkflows();
    const available = workflows.length
      ? `\nAvailable workflows: ${workflows.map(w => w.name).join(', ')}\n\nExample: flowforge start ${workflows[0].name}`
      : '\nNo workflows defined. Use: flowforge start <path-to-yaml>';
    throw new Error(`No active instance.${available}`);
  }
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
    console.warn(`⚠️  Auto-closing stale instance #${existing.id} (was at node '${existing.current_node}')`);
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

export function next(branch?: number, workflowName?: string) {
  const inst = requireActiveInstance(workflowName);
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
        `Branch ${branch} out of range (1-${node.branches.length}). Valid branches:\n${lines.join('\n')}\n\nExample: flowforge next --branch 1`
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

  // Close current history entry, move to next node, open new history entry
  db.closeHistory(inst.id, inst.current_node, branchTaken);
  db.updateInstanceNode(inst.id, nextNode);
  db.addHistory(inst.id, nextNode);

  const nextNodeDef = wf.nodes[nextNode];
  return {
    from: inst.current_node,
    to: nextNode,
    branchTaken,
    task: nextNodeDef.task,
    branches: nextNodeDef.branches || null,
    hasNext: !!nextNodeDef.next,
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

  let task = node.task;
  if (previousResult) {
    task = `${task}\n\nPrevious result:\n${previousResult}`;
  }

  if (node.terminal) {
    return {
      type: 'complete',
      instanceId: inst.id,
      workflowName: inst.workflow_name,
      node: inst.current_node,
      task,
      previousResult,
    };
  }

  if (node.executor === 'subagent') {
    return {
      type: 'spawn',
      instanceId: inst.id,
      workflowName: inst.workflow_name,
      node: inst.current_node,
      task,
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
    previousResult,
  };
}

export function stats(workflowName?: string) {
  const workflowStats = db.getWorkflowStats();
  const guideposts = db.getGuideposts();
  const topBranches = db.getTopBranches(workflowName);

  const nodeStats = workflowName ? db.getNodeStats(workflowName) : null;

  return { workflowStats, guideposts, topBranches, nodeStats };
}

export function advanceWithResult(result: string, workflowName?: string): FlowAction {
  // Parse result to extract branch choice (looks for 'Branch: N' or 'branch N' pattern)
  let branch: number | undefined;
  const branchMatch = result.match(/\bbranch:?\s*(\d+)\b/i);
  if (branchMatch) {
    branch = parseInt(branchMatch[1], 10);
  } else {
    // Check if current node has branches — if so, warn that no branch was detected
    const inst = db.getActiveInstance(workflowName);
    if (inst) {
      const wf = loadWorkflow(inst.workflow_name);
      const node = wf.nodes[inst.current_node];
      if (node?.branches) {
        console.warn(`⚠️  Current node has ${node.branches.length} branches but no 'Branch: N' found in result. Will prompt for branch selection.`);
      }
    }
  }

  // Advance to next node
  const nextResult = next(branch, workflowName);

  if (nextResult.terminal) {
    const inst = db.getActiveInstance(workflowName);
    if (!inst) throw new Error("No active instance found");
    return {
      type: 'complete',
      instanceId: inst.id,
      workflowName: inst.workflow_name,
      node: "(end)",
      task: "",
    };
  }

  // Get the next action
  return getAction(workflowName, result);
}

