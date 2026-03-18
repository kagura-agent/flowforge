import { Command } from "commander";
import { readFileSync } from "fs";
import {
  saveWorkflow,
  getWorkflow,
  listWorkflows,
  createInstance,
  getInstance,
  getActiveInstances,
  getActiveInstancesForWorkflow,
  getMostRecentActiveInstance,
  updateGateStatus,
  getTransitions,
} from "./db.js";
import { parseWorkflow, getInitialState } from "./workflow.js";
import { generateId, checkGates, advance, forceAdvance } from "./engine.js";

const program = new Command();
program
  .name("flowforge")
  .description("Enforced workflow engine for AI agents")
  .version("0.1.0");

// --- define ---
program
  .command("define <yaml-file>")
  .description("Register a workflow from a YAML file")
  .action((yamlFile: string) => {
    const content = readFileSync(yamlFile, "utf-8");
    const workflow = parseWorkflow(content);
    saveWorkflow(workflow.name, content);
    const stateCount = Object.keys(workflow.states).length;
    const gateCount = Object.values(workflow.states).reduce(
      (sum, s) => sum + s.gates.length, 0
    );
    console.log(`Workflow '${workflow.name}' registered (${stateCount} states, ${gateCount} gates)`);
  });

// --- list ---
program
  .command("list")
  .description("List registered workflows")
  .action(() => {
    const workflows = listWorkflows();
    if (workflows.length === 0) {
      console.log("No workflows registered. Use 'flowforge define <yaml-file>' to add one.");
      return;
    }
    console.log("Workflows:");
    for (const w of workflows) {
      console.log(`  ${w.name}  (updated: ${w.updated_at})`);
    }
  });

// --- show ---
program
  .command("show <workflow>")
  .description("Show workflow definition with states and gates")
  .action((name: string) => {
    const row = getWorkflow(name);
    if (!row) {
      console.error(`Workflow '${name}' not found`);
      process.exit(1);
    }
    const workflow = parseWorkflow(row.yaml);
    console.log(`Workflow: ${workflow.name}`);
    if (workflow.description) console.log(`Description: ${workflow.description}`);
    if (workflow.context?.length) console.log(`Context: ${workflow.context.join(", ")}`);
    console.log("");

    for (const [stateName, state] of Object.entries(workflow.states)) {
      const marker = state.terminal ? " [TERMINAL]" : "";
      console.log(`  ${stateName}${marker}`);
      if (state.description) console.log(`    ${state.description}`);
      for (const gate of state.gates) {
        console.log(`    gate: ${gate.name} (${gate.type})${gate.description ? " — " + gate.description : ""}`);
      }
      if (state.next) console.log(`    → ${state.next}`);
      console.log("");
    }
  });

