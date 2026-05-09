import subprocess
import re
from typing import Optional, Dict, Any, List
from workflow import parse_workflow, Workflow
from db import get_workflow, upsert_workflow, create_instance, get_active_instance, update_instance_node, set_instance_status, add_history, close_history, get_node_visit_count, get_history, list_workflows, list_active_instances, get_instance, delete_workflow

class FlowAction:
    def __init__(self, type: str, instanceId: int, workflowName: str, node: str, task: str,
                 branches: Optional[List[Any]] = None, previousResult: Optional[str] = None):
        self.type = type
        self.instanceId = instanceId
        self.workflowName = workflowName
        self.node = node
        self.task = task
        self.branches = branches
        self.previousResult = previousResult

    def to_dict(self) -> Dict[str, Any]:
        return {
            'type': self.type,
            'instanceId': self.instanceId,
            'workflowName': self.workflowName,
            'node': self.node,
            'task': self.task,
            'branches': [{'condition': b.condition, 'next': b.next} for b in self.branches] if self.branches else None,
            'previousResult': self.previousResult
        }

def load_workflow(name: str) -> Workflow:
    row = get_workflow(name)
    if not row:
        raise ValueError(f"Workflow '{name}' not found. Use 'flowforge list' to see available workflows.")
    return parse_workflow(row['yaml_content'])

def resolve_instance(workflowName: Optional[str] = None, instanceId: Optional[int] = None):
    if instanceId is not None:
        inst = get_instance(instanceId)
        if not inst:
            raise ValueError(f"Instance #{instanceId} not found.")
        if inst['status'] != 'active':
            raise ValueError(f"Instance #{instanceId} is {inst['status']}.")
        return inst
    return get_active_instance(workflowName)

def require_active_instance(workflowName: Optional[str] = None, instanceId: Optional[int] = None):
    inst = resolve_instance(workflowName, instanceId)
    if not inst:
        if instanceId is not None:
            raise ValueError(f"Instance #{instanceId} not found or not active.")
        raise ValueError("No active instance. Use 'flowforge start <workflow>' first.")
    return inst

def define(yamlContent: str, source: str = 'auto') -> str:
    wf = parse_workflow(yamlContent)
    upsert_workflow(wf.name, yamlContent, source)
    return wf.name

def start(workflowName: str) -> Dict[str, Any]:
    wf = load_workflow(workflowName)
    existing = get_active_instance(workflowName)
    previousId = None
    if existing:
        close_history(existing['id'], existing['current_node'], None)
        set_instance_status(existing['id'], "done")
        previousId = existing['id']
    id = create_instance(workflowName, wf.start)
    add_history(id, wf.start)
    return {'id': id, 'node': wf.start, 'previouslyClosed': previousId}

def status(workflowName: Optional[str] = None, instanceId: Optional[int] = None) -> Dict[str, Any]:
    inst = require_active_instance(workflowName, instanceId)
    wf = load_workflow(inst['workflow_name'])
    node = wf.nodes.get(inst['current_node'])
    if not node:
        raise ValueError(f"Node '{inst['current_node']}' not found in workflow")

    return {
        'instanceId': inst['id'],
        'workflowName': inst['workflow_name'],
        'workflowDescription': wf.description,
        'currentNode': inst['current_node'],
        'task': node.task,
        'branches': [{'condition': b.condition, 'next': b.next} for b in node.branches] if node.branches else None,
        'hasNext': bool(node.next),
        'nextNode': node.next if node else None,
        'terminal': bool(node.terminal),
        'guard': node.guard if node else None,
    }

def next(branch: Optional[int], workflowName: Optional[str] = None, instanceId: Optional[int] = None) -> Dict[str, Any]:
    inst = require_active_instance(workflowName, instanceId)
    wf = load_workflow(inst['workflow_name'])
    node = wf.nodes.get(inst['current_node'])
    if not node:
        raise ValueError(f"Node '{inst['current_node']}' not found")

    if node.guard:
        try:
            result = subprocess.run(
                node.guard,
                shell=True,
                capture_output=True,
                text=True,
                timeout=60
            )
            print(f"\n[guard] {node.guard}")
            print(f"[guard output]\n{result.stdout.strip()}\n")
        except Exception as e:
            code = getattr(e, 'returncode', 'unknown')
            output = result.stdout.strip() if result else ""
            raise ValueError(
                f"Guard failed for node '{inst['current_node']}': exit {code}\n{output}\n"
                f"Command: {node.guard}\n"
                f"Refusing to advance. Fix the guard condition before proceeding."
            )

    nextNode = None
    branchTaken = None

    if node.branches:
        if branch is None:
            lines = [f"  {i+1}. {b.condition} → {b.next}" for i, b in enumerate(node.branches)]
            raise ValueError(f"This node has branches. Use --branch <N>:\n" + "\n".join(lines))
        if branch < 1 or branch > len(node.branches):
            lines = [f"  {i+1}. {b.condition} → {b.next}" for i, b in enumerate(node.branches)]
            raise ValueError(
                f"Invalid branch {branch}. Valid options (1-{len(node.branches)}):\n" + "\n".join(lines) + "\n\nExample: flowforge next --branch 1"
            )
        chosen = node.branches[branch - 1]
        nextNode = chosen.next
        branchTaken = chosen.condition
    elif node.next:
        nextNode = node.next
    elif node.terminal:
        close_history(inst['id'], inst['current_node'], None)
        set_instance_status(inst['id'], "done")
        return {
            'from': inst['current_node'],
            'to': "(end)",
            'branchTaken': None,
            'task': "",
            'branches': None,
            'hasNext': False,
            'terminal': True,
            'plateauWarning': None,
        }
    else:
        raise ValueError("Node has no next, branches, or terminal — this should not happen")

    visits = get_node_visit_count(inst['id'], nextNode)
    limit = wf.nodes[nextNode].max_visits if wf.nodes[nextNode] and wf.nodes[nextNode].max_visits else 5
    plateauWarning = None
    if visits >= limit:
        plateauWarning = f"Node {nextNode} visited {visits} times (limit: {limit}). Consider breaking the loop or adjusting strategy."

    close_history(inst['id'], inst['current_node'], branchTaken)
    update_instance_node(inst['id'], nextNode)
    add_history(inst['id'], nextNode)

    nextNodeDef = wf.nodes[nextNode]
    return {
        'from': inst['current_node'],
        'to': nextNode,
        'branchTaken': branchTaken,
        'task': nextNodeDef.task,
        'branches': [{'condition': b.condition, 'next': b.next} for b in nextNodeDef.branches] if nextNodeDef.branches else None,
        'hasNext': bool(nextNodeDef.next),
        'plateauWarning': plateauWarning,
    }

