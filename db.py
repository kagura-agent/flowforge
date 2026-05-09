import sqlite3
import os
from pathlib import Path
from typing import Optional, List, Dict, Any

DIR = Path.home() / ".flowforge"
DIR.mkdir(parents=True, exist_ok=True)

db = sqlite3.connect(DIR / "flowforge.db", check_same_thread=False)
db.execute("PRAGMA journal_mode = WAL")
db.execute("PRAGMA foreign_keys = ON")

db.executescript("""
  CREATE TABLE IF NOT EXISTS workflows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    yaml_content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'auto',
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
""")

try:
    cols = db.execute("PRAGMA table_info(workflows)").fetchall()
    if not any(c[1] == 'source' for c in cols):
        db.execute("ALTER TABLE workflows ADD COLUMN source TEXT NOT NULL DEFAULT 'auto'")
except Exception:
    pass

InstanceRow = Dict[str, Any]

def upsert_workflow(name: str, yaml: str, source: str = 'auto') -> None:
    existing = get_workflow(name)
    if existing and existing['source'] == 'manual' and source == 'auto':
        return
    db.execute("""
        INSERT INTO workflows (name, yaml_content, source) VALUES (?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET yaml_content = ?, source = ?, updated_at = datetime('now')
    """, (name, yaml, source, yaml, source))

def delete_workflow(name: str) -> None:
    db.execute("DELETE FROM workflows WHERE name = ?", (name,))

def get_workflow(name: str) -> Optional[Dict[str, Any]]:
    row = db.execute("SELECT * FROM workflows WHERE name = ?", (name,)).fetchone()
    if not row:
        return None
    return {'id': row[0], 'name': row[1], 'yaml_content': row[2], 'source': row[3]}

def get_workflow_by_id(id: int) -> Optional[Dict[str, Any]]:
    row = db.execute("SELECT * FROM workflows WHERE id = ?", (id,)).fetchone()
    if not row:
        return None
    return {'id': row[0], 'name': row[1], 'yaml_content': row[2], 'source': row[3]}

def get_instance(id: int) -> Optional[InstanceRow]:
    row = db.execute("SELECT * FROM instances WHERE id = ?", (id,)).fetchone()
    if not row:
        return None
    return {'id': row[0], 'workflow_name': row[1], 'current_node': row[2], 'status': row[3], 'created_at': row[4], 'updated_at': row[5]}

def list_workflows() -> List[Dict[str, Any]]:
    rows = db.execute("SELECT name, source, updated_at FROM workflows ORDER BY name").fetchall()
    return [{'name': r[0], 'source': r[1], 'updated_at': r[2]} for r in rows]

def create_instance(workflowName: str, startNode: str) -> int:
    cur = db.execute(
        "INSERT INTO instances (workflow_name, current_node, status) VALUES (?, ?, 'active')",
        (workflowName, startNode)
    )
    db.commit()
    return cur.lastrowid

def get_active_instance(workflowName: Optional[str] = None) -> Optional[InstanceRow]:
    if workflowName:
        row = db.execute(
            "SELECT * FROM instances WHERE workflow_name = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
            (workflowName,)
        ).fetchone()
    else:
        row = db.execute(
            "SELECT * FROM instances WHERE status = 'active' ORDER BY id DESC LIMIT 1"
        ).fetchone()
    if not row:
        return None
    return {'id': row[0], 'workflow_name': row[1], 'current_node': row[2], 'status': row[3], 'created_at': row[4], 'updated_at': row[5]}

def list_active_instances(workflowName: Optional[str] = None) -> List[Dict[str, Any]]:
    if workflowName:
        rows = db.execute(
            "SELECT id, workflow_name, current_node, created_at, status FROM instances WHERE workflow_name = ? AND status = 'active' ORDER BY id",
            (workflowName,)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT id, workflow_name, current_node, created_at, status FROM instances WHERE status = 'active' ORDER BY id"
        ).fetchall()
    return [{'id': r[0], 'workflow_name': r[1], 'current_node': r[2], 'created_at': r[3], 'status': r[4]} for r in rows]

def update_instance_node(id: int, node: str) -> None:
    db.execute("UPDATE instances SET current_node = ?, updated_at = datetime('now') WHERE id = ?", (node, id))
    db.commit()

def set_instance_status(id: int, status: str) -> None:
    db.execute("UPDATE instances SET status = ?, updated_at = datetime('now') WHERE id = ?", (status, id))
    db.commit()

def add_history(instanceId: int, nodeName: str) -> None:
    db.execute("INSERT INTO history (instance_id, node_name) VALUES (?, ?)", (instanceId, nodeName))
    db.commit()

def close_history(instanceId: int, nodeName: str, branchTaken: Optional[str]) -> None:
    db.execute(
        "UPDATE history SET exited_at = datetime('now'), branch_taken = ? WHERE instance_id = ? AND node_name = ? AND exited_at IS NULL",
        (branchTaken, instanceId, nodeName)
    )
    db.commit()

def get_node_visit_count(instanceId: int, nodeName: str) -> int:
    row = db.execute(
        "SELECT COUNT(*) as cnt FROM history WHERE instance_id = ? AND node_name = ?",
        (instanceId, nodeName)
    ).fetchone()
    return row[0] if row else 0

def get_history(instanceId: int) -> List[Dict[str, Any]]:
    rows = db.execute(
        "SELECT node_name, branch_taken, entered_at, exited_at FROM history WHERE instance_id = ? ORDER BY id",
        (instanceId,)
    ).fetchall()
    return [{'node_name': r[0], 'branch_taken': r[1], 'entered_at': r[2], 'exited_at': r[3]} for r in rows]