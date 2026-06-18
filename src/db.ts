import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

const DIR = join(homedir(), ".flowforge");
mkdirSync(DIR, { recursive: true });

const db = new Database(join(DIR, "flowforge.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS workflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    yaml_content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_name TEXT NOT NULL,
    current_node TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (workflow_name) REFERENCES workflows(name)
  );
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL,
    node_name TEXT NOT NULL,
    branch_taken TEXT,
    entered_at TEXT DEFAULT (datetime('now')),
    exited_at TEXT,
    FOREIGN KEY (instance_id) REFERENCES instances(id)
  );
`);

// --- Workflow queries ---

export function upsertWorkflow(name: string, yaml: string) {
  db.prepare(`
    INSERT INTO workflows (name, yaml_content) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET yaml_content = ?, updated_at = datetime('now')
  `).run(name, yaml, yaml);
}

export function getWorkflow(name: string) {
  return db.prepare("SELECT * FROM workflows WHERE name = ?").get(name) as
    | { id: number; name: string; yaml_content: string }
    | undefined;
}

export function listWorkflows() {
  return db.prepare("SELECT name, updated_at FROM workflows ORDER BY name").all() as {
    name: string;
    updated_at: string;
  }[];
}

// --- Instance queries ---

export function createInstance(workflowName: string, startNode: string) {
  const res = db.prepare(
    "INSERT INTO instances (workflow_name, current_node, status) VALUES (?, ?, 'active')"
  ).run(workflowName, startNode);
  return res.lastInsertRowid as number;
}

export function getActiveInstance(workflowName?: string) {
  if (workflowName) {
    return db.prepare(
      "SELECT * FROM instances WHERE workflow_name = ? AND status = 'active' ORDER BY id DESC LIMIT 1"
    ).get(workflowName) as InstanceRow | undefined;
  }
  return db.prepare(
    "SELECT * FROM instances WHERE status = 'active' ORDER BY id DESC LIMIT 1"
  ).get() as InstanceRow | undefined;
}

export function listActiveInstances() {
  return db.prepare(
    "SELECT id, workflow_name, current_node, created_at FROM instances WHERE status = 'active' ORDER BY id"
  ).all() as { id: number; workflow_name: string; current_node: string; created_at: string }[];
}

export function updateInstanceNode(id: number, node: string) {
  db.prepare(
    "UPDATE instances SET current_node = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(node, id);
}

export function setInstanceStatus(id: number, status: string) {
  db.prepare(
    "UPDATE instances SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(status, id);
}

// --- History queries ---

export function addHistory(instanceId: number, nodeName: string) {
  db.prepare(
    "INSERT INTO history (instance_id, node_name) VALUES (?, ?)"
  ).run(instanceId, nodeName);
}

export function closeHistory(instanceId: number, nodeName: string, branchTaken: string | null) {
  db.prepare(
    "UPDATE history SET exited_at = datetime('now'), branch_taken = ? WHERE instance_id = ? AND node_name = ? AND exited_at IS NULL"
  ).run(branchTaken, instanceId, nodeName);
}

export function getNodeVisitCount(instanceId: number, nodeName: string): number {
  const row = db.prepare(
    "SELECT COUNT(*) as cnt FROM history WHERE instance_id = ? AND node_name = ?"
  ).get(instanceId, nodeName) as { cnt: number };
  return row.cnt;
}

export function getHistory(instanceId: number) {
  return db.prepare(
    "SELECT node_name, branch_taken, entered_at, exited_at FROM history WHERE instance_id = ? ORDER BY id"
  ).all(instanceId) as {
    node_name: string;
    branch_taken: string | null;
    entered_at: string;
    exited_at: string | null;
  }[];
}

export function cleanupStaleInstances(staleHours: number): { id: number; workflow_name: string; current_node: string; updated_at: string }[] {
  const rows = db.prepare(
    `SELECT id, workflow_name, current_node, updated_at FROM instances
     WHERE status = 'active'
     AND updated_at < datetime('now', '-' || ? || ' hours')
     ORDER BY id`
  ).all(staleHours) as { id: number; workflow_name: string; current_node: string; updated_at: string }[];

  if (rows.length > 0) {
    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    // Close open history entries
    db.prepare(
      `UPDATE history SET exited_at = datetime('now'), branch_taken = 'auto-cleanup:stale'
       WHERE instance_id IN (${placeholders}) AND exited_at IS NULL`
    ).run(...ids);
    // Mark instances as completed
    db.prepare(
      `UPDATE instances SET status = 'completed', updated_at = datetime('now')
       WHERE id IN (${placeholders})`
    ).run(...ids);
  }

  return rows;
}

export type InstanceRow = {
  id: number;
  workflow_name: string;
  current_node: string;
  status: string;
  created_at: string;
  updated_at: string;
};
