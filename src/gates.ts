import { execSync } from "child_process";
import { Gate, parseDuration, substituteContext } from "./workflow.js";

export interface GateResult {
  name: string;
  type: string;
  satisfied: boolean;
  output: string;
  description?: string;
}

export function evaluateGate(
  gate: Gate,
  context: Record<string, string>,
  stateEnteredAt: string
): GateResult {
  switch (gate.type) {
    case "manual":
      return {
        name: gate.name,
        type: "manual",
        satisfied: false, // manual gates are satisfied via the `complete` command; caller overrides from DB
        output: "Requires manual completion",
        description: gate.description,
      };

    case "wait":
      return evaluateWaitGate(gate, stateEnteredAt);

    case "auto":
      return evaluateAutoGate(gate, context);

    default:
      return {
        name: gate.name,
        type: gate.type,
        satisfied: false,
        output: `Unknown gate type: ${gate.type}`,
        description: gate.description,
      };
  }
}

function evaluateWaitGate(gate: Gate, stateEnteredAt: string): GateResult {
  const requiredSeconds = parseDuration(gate.duration!);
  const enteredAt = new Date(stateEnteredAt + "Z");
  const now = new Date();
  const elapsedSeconds = (now.getTime() - enteredAt.getTime()) / 1000;
  const satisfied = elapsedSeconds >= requiredSeconds;
  const remaining = Math.max(0, requiredSeconds - elapsedSeconds);

  return {
    name: gate.name,
    type: "wait",
    satisfied,
    output: satisfied
      ? `Waited ${formatDuration(elapsedSeconds)}`
      : `${formatDuration(remaining)} remaining (need ${gate.duration})`,
    description: gate.description,
  };
}

function evaluateAutoGate(gate: Gate, context: Record<string, string>): GateResult {
  const command = substituteContext(gate.command!, context);
  let stdout = "";
  let exitCode = 0;

  try {
    stdout = execSync(command, {
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err: any) {
    exitCode = err.status ?? 1;
    stdout = (err.stdout ?? "").toString().trim();
  }

  let satisfied = true;
  let reason = "";

  if (gate.expect !== undefined) {
    satisfied = stdout === gate.expect;
    if (!satisfied) reason = `expected "${gate.expect}", got "${stdout}"`;
  }
  if (gate.expect_not !== undefined) {
    satisfied = stdout !== gate.expect_not;
    if (!satisfied) reason = `expected NOT "${gate.expect_not}", got "${stdout}"`;
  }
  if (gate.expect_exit !== undefined) {
    satisfied = exitCode === gate.expect_exit;
    if (!satisfied) reason = `expected exit code ${gate.expect_exit}, got ${exitCode}`;
  }
  if (gate.expect_gte !== undefined) {
    const expected = parseFloat(gate.expect_gte);
    const actual = parseFloat(stdout);
    satisfied = !isNaN(actual) && actual >= expected;
    if (!satisfied) reason = `expected >= ${gate.expect_gte}, got "${stdout}"`;
  }

  return {
    name: gate.name,
    type: "auto",
    satisfied,
    output: reason || stdout || "(empty)",
    description: gate.description,
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