// --- start ---
program
  .command("start <workflow>")
  .description("Start a new workflow instance")
  .option("--context <pairs...>", "Context variables as key=value pairs")
  .action((workflowName: string, opts: { context?: string[] }) => {
    const row = getWorkflow(workflowName);
    if (!row) {
      console.error(`Workflow '${workflowName}' not found`);
      process.exit(1);
    }
    const workflow = parseWorkflow(row.yaml);

    // Check block_parallel
    if (workflow.enforcement?.block_parallel) {
      const active = getActiveInstancesForWorkflow(workflowName);
      if (active.length > 0) {
        console.error(
          `Cannot start: workflow '${workflowName}' has block_parallel enabled and instance '${active[0].id}' is active`
        );
        process.exit(1);
      }
    }

    // Parse context
    const context: Record<string, string> = {};
    if (opts.context) {
      for (const pair of opts.context) {
        const eq = pair.indexOf("=");
        if (eq === -1) {
          console.error(`Invalid context format: '${pair}' (expected key=value)`);
          process.exit(1);
        }
        context[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
    }

    // Validate required context
    if (workflow.context) {
      for (const key of workflow.context) {
        if (!(key in context)) {
          console.error(`Missing required context variable: '${key}'`);
          process.exit(1);
        }
      }
    }

    const id = generateId();
    const initialState = getInitialState(workflow);
    createInstance(id, workflowName, JSON.stringify(context), initialState);

    console.log(`Started instance ${id} of '${workflowName}' in state '${initialState}'`);
    console.log(`Use 'flowforge check ${id}' to see gate status`);
  });

// --- status ---
program
  .command("status [instance-id]")
  .description("Show instance status, current state, and gate progress")
  .action((instanceId?: string) => {
    const inst = resolveInstance(instanceId);
    const row = getWorkflow(inst.workflow);
    if (!row) {
      console.error(`Workflow '${inst.workflow}' not found`);
      process.exit(1);
    }
    const workflow = parseWorkflow(row.yaml);
    const state = workflow.states[inst.current_state];
    const context = JSON.parse(inst.context_json);

    // Calculate time in state
    const enteredAt = new Date(inst.state_entered_at + "Z");
    const elapsed = Math.floor((Date.now() - enteredAt.getTime()) / 1000);

    console.log(`Instance:  ${inst.id}`);
    console.log(`Workflow:  ${inst.workflow}`);
    console.log(`Status:    ${inst.status}`);
    console.log(`State:     ${inst.current_state}${state?.terminal ? " [TERMINAL]" : ""}`);
    if (state?.description) console.log(`           ${state.description}`);
    console.log(`In state:  ${formatDuration(elapsed)}`);
    console.log(`Created:   ${inst.created_at}`);

    if (state && !state.terminal) {
      // Show gate summary from DB (last known status)
      const result = checkGates(inst.id, workflow, inst.current_state, context, inst.state_entered_at);
      console.log(`Gates:     ${result.satisfiedCount}/${result.totalCount} satisfied`);
      console.log("");
      for (const r of result.results) {
        const icon = r.satisfied ? "\u2705" : "\u274C";
        console.log(`  ${icon} ${r.name} (${r.type}): ${r.output}`);
      }
      if (result.allSatisfied) {
        console.log(`\nAll gates satisfied! Run 'flowforge advance ${inst.id}' to proceed.`);
      }
    }
  });

// --- active ---
program
  .command("active")
  .description("List all active instances")
  .action(() => {
    const instances = getActiveInstances();
    if (instances.length === 0) {
      console.log("No active instances.");
      return;
    }
    console.log("Active instances:");
    for (const inst of instances) {
      console.log(`  ${inst.id}  ${inst.workflow}  state=${inst.current_state}  started=${inst.created_at}`);
    }
  });

// --- check ---
program
  .command("check [instance-id]")
  .description("Run all gate checks for current state")
  .action((instanceId?: string) => {
    const inst = resolveInstance(instanceId);
    const row = getWorkflow(inst.workflow);
    if (!row) {
      console.error(`Workflow '${inst.workflow}' not found`);
      process.exit(1);
    }
    const workflow = parseWorkflow(row.yaml);
    const state = workflow.states[inst.current_state];

    if (state?.terminal) {
      console.log(`Instance ${inst.id} is in terminal state '${inst.current_state}'. No gates to check.`);
      return;
    }

    const context = JSON.parse(inst.context_json);
    console.log(`Checking gates for instance ${inst.id} in state '${inst.current_state}'...\n`);
    const result = checkGates(inst.id, workflow, inst.current_state, context, inst.state_entered_at);

    // Print table
    console.log("Gate                         Type     Status  Output");
    console.log("───────────────────────────  ───────  ──────  ──────────────────────────────");
    for (const r of result.results) {
      const icon = r.satisfied ? "\u2705" : "\u274C";
      const name = r.name.padEnd(27);
      const type = r.type.padEnd(7);
      const output = r.output.length > 40 ? r.output.slice(0, 37) + "..." : r.output;
      console.log(`${name}  ${type}  ${icon}      ${output}`);
    }
    console.log(`\n${result.satisfiedCount}/${result.totalCount} gates satisfied`);

    if (result.allSatisfied) {
      console.log(`\nAll gates satisfied! Run 'flowforge advance ${inst.id}' to proceed.`);
    }
  });

// --- complete ---
program
  .command("complete <instance-id> <gate-name>")
  .description("Mark a manual gate as completed")
  .action((instanceId: string, gateName: string) => {
    const inst = resolveInstance(instanceId);
    const row = getWorkflow(inst.workflow);
    if (!row) {
      console.error(`Workflow '${inst.workflow}' not found`);
      process.exit(1);
    }
    const workflow = parseWorkflow(row.yaml);
    const state = workflow.states[inst.current_state];
    if (!state) {
      console.error(`Unknown state: ${inst.current_state}`);
      process.exit(1);
    }

    const gate = state.gates.find((g) => g.name === gateName);
    if (!gate) {
      console.error(`Gate '${gateName}' not found in state '${inst.current_state}'`);
      console.error(`Available gates: ${state.gates.map((g) => g.name).join(", ")}`);
      process.exit(1);
    }
    if (gate.type !== "manual") {
      console.error(`Gate '${gateName}' is type '${gate.type}', not 'manual'. Only manual gates can be completed.`);
      process.exit(1);
    }

    updateGateStatus(inst.id, inst.current_state, gateName, true, "Marked complete");
    console.log(`Gate '${gateName}' marked as completed for instance ${inst.id}`);
  });

// --- advance ---
program
  .command("advance [instance-id]")
  .description("Advance to next state (fails if gates not met)")
  .action((instanceId?: string) => {
    const inst = resolveInstance(instanceId);
    const row = getWorkflow(inst.workflow);
    if (!row) {
      console.error(`Workflow '${inst.workflow}' not found`);
      process.exit(1);
    }
    const workflow = parseWorkflow(row.yaml);
    const context = JSON.parse(inst.context_json);

    try {
      const { newState } = advance(
        inst.id, workflow, inst.current_state, context, inst.state_entered_at
      );
      console.log(`Advanced instance ${inst.id}: '${inst.current_state}' → '${newState}'`);
      if (workflow.states[newState]?.terminal) {
        console.log(`Instance ${inst.id} has reached terminal state '${newState}'. Workflow complete.`);
      } else {
        console.log(`Use 'flowforge check ${inst.id}' to see gates for '${newState}'`);
      }
    } catch (err: any) {
      console.error(`BLOCKED: ${err.message}`);
      process.exit(1);
    }
  });

// --- force ---
program
  .command("force <instance-id> <state>")
  .description("Force transition to a state (logged as violation)")
  .requiredOption("--reason <text>", "Reason for forcing the transition")
  .action((instanceId: string, targetState: string, opts: { reason: string }) => {
    const inst = resolveInstance(instanceId);
    const row = getWorkflow(inst.workflow);
    if (!row) {
      console.error(`Workflow '${inst.workflow}' not found`);
      process.exit(1);
    }
    const workflow = parseWorkflow(row.yaml);

    if (workflow.enforcement?.require_reason_for_force && !opts.reason) {
      console.error("This workflow requires --reason for force transitions");
      process.exit(1);
    }

    try {
      forceAdvance(inst.id, workflow, inst.current_state, targetState, opts.reason);
      console.log(`⚠️  FORCED instance ${inst.id}: '${inst.current_state}' → '${targetState}'`);
      console.log(`   Reason: ${opts.reason}`);
      console.log(`   This transition was logged as a violation.`);
    } catch (err: any) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- history ---
program
  .command("history [instance-id]")
  .description("Show full transition history")
  .action((instanceId?: string) => {
    const inst = resolveInstance(instanceId);
    const transitions = getTransitions(inst.id);

    console.log(`Transition history for instance ${inst.id} (${inst.workflow}):\n`);
    if (transitions.length === 0) {
      console.log("  No transitions recorded yet (still in initial state).");
      return;
    }
    for (const t of transitions) {
      const forced = t.forced ? " ⚠️ FORCED" : "";
      console.log(`  ${t.timestamp}  ${t.from_state} → ${t.to_state}${forced}`);
      if (t.reason) console.log(`                     Reason: ${t.reason}`);
    }
  });

// --- Helper ---
function resolveInstance(instanceId?: string) {
  let inst;
  if (instanceId) {
    inst = getInstance(instanceId);
    if (!inst) {
      console.error(`Instance '${instanceId}' not found`);
      process.exit(1);
    }
  } else {
    inst = getMostRecentActiveInstance();
    if (!inst) {
      console.error("No active instances. Start one with 'flowforge start <workflow>'");
      process.exit(1);
    }
  }
  return inst as {
    id: string; workflow: string; context_json: string; current_state: string;
    created_at: string; updated_at: string; state_entered_at: string; status: string;
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

program.parse();
