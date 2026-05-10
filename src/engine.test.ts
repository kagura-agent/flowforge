import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock db before importing engine
vi.mock("./db.js", () => {
  const workflows: Record<string, { id: number; name: string; yaml_content: string }> = {};
  const instances: Array<{ id: number; workflow_name: string; current_node: string; status: string; created_at: string; updated_at: string }> = [];
  const history: Array<{ instance_id: number; node_name: string; branch_taken: string | null; entered_at: string; exited_at: string | null }> = [];
  let nextId = 1;

  return {
    _reset() {
      Object.keys(workflows).forEach(k => delete workflows[k]);
      instances.length = 0;
      history.length = 0;
      nextId = 1;
    },
    _instances: instances,
    upsertWorkflow(name: string, yaml: string) {
      workflows[name] = { id: nextId++, name, yaml_content: yaml };
    },
    getWorkflow(name: string) {
      return workflows[name];
    },
    listWorkflows() {
      return Object.values(workflows).map(w => ({ name: w.name, updated_at: "2024-01-01" }));
    },
    createInstance(workflowName: string, startNode: string) {
      const id = nextId++;
      instances.push({ id, workflow_name: workflowName, current_node: startNode, status: "active", created_at: "", updated_at: "" });
      return id;
    },
    getActiveInstance(workflowName?: string) {
      const found = workflowName
        ? instances.find(i => i.workflow_name === workflowName && i.status === "active")
        : instances.find(i => i.status === "active");
      return found ? { ...found } : undefined;
    },
    listActiveInstances() {
      return instances.filter(i => i.status === "active");
    },
    updateInstanceNode(id: number, node: string) {
      const inst = instances.find(i => i.id === id);
      if (inst) inst.current_node = node;
    },
    setInstanceStatus(id: number, status: string) {
      const inst = instances.find(i => i.id === id);
      if (inst) inst.status = status;
    },
    addHistory(instanceId: number, nodeName: string) {
      history.push({ instance_id: instanceId, node_name: nodeName, branch_taken: null, entered_at: "", exited_at: null });
    },
    closeHistory(instanceId: number, nodeName: string, branchTaken: string | null) {
      const h = history.find(h => h.instance_id === instanceId && h.node_name === nodeName && !h.exited_at);
      if (h) { h.exited_at = "now"; h.branch_taken = branchTaken; }
    },
    getHistory(instanceId: number) {
      return history.filter(h => h.instance_id === instanceId);
    },
    getNodeVisitCount(instanceId: number, nodeName: string) {
      return history.filter(h => h.instance_id === instanceId && h.node_name === nodeName).length;
    },
  };
});

import * as engine from "./engine.js";
import * as db from "./db.js";

const linearYaml = `
name: linear
start: step1
nodes:
  step1:
    task: do step 1
    next: step2
  step2:
    task: do step 2
    terminal: true
`;

const branchYaml = `
name: branchy
start: decide
nodes:
  decide:
    task: make a decision
    branches:
      - condition: left
        next: left_node
      - condition: right
        next: right_node
  left_node:
    task: go left
    terminal: true
  right_node:
    task: go right
    terminal: true
`;

const subagentYaml = `
name: sub
start: s1
nodes:
  s1:
    task: agent task
    executor: subagent
    next: s2
  s2:
    task: done
    terminal: true
`;

beforeEach(() => {
  (db as any)._reset();
});

describe("define", () => {
  it("registers a workflow and returns name", () => {
    const name = engine.define(linearYaml);
    expect(name).toBe("linear");
  });

  it("throws on invalid yaml", () => {
    expect(() => engine.define("bad: yaml")).toThrow();
  });
});

describe("start", () => {
  it("creates an instance at start node", () => {
    engine.define(linearYaml);
    const result = engine.start("linear");
    expect(result.node).toBe("step1");
    expect(result.previouslyClosed).toBeNull();
  });

  it("auto-closes existing active instance", () => {
    engine.define(linearYaml);
    const first = engine.start("linear");
    const second = engine.start("linear");
    expect(second.previouslyClosed).toBe(first.id);
  });

  it("throws for unknown workflow", () => {
    expect(() => engine.start("nope")).toThrow("not found");
    // Also check helpful suggestion is included
    expect(() => engine.start("nope")).toThrow("flowforge list");
  });
});

