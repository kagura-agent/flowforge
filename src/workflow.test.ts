import { describe, it, expect } from "vitest";
import { parseWorkflow } from "./workflow.js";

const minimal = `
name: test
start: a
nodes:
  a:
    task: do A
    terminal: true
`;

const linear = `
name: linear
start: a
nodes:
  a:
    task: do A
    next: b
  b:
    task: do B
    terminal: true
`;

const branching = `
name: branchy
start: a
nodes:
  a:
    task: do A
    branches:
      - condition: yes
        next: b
      - condition: no
        next: c
  b:
    task: do B
    terminal: true
  c:
    task: do C
    terminal: true
`;

describe("parseWorkflow", () => {
  it("parses a minimal workflow", () => {
    const wf = parseWorkflow(minimal);
    expect(wf.name).toBe("test");
    expect(wf.start).toBe("a");
    expect(wf.nodes.a.task).toBe("do A");
    expect(wf.nodes.a.terminal).toBe(true);
  });

  it("parses linear workflow", () => {
    const wf = parseWorkflow(linear);
    expect(wf.nodes.a.next).toBe("b");
  });

  it("parses branches", () => {
    const wf = parseWorkflow(branching);
    expect(wf.nodes.a.branches).toHaveLength(2);
    expect(wf.nodes.a.branches![0].next).toBe("b");
  });

  it("includes description when present", () => {
    const wf = parseWorkflow("name: x\ndescription: hello\nstart: a\nnodes:\n  a:\n    task: t\n    terminal: true\n");
    expect(wf.description).toBe("hello");
  });

  it("throws on invalid YAML", () => {
    expect(() => parseWorkflow("")).toThrow("Invalid YAML");
  });

  it("throws on missing name", () => {
    expect(() => parseWorkflow("start: a\nnodes:\n  a:\n    task: t\n    terminal: true")).toThrow("Missing 'name'");
  });

  it("throws on missing start", () => {
    expect(() => parseWorkflow("name: x\nnodes:\n  a:\n    task: t\n    terminal: true")).toThrow("Missing 'start'");
  });

  it("throws on missing nodes", () => {
    expect(() => parseWorkflow("name: x\nstart: a")).toThrow("Missing 'nodes'");
  });

  it("throws when start node not in nodes", () => {
    expect(() => parseWorkflow("name: x\nstart: z\nnodes:\n  a:\n    task: t\n    terminal: true")).toThrow("Start node 'z' not found");
  });

  it("throws when node missing task", () => {
    expect(() => parseWorkflow("name: x\nstart: a\nnodes:\n  a:\n    next: a")).toThrow("missing 'task'");
  });

  it("throws when node has no next, branches, or terminal", () => {
    expect(() => parseWorkflow("name: x\nstart: a\nnodes:\n  a:\n    task: t")).toThrow("must have 'next', 'branches', or 'terminal");
  });

  it("throws when next points to unknown node", () => {
    expect(() => parseWorkflow("name: x\nstart: a\nnodes:\n  a:\n    task: t\n    next: z")).toThrow("unknown node 'z'");
  });

  it("throws when branch points to unknown node", () => {
    const bad = `
name: x
start: a
nodes:
  a:
    task: t
    branches:
      - condition: yes
        next: missing
`;
    expect(() => parseWorkflow(bad)).toThrow("unknown node 'missing'");
  });

  it("throws on branch missing condition", () => {
    const bad = `
name: x
start: a
nodes:
  a:
    task: t
    branches:
      - next: a
`;
    expect(() => parseWorkflow(bad)).toThrow("invalid branch");
  });
});
