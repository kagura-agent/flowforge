import { Command } from "commander";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join, resolve } from "path";
import * as engine from "./engine.js";

// Auto-load workflows from workflows/ directory
function autoLoadWorkflows() {
  const workflowDirs = [
    join(process.cwd(), "workflows"),
    join(process.env.HOME || "~", ".flowforge", "workflows")
  ];

  for (const dir of workflowDirs) {
    if (!existsSync(dir)) continue;

    try {
      const files = readdirSync(dir);
      const yamlFiles = files.filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));

      for (const file of yamlFiles) {
        try {
          const content = readFileSync(join(dir, file), "utf-8");
          engine.define(content);
        } catch (e: any) {
          console.warn(`⚠️  Skipping invalid workflow ${file}: ${e.message}`);
        }
      }
    } catch (e) {
      // Directory not accessible, skip
    }
  }
}

// Auto-load workflows on CLI startup
autoLoadWorkflows();

const program = new Command();
program.name("flowforge").description("Personal workflow engine").version("1.1.0");

program
  .command("define <yaml>")
  .description("Register or update a workflow from a YAML file")
  .action((yamlPath) => {
    try {
      const content = readFileSync(yamlPath, "utf-8");
      const name = engine.define(content);
      console.log(`Workflow '${name}' defined.`);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command("start <workflow>")
  .description("Start a new instance of a workflow (name or path to .yaml file)")
  .action((workflow) => {
    try {
      // If it looks like a file path, load it first
      if (workflow.endsWith(".yaml") || workflow.endsWith(".yml")) {
        const absPath = resolve(workflow);
        if (existsSync(absPath)) {
          const content = readFileSync(absPath, "utf-8");
          engine.define(content);
          // Extract workflow name from the loaded file
          const match = content.match(/^name:\s*(.+)$/m);
          if (match) workflow = match[1].trim();
        }
      }
      const { id, node } = engine.start(workflow);
      console.log(`Started instance #${id} at node '${node}'.`);
      printStatus();
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show current node, task, and available branches")
  .option("-w, --workflow <name>", "Target a specific workflow")
  .action((opts) => {
    try {
      printStatus(opts.workflow);
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command("next")
  .description("Complete current node and move to next")
  .option("--branch <N>", "Branch number (1-indexed) for branching nodes", parseInt)
  .option("-w, --workflow <name>", "Target a specific workflow")
  .option("--notify", "Output a notification message for the user (e.g. Luna)")
  .action((opts) => {
    try {
      const result = engine.next(opts.branch, opts.workflow);
      if (result.terminal) {
        console.log(`\n✅ ${result.from} → (end) — Workflow complete!\n`);
      } else {
        console.log(`\n${result.from} → ${result.to}${result.branchTaken ? ` (${result.branchTaken})` : ""}\n`);
        printStatus(opts.workflow);
      }
      if (opts.notify) {
        if (result.terminal) {
          console.log("---NOTIFY---");
          console.log(`✅ Workflow 完成：${result.from} → 结束`);
        } else {
          const s = engine.status();
          console.log("---NOTIFY---");
          console.log(`🔄 Workflow 进度：${result.from} → ${s.currentNode}`);
          console.log(`📋 当前任务：${s.task.trim().split("\n")[0]}`);
          if (s.branches) {
            console.log(`⑂ ${s.branches.length} 个分支待决策`);
          }
        }
      }
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command("log")
  .description("Show history of nodes visited")
  .action(() => {
    try {
      const { workflowName, instanceId, entries } = engine.log();
      console.log(`\nWorkflow: ${workflowName} (instance #${instanceId})\n`);
      for (const e of entries) {
        const branch = e.branch_taken ? ` [${e.branch_taken}]` : "";
        const exit = e.exited_at ? ` → exited ${e.exited_at}` : " (current)";
        console.log(`  ${e.entered_at}  ${e.node_name}${branch}${exit}`);
      }
      console.log();
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command("list")
  .description("List all defined workflows")
  .action(() => {
    const workflows = engine.list();
    if (workflows.length === 0) {
      console.log("No workflows defined.");
      return;
    }
    for (const w of workflows) {
      console.log(`  ${w.name}  (updated ${w.updated_at})`);
    }
  });

program
  .command("active")
  .description("List active instances")
  .action(() => {
    const instances = engine.active();
    if (instances.length === 0) {
      console.log("No active instances.");
      return;
    }
    for (const inst of instances) {
      console.log(`  #${inst.id}  ${inst.workflow_name}  at '${inst.current_node}'  (started ${inst.created_at})`);
    }
  });

program
  .command("reset")
  .description("Reset current instance back to start node")
  .action(() => {
    try {
      const { id, node } = engine.reset();
      console.log(`Reset. New instance #${id} at node '${node}'.`);
      printStatus();
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command("run <workflow>")
  .description("Start workflow and output next action as JSON")
  .action((workflow) => {
    try {
      // Resume existing instance, or start a new one if none active
      const existing = engine.active().find(i => i.workflow_name === workflow);
      if (!existing) {
        engine.start(workflow);
      }

      const action = engine.getAction(workflow);
      console.log(JSON.stringify({ action }, null, 2));
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });

program
  .command("advance")
  .description("Advance workflow with result and output next action as JSON")
  .option("--result <text>", "Result text from previous step")
  .action((opts) => {
    try {
      let result = opts.result;

      // If no --result flag, read from stdin
      if (!result) {
        const fs = require("fs");
        result = fs.readFileSync(0, "utf-8").trim();
      }

      const action = engine.advanceWithResult(result);
      console.log(JSON.stringify({ action }, null, 2));
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });


program
  .command("stats [workflow]")
  .description("Show workflow execution analytics and guideposts")
  .action((workflow) => {
    try {
      const { workflowStats, guideposts, topBranches, nodeStats } = engine.stats(workflow);

      // Workflow summary
      console.log("\n=== Workflow Summary ===\n");
      if (workflowStats.length === 0) {
        console.log("  No workflow data yet.\n");
      } else {
        console.log(`  ${"Workflow".padEnd(25)} ${"Runs".padStart(6)} ${"Done %".padStart(10)} ${"Avg (min)".padStart(12)}`);
        console.log("  " + "-".repeat(57));
        for (const w of workflowStats) {
          const dur = w.avg_duration_min != null ? w.avg_duration_min.toFixed(1) : "—";
          console.log(`  ${w.workflow_name.padEnd(25)} ${String(w.total_runs).padStart(6)} ${w.completion_rate.toFixed(1).padStart(8)}% ${dur.padStart(12)}`);
        }
      }

      // Guideposts
      const { lowCompletion, slowNodes, abandonedNodes } = guideposts;
      if (lowCompletion.length || slowNodes.length || abandonedNodes.length) {
        console.log("\n=== Guideposts (anomalies) ===\n");

        for (const g of lowCompletion) {
          console.log(`  ⚠  ${g.workflow_name}: only ${g.completion_rate}% completion (${g.total_runs} runs)`);
        }
        for (const g of slowNodes) {
          console.log(`  🐢 ${g.workflow_name} → ${g.node_name}: avg ${g.avg_duration_min} min (${g.visit_count} visits)`);
        }
        for (const g of abandonedNodes) {
          console.log(`  💀 ${g.workflow_name} → ${g.node_name}: ${g.stall_count} stalls`);
        }
      }

      // Top branch choices
      if (topBranches.length) {
        console.log("\n=== Top Branch Choices ===\n");
        for (const b of topBranches) {
          console.log(`  ${b.node_name}: "${b.branch_taken}" (${b.times_chosen}x)`);
        }
      }

      // Per-node breakdown
      if (nodeStats) {
        console.log(`\n=== Node Breakdown: ${workflow} ===\n`);
        console.log(`  ${"Node".padEnd(30)} ${"Visits".padStart(8)} ${"Avg (min)".padStart(12)}`);
        console.log("  " + "-".repeat(54));
        for (const n of nodeStats) {
          const dur = n.avg_duration_min != null ? n.avg_duration_min.toFixed(1) : "—";
          console.log(`  ${n.node_name.padEnd(30)} ${String(n.visit_count).padStart(8)} ${dur.padStart(12)}`);
        }
      }

      console.log();
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    }
  });


function printStatus(workflowName?: string) {
  const s = engine.status(workflowName);
  console.log(`\n📍 Current: ${s.currentNode}`);
  console.log(`📋 Task: ${s.task}`);
  if (s.terminal) {
    console.log(`\n🏁 This is a terminal node. Use: flowforge next to finish.`);
  } else if (s.branches) {
    console.log(`\nBranches:`);
    for (let i = 0; i < s.branches.length; i++) {
      console.log(`  ${i + 1}. ${s.branches[i].condition} → ${s.branches[i].next}`);
    }
    console.log(`\nUse: flowforge next --branch <N>`);
  } else if (s.nextNode) {
    console.log(`\nNext: ${s.nextNode}`);
    console.log(`\nUse: flowforge next`);
  }
  console.log();
}

program.parse();