describe("status", () => {
  it("returns current node info", () => {
    engine.define(linearYaml);
    engine.start("linear");
    const s = engine.status("linear");
    expect(s.currentNode).toBe("step1");
    expect(s.task).toBe("do step 1");
    expect(s.hasNext).toBe(true);
    expect(s.terminal).toBe(false);
  });

  it("throws with no active instance", () => {
    expect(() => engine.status("linear")).toThrow("No active instance");
  });
});

describe("next", () => {
  it("advances linearly", () => {
    engine.define(linearYaml);
    engine.start("linear");
    const result = engine.next(undefined, "linear");
    expect(result.from).toBe("step1");
    expect(result.to).toBe("step2");
    expect(result.task).toBe("do step 2");
  });

  it("handles terminal node", () => {
    engine.define(linearYaml);
    engine.start("linear");
    engine.next(undefined, "linear"); // -> step2
    const result = engine.next(undefined, "linear"); // terminal
    expect(result.terminal).toBe(true);
    expect(result.to).toBe("(end)");
  });

  it("follows branch", () => {
    engine.define(branchYaml);
    engine.start("branchy");
    const result = engine.next(2, "branchy");
    expect(result.to).toBe("right_node");
    expect(result.branchTaken).toBe("right");
  });

  it("throws when branch required but not given", () => {
    engine.define(branchYaml);
    engine.start("branchy");
    expect(() => engine.next(undefined, "branchy")).toThrow("has branches");
  });

  it("throws on invalid branch number", () => {
    engine.define(branchYaml);
    engine.start("branchy");
    expect(() => engine.next(5, "branchy")).toThrow("Invalid branch 5");
  });
});

describe("log", () => {
  it("returns history entries", () => {
    engine.define(linearYaml);
    engine.start("linear");
    engine.next(undefined, "linear");
    const result = engine.log("linear");
    expect(result.workflowName).toBe("linear");
    expect(result.entries.length).toBeGreaterThanOrEqual(2);
  });
});

describe("list", () => {
  it("lists defined workflows", () => {
    engine.define(linearYaml);
    const result = engine.list();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("linear");
  });
});

describe("active", () => {
  it("lists active instances", () => {
    engine.define(linearYaml);
    engine.start("linear");
    const result = engine.active();
    expect(result).toHaveLength(1);
  });
});

describe("reset", () => {
  it("closes old instance and creates new one at start", () => {
    engine.define(linearYaml);
    const first = engine.start("linear");
    engine.next(undefined, "linear"); // advance to step2
    const result = engine.reset("linear");
    expect(result.node).toBe("step1");
    expect(result.id).not.toBe(first.id);
  });
});

describe("getAction", () => {
  it("returns prompt for inline node", () => {
    engine.define(linearYaml);
    engine.start("linear");
    const action = engine.getAction("linear");
    expect(action.type).toBe("prompt");
    expect(action.node).toBe("step1");
  });

  it("returns spawn for subagent node", () => {
    engine.define(subagentYaml);
    engine.start("sub");
    const action = engine.getAction("sub");
    expect(action.type).toBe("spawn");
  });

  it("returns complete for terminal node", () => {
    engine.define(linearYaml);
    engine.start("linear");
    engine.next(undefined, "linear"); // -> step2 (terminal)
    const action = engine.getAction("linear");
    expect(action.type).toBe("complete");
  });

  it("appends previousResult to task", () => {
    engine.define(linearYaml);
    engine.start("linear");
    const action = engine.getAction("linear", "some result");
    expect(action.task).toContain("some result");
    expect(action.previousResult).toBe("some result");
  });
});

