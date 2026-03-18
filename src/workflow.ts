import * as yaml from "js-yaml";

export interface Branch {
  condition: string;
  next: string;
}

export interface WorkflowNode {
  task: string;
  next?: string;
  branches?: Branch[];
  terminal?: boolean;
}

export interface Workflow {
  name: string;
  description?: string;
  start: string;
  nodes: Record<string, WorkflowNode>;
}

export function parseWorkflow(content: string): Workflow {
  const doc = yaml.load(content) as Record<string, unknown>;
  if (!doc || typeof doc !== "object") throw new Error("Invalid YAML");
  if (!doc.name || typeof doc.name !== "string") throw new Error("Missing 'name'");
  if (!doc.start || typeof doc.start !== "string") throw new Error("Missing 'start'");
  if (!doc.nodes || typeof doc.nodes !== "object") throw new Error("Missing 'nodes'");

  const wf: Workflow = {
    name: doc.name,
    description: doc.description as string | undefined,
    start: doc.start,
    nodes: doc.nodes as Record<string, WorkflowNode>,
  };

  if (!(wf.start in wf.nodes)) {
    throw new Error(`Start node '${wf.start}' not found in nodes`);
  }

  for (const [name, node] of Object.entries(wf.nodes)) {
    if (!node.task) throw new Error(`Node '${name}' missing 'task'`);
    if (!node.next && !node.branches && !node.terminal) {
      throw new Error(`Node '${name}' must have 'next', 'branches', or 'terminal: true'`);
    }
    if (node.next && typeof node.next !== "string") {
      throw new Error(`Node '${name}' has invalid 'next'`);
    }
    if (node.branches) {
      for (const b of node.branches) {
        if (!b.condition || !b.next) {
          throw new Error(`Node '${name}' has invalid branch`);
        }
        if (!(b.next in wf.nodes)) {
          throw new Error(`Node '${name}' branch points to unknown node '${b.next}'`);
        }
      }
    }
    if (node.next && !(node.next in wf.nodes)) {
      throw new Error(`Node '${name}' next points to unknown node '${node.next}'`);
    }
  }

  return wf;
}
