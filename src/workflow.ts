import yaml from "js-yaml";

export interface Gate {
  name: string;
  type: "auto" | "manual" | "wait";
  description?: string;
  command?: string;
  expect?: string;
  expect_not?: string;
  expect_exit?: number;
  expect_gte?: string;
  duration?: string;
}

export interface State {
  description?: string;
  gates: Gate[];
  next?: string;
  terminal?: boolean;
  on?: Record<string, string>;
}

export interface Enforcement {
  block_parallel?: boolean;
  require_reason_for_force?: boolean;
  log_violations?: boolean;
}

export interface Workflow {
  name: string;
  description?: string;
  context?: string[];
  states: Record<string, State>;
  enforcement?: Enforcement;
}

export function parseWorkflow(yamlContent: string): Workflow {
  const raw = yaml.load(yamlContent) as any;
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid YAML: empty or not an object");
  }
  if (!raw.name || typeof raw.name !== "string") {
    throw new Error("Workflow must have a 'name' field");
  }
  if (!raw.states || typeof raw.states !== "object") {
    throw new Error("Workflow must have a 'states' map");
  }

  const workflow: Workflow = {
    name: raw.name,
    description: raw.description,
    context: raw.context,
    states: {},
    enforcement: raw.enforcement,
  };

  for (const [stateName, stateRaw] of Object.entries(raw.states)) {
    const s = stateRaw as any;
    const gates: Gate[] = (s.gates || []).map((g: any) => {
      if (!g.name) throw new Error(`Gate in state '${stateName}' missing 'name'`);
      if (!["auto", "manual", "wait"].includes(g.type)) {
        throw new Error(`Gate '${g.name}' in state '${stateName}' has invalid type '${g.type}'`);
      }
      if (g.type === "auto" && !g.command) {
        throw new Error(`Auto gate '${g.name}' in state '${stateName}' must have a 'command'`);
      }
      if (g.type === "wait" && !g.duration) {
        throw new Error(`Wait gate '${g.name}' in state '${stateName}' must have a 'duration'`);
      }
      return {
        name: g.name,
        type: g.type,
        description: g.description,
        command: g.command,
        expect: g.expect,
        expect_not: g.expect_not,
        expect_exit: g.expect_exit != null ? Number(g.expect_exit) : undefined,
        expect_gte: g.expect_gte,
        duration: g.duration,
      };
    });

    workflow.states[stateName] = {
      description: s.description,
      gates,
      next: s.next,
      terminal: s.terminal ?? false,
      on: s.on,
    };
  }

  validateWorkflow(workflow);
  return workflow;
}

function validateWorkflow(w: Workflow): void {
  const stateNames = new Set(Object.keys(w.states));

  // Must have at least one terminal state
  const hasTerminal = Object.values(w.states).some((s) => s.terminal);
  if (!hasTerminal) {
    throw new Error("Workflow must have at least one terminal state");
  }

  // Validate next references
  for (const [name, state] of Object.entries(w.states)) {
    if (state.next && !stateNames.has(state.next)) {
      throw new Error(`State '${name}' references unknown next state '${state.next}'`);
    }
    if (state.on) {
      for (const [, target] of Object.entries(state.on)) {
        if (!stateNames.has(target)) {
          throw new Error(`State '${name}' on-handler references unknown state '${target}'`);
        }
      }
    }
    if (!state.terminal && !state.next) {
      throw new Error(`Non-terminal state '${name}' must have a 'next' state`);
    }
  }
}

export function getInitialState(w: Workflow): string {
  // First state defined in the YAML
  return Object.keys(w.states)[0];
}

export function parseDuration(duration: string): number {
  // Returns duration in seconds
  const match = duration.match(/^(\d+)\s*(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid duration format: '${duration}'`);
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case "s": return value;
    case "m": return value * 60;
    case "h": return value * 3600;
    case "d": return value * 86400;
    default: throw new Error(`Unknown duration unit: '${match[2]}'`);
  }
}

export function substituteContext(command: string, context: Record<string, string>): string {
  return command.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (key in context) return context[key];
    throw new Error(`Context variable '{{${key}}}' not defined. Available: ${Object.keys(context).join(", ")}`);
  });
}