describe("advanceWithResult", () => {
  it("advances linearly with result", () => {
    engine.define(linearYaml);
    engine.start("linear");
    const action = engine.advanceWithResult("done", "linear");
    expect(action.node).toBe("step2");
    expect(action.type).toBe("complete"); // step2 is terminal
  });

  it("parses branch from result", () => {
    engine.define(branchYaml);
    engine.start("branchy");
    const action = engine.advanceWithResult("Branch: 1", "branchy");
    expect(action.node).toBe("left_node");
  });

  it("throws when terminal reached and instance already closed", () => {
    engine.define(linearYaml);
    engine.start("linear");
    engine.next(undefined, "linear"); // -> step2
    expect(() => engine.advanceWithResult("finishing", "linear")).toThrow("No active instance");
  });
});

const loopYaml = `
name: looper
start: work
nodes:
  work:
    task: do work
    next: work
`;

const loopCustomYaml = `
name: looper_custom
start: work
nodes:
  work:
    task: do work
    max_visits: 3
    next: work
`;

describe("plateau detection", () => {
  it("triggers plateauWarning after 5 visits (default)", () => {
    engine.define(loopYaml);
    engine.start("looper");
    // start adds 1 history entry for 'work'. Each next() closes + re-adds 'work'.
    // After start: 1 visit. After next() x4: 5 visits. The 5th next should warn.
    for (let i = 0; i < 4; i++) {
      const r = engine.next(undefined, "looper");
      expect(r.plateauWarning).toBeUndefined();
    }
    const result = engine.next(undefined, "looper");
    expect(result.plateauWarning).toBeDefined();
    expect(result.plateauWarning).toContain("work");
    expect(result.plateauWarning).toContain("limit: 5");
  });

  it("triggers earlier with custom max_visits", () => {
    engine.define(loopCustomYaml);
    engine.start("looper_custom");
    // After start: 1 visit. After next() x2: 3 visits. The 3rd next should warn.
    for (let i = 0; i < 2; i++) {
      const r = engine.next(undefined, "looper_custom");
      expect(r.plateauWarning).toBeUndefined();
    }
    const result = engine.next(undefined, "looper_custom");
    expect(result.plateauWarning).toBeDefined();
    expect(result.plateauWarning).toContain("limit: 3");
  });

  it("has no warning for normal linear flow", () => {
    engine.define(linearYaml);
    engine.start("linear");
    const result = engine.next(undefined, "linear");
    expect(result.plateauWarning).toBeUndefined();
    expect(result.plateauLevel).toBe('ok');
    expect(result.blocked).toBe(false);
  });

  it("graduates from nudge to block after limit+2", () => {
    engine.define(loopCustomYaml);
    engine.start("looper_custom");
    // max_visits=3. Start=1 visit. next() x2 = 3 visits (nudge on 3rd).
    for (let i = 0; i < 2; i++) {
      engine.next(undefined, "looper_custom");
    }
    // 3rd next: nudge level (visits=3, limit=3)
    const nudge = engine.next(undefined, "looper_custom");
    expect(nudge.plateauLevel).toBe('nudge');
    expect(nudge.blocked).toBe(false);
    expect(nudge.plateauWarning).toContain('LOOP DETECTED');

    // 4th next: still nudge (visits=4, limit=3, not yet limit+2=5)
    const stillNudge = engine.next(undefined, "looper_custom");
    expect(stillNudge.plateauLevel).toBe('nudge');
    expect(stillNudge.blocked).toBe(false);

    // 5th next: block (visits=5, limit+2=5)
    const blocked = engine.next(undefined, "looper_custom");
    expect(blocked.plateauLevel).toBe('block');
    expect(blocked.blocked).toBe(true);
    expect(blocked.plateauWarning).toContain('BLOCKED');
  });

  it("allows --force to override block", () => {
    engine.define(loopCustomYaml);
    engine.start("looper_custom");
    // Advance to block state: max_visits=3, need visits=5 (limit+2)
    for (let i = 0; i < 4; i++) {
      engine.next(undefined, "looper_custom");
    }
    // This should be blocked
    const blocked = engine.next(undefined, "looper_custom");
    expect(blocked.blocked).toBe(true);

    // Force override
    const forced = engine.next(undefined, "looper_custom", true);
    expect(forced.blocked).toBe(false);
    expect(forced.plateauLevel).toBe('block');
    expect(forced.plateauWarning).toContain('BLOCKED');
  });
});