def log(workflowName: Optional[str] = None, instanceId: Optional[int] = None) -> Dict[str, Any]:
    inst = require_active_instance(workflowName, instanceId)
    return {
        'workflowName': inst['workflow_name'],
        'instanceId': inst['id'],
        'entries': get_history(inst['id']),
    }

def list() -> List[Dict[str, Any]]:
    return list_workflows()

def active(workflowName: Optional[str] = None) -> List[Dict[str, Any]]:
    return list_active_instances(workflowName)

def kill(instanceId: int) -> Dict[str, Any]:
    inst = get_instance(instanceId)
    if not inst:
        raise ValueError(f"Instance #{instanceId} not found.")
    if inst['status'] != 'active':
        raise ValueError(f"Instance #{instanceId} is already {inst['status']}.")
    close_history(inst['id'], inst['current_node'], None)
    set_instance_status(inst['id'], "cancelled")
    return {'id': inst['id'], 'workflowName': inst['workflow_name'], 'node': inst['current_node']}

def reset(workflowName: Optional[str] = None, instanceId: Optional[int] = None) -> Dict[str, Any]:
    inst = require_active_instance(workflowName, instanceId)
    wf = load_workflow(inst['workflow_name'])

    close_history(inst['id'], inst['current_node'], None)
    set_instance_status(inst['id'], "done")

    id = create_instance(inst['workflow_name'], wf.start)
    add_history(id, wf.start)
    return {'id': id, 'node': wf.start}

def delete_workflow_by_name(name: str) -> None:
    active_instances = list_active_instances(name)
    if len(active_instances) > 0:
        raise ValueError(f"Cannot delete workflow '{name}': {len(active_instances)} active instance(s) still running. Kill them first with 'flowforge kill <instance-id>' or wait for them to complete.")
    delete_workflow(name)

def get_action(workflowName: Optional[str] = None, previousResult: Optional[str] = None, instanceId: Optional[int] = None) -> FlowAction:
    inst = require_active_instance(workflowName, instanceId)
    wf = load_workflow(inst['workflow_name'])
    node = wf.nodes.get(inst['current_node'])
    if not node:
        raise ValueError(f"Node '{inst['current_node']}' not found")

    task = node.task
    if previousResult:
        task = f"{task}\n\nPrevious result:\n{previousResult}"

    if node.terminal:
        return FlowAction(
            type='complete',
            instanceId=inst['id'],
            workflowName=inst['workflow_name'],
            node=inst['current_node'],
            task=task,
            branches=None,
            previousResult=previousResult
        )

    if node.executor == 'subagent':
        return FlowAction(
            type='spawn',
            instanceId=inst['id'],
            workflowName=inst['workflow_name'],
            node=inst['current_node'],
            task=task,
            branches=node.branches,
            previousResult=previousResult
        )

    return FlowAction(
        type='prompt',
        instanceId=inst['id'],
        workflowName=inst['workflow_name'],
        node=inst['current_node'],
        task=task,
        branches=node.branches,
        previousResult=previousResult
    )

def advance_with_result(result: str, workflowName: Optional[str] = None, instanceId: Optional[int] = None) -> FlowAction:
    branch = None
    match = re.search(r'\bbranch:?\s*(\d+)\b', result, re.IGNORECASE)
    if match:
        branch = int(match.group(1))

    next_result = next(branch, workflowName, instanceId)

    if next_result.get('terminal'):
        inst = resolve_instance(workflowName, instanceId)
        if not inst:
            raise ValueError("No active instance found")
        return FlowAction(
            type='complete',
            instanceId=inst['id'],
            workflowName=inst['workflow_name'],
            node="(end)",
            task="",
            branches=None,
            previousResult=None
        )

    return get_action(workflowName, result, instanceId)