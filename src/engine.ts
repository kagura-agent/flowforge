import { randomBytes } from "crypto";
import {
  getInstance,
  getGateStatus,
  getGateStatusesForState,
  updateGateStatus,
  updateInstanceState,
  recordTransition,
  completeInstance,
} from "./db.js";
import { Workflow, State } from "./workflow.js";
import { evaluateGate, GateResult } from "./gates.js";

export function generateId(): string {
  return randomBytes(4).toString("hex");
}

export interface CheckResult {
  allSatisfied: boolean;
  results: GateResult[];
  satisfiedCount: number;
  totalCount: number;
}

export function checkGates(
  instanceId: string,
  workflow: Workflow,
  currentState: string,
  context: Record<string, string>,
  stateEnteredAt: string
): CheckResult {
  const state = workflow.states[currentState];
  if (!state) throw new Error(`Unknown state: ${currentState}`);

  const results: GateResult[] = [];

  for (const gate of state.gates) {
    if (gate.type === "manual") {
      // Check DB for manual completion
      const dbStatus = getGateStatus(instanceId, currentState, gate.name);
      const satisfied = dbStatus?.satisfied === 1;
      results.push({
        name: gate.name,
        type: "manual",
        satisfied,
        output: satisfied ? "Marked complete" : "Requires manual completion",
        description: gate.description,
      });
      updateGateStatus(instanceId, currentState, gate.name, satisfied, satisfied ? "Marked complete" : "Pending");
    } else {
      // Evaluate auto and wait gates
      const result = evaluateGate(gate, context, stateEnteredAt);
      results.push(result);
      updateGateStatus(instanceId, currentState, gate.name, result.satisfied, result.output);
    }
  }

  const satisfiedCount = results.filter((r) => r.satisfied).length;
  return {
    allSatisfied: satisfiedCount === results.length,
    results,
    satisfiedCount,
    totalCount: results.length,
  };
}

export function canAdvance(
  instanceId: string,
  workflow: Workflow,
  currentState: string,
  context: Record<string, string>,
  stateEnteredAt: string
): CheckResult {
  return checkGates(instanceId, workflow, currentState, context, stateEnteredAt);
}

export function advance(
  instanceId: string,
  workflow: Workflow,
  currentState: string,
  context: Record<string, string>,
  stateEnteredAt: string
): { newState: string; checkResult: CheckResult } {
  const state = workflow.states[currentState];
  if (!state) throw new Error(`Unknown state: ${currentState}`);
  if (state.terminal) throw new Error(`Cannot advance from terminal state '${currentState}'`);

  const result = canAdvance(instanceId, workflow, currentState, context, stateEnteredAt);

  if (!result.allSatisfied) {
    const blocking = result.results.filter((r) => !r.satisfied);
    const details = blocking
      .map((r) => `  - ${r.name} (${r.type}): ${r.output}`)
      .join("\n");
    throw new Error(
      `Cannot advance: ${blocking.length} gate(s) not satisfied:\n${details}`
    );
  }

  const nextState = state.next!;
  recordTransition(instanceId, currentState, nextState, false);
  updateInstanceState(instanceId, nextState);

  // If next state is terminal, complete the instance
  if (workflow.states[nextState]?.terminal) {
    completeInstance(instanceId);
  }

  return { newState: nextState, checkResult: result };
}

export function forceAdvance(
  instanceId: string,
  workflow: Workflow,
  currentState: string,
  targetState: string,
  reason: string
): void {
  if (!workflow.states[targetState]) {
    throw new Error(`Unknown target state: '${targetState}'`);
  }

  recordTransition(instanceId, currentState, targetState, true, reason);
  updateInstanceState(instanceId, targetState);

  if (workflow.states[targetState]?.terminal) {
    completeInstance(instanceId);
  }
}
