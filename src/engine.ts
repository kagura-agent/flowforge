import { parseWorkflow, type Workflow, type WorkflowNode } from "./workflow.js";
import * as db from "./db.js";

function loadWorkflow(name: string): Workflow {
  const row = db.getWorkflow(name);
  if (!row) throw new Error(`Workflow '${name}' not found`);
  return parseWorkflow(row.yaml_content);
}

function requireActiveInstance(workflowName?: string) {
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
  if (existing) {
    throw new Error(
      `Workflow '${workflowName}' already has an active instance (id=${existing.id}). Use 'flowforge reset' to restart.`
    );
  }
  const id = db.createInstance(workflowName, wf.start);
  db.addHistory(id, wf.start);
  return { id, node: wf.start };
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
      throw new Error(`Branch must be between 1 and ${node.branches.length}`);
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
