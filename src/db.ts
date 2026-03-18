import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";

const DB_DIR = join(homedir(), ".flowforge");
const DB_PATH = join(DB_DIR, "flowforge.db");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      name TEXT PRIMARY KEY,
      yaml TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS instances (
      id TEXT PRIMARY KEY,
      workflow TEXT NOT NULL,
      context_json TEXT NOT NULL DEFAULT '{}',
      current_state TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      state_entered_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'active',
      FOREIGN KEY (workflow) REFERENCES workflows(name)
    );

    CREATE TABLE IF NOT EXISTS gate_status (
      instance_id TEXT NOT NULL,
      state TEXT NOT NULL,
      gate_name TEXT NOT NULL,
      satisfied INTEGER NOT NULL DEFAULT 0,
      checked_at TEXT,
      output TEXT,
      PRIMARY KEY (instance_id, state, gate_name),
      FOREIGN KEY (instance_id) REFERENCES instances(id)
    );

    CREATE TABLE IF NOT EXISTS transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL,
      from_state TEXT NOT NULL,
      to_state TEXT NOT NULL,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      forced INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      FOREIGN KEY (instance_id) REFERENCES instances(id)
    );
  `);
}

// --- Workflow operations ---

export function saveWorkflow(name: string, yaml: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO workflows (name, yaml, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(name) DO UPDATE SET yaml = excluded.yaml, updated_at = datetime('now')
  `).run(name, yaml);
}

export function getWorkflow(name: string): { name: string; yaml: string; updated_at: string } | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM workflows WHERE name = ?").get(name) as any;
}

export function listWorkflows(): { name: string; updated_at: string }[] {
  const db = getDb();
  return db.prepare("SELECT name, updated_at FROM workflows ORDER BY name").all() as any[];
}

// --- Instance operations ---

export function createInstance(id: string, workflow: string, contextJson: string, initialState: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO instances (id, workflow, context_json, current_state, created_at, updated_at, state_entered_at, status)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), 'active')
  `).run(id, workflow, contextJson, initialState);
}

export function getInstance(id: string): {
  id: string; workflow: string; context_json: string; current_state: string;
  created_at: string; updated_at: string; state_entered_at: string; status: string;
} | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM instances WHERE id = ?").get(id) as any;
}

export function getActiveInstances(): {
  id: string; workflow: string; current_state: string; created_at: string; updated_at: string; status: string;
}[] {
  const db = getDb();
  return db.prepare("SELECT * FROM instances WHERE status = 'active' ORDER BY created_at DESC").all() as any[];
}

export function getActiveInstancesForWorkflow(workflow: string): { id: string }[] {
  const db = getDb();
  return db.prepare("SELECT id FROM instances WHERE workflow = ? AND status = 'active'").all(workflow) as any[];
}

export function getMostRecentActiveInstance(): {
  id: string; workflow: string; current_state: string; created_at: string; updated_at: string; status: string;
} | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM instances WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1").get() as any;
}

export function updateInstanceState(id: string, newState: string): void {
  const db = getDb();
  db.prepare(`
    UPDATE instances SET current_state = ?, updated_at = datetime('now'), state_entered_at = datetime('now') WHERE id = ?
  `).run(newState, id);
}

export function completeInstance(id: string): void {
  const db = getDb();
  db.prepare("UPDATE instances SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(id);
}

// --- Gate status operations ---

export function getGateStatus(instanceId: string, state: string, gateName: string): {
  instance_id: string; state: string; gate_name: string; satisfied: number; checked_at: string; output: string;
} | undefined {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM gate_status WHERE instance_id = ? AND state = ? AND gate_name = ?"
  ).get(instanceId, state, gateName) as any;
}

export function getGateStatusesForState(instanceId: string, state: string): {
  instance_id: string; state: string; gate_name: string; satisfied: number; checked_at: string; output: string;
}[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM gate_status WHERE instance_id = ? AND state = ?"
  ).all(instanceId, state) as any[];
}

export function updateGateStatus(
  instanceId: string, state: string, gateName: string, satisfied: boolean, output: string
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO gate_status (instance_id, state, gate_name, satisfied, checked_at, output)
    VALUES (?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(instance_id, state, gate_name)
    DO UPDATE SET satisfied = excluded.satisfied, checked_at = datetime('now'), output = excluded.output
  `).run(instanceId, state, gateName, satisfied ? 1 : 0, output);
}

export function clearGateStatusesForState(instanceId: string, state: string): void {
  const db = getDb();
  db.prepare("DELETE FROM gate_status WHERE instance_id = ? AND state = ?").run(instanceId, state);
}

// --- Transition operations ---

export function recordTransition(
  instanceId: string, fromState: string, toState: string, forced: boolean, reason?: string
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO transitions (instance_id, from_state, to_state, timestamp, forced, reason)
    VALUES (?, ?, ?, datetime('now'), ?, ?)
  `).run(instanceId, fromState, toState, forced ? 1 : 0, reason ?? null);
}

export function getTransitions(instanceId: string): {
  id: number; instance_id: string; from_state: string; to_state: string;
  timestamp: string; forced: number; reason: string | null;
}[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM transitions WHERE instance_id = ? ORDER BY id ASC"
  ).all(instanceId) as any[];
}
