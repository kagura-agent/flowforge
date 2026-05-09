import yaml
from typing import Dict, Any, List, Optional

class Branch:
    def __init__(self, condition: str, next: str):
        self.condition = condition
        self.next = next

class WorkflowNode:
    def __init__(self, task: str, executor: Optional[str] = None, next: Optional[str] = None,
                 branches: Optional[List[Branch]] = None, terminal: bool = False,
                 max_visits: Optional[int] = None, guard: Optional[str] = None):
        self.task = task
        self.executor = executor or 'inline'
        self.next = next
        self.branches = branches
        self.terminal = terminal
        self.max_visits = max_visits
        self.guard = guard

class Workflow:
    def __init__(self, name: str, description: Optional[str], start: str, nodes: Dict[str, WorkflowNode]):
        self.name = name
        self.description = description
        self.start = start
        self.nodes = nodes

def parse_workflow(content: str) -> Workflow:
    doc = yaml.safe_load(content)
    if not doc or not isinstance(doc, dict):
        raise ValueError("Invalid YAML")
    if not doc.get('name') or not isinstance(doc['name'], str):
        raise ValueError("Missing 'name'")
    if not doc.get('start') or not isinstance(doc['start'], str):
        raise ValueError("Missing 'start'")
    if not doc.get('nodes') or not isinstance(doc['nodes'], dict):
        raise ValueError("Missing 'nodes'")

    nodes: Dict[str, WorkflowNode] = {}
    for node_name, node_data in doc['nodes'].items():
        branches = None
        if node_data.get('branches'):
            branches_list = []
            for b in node_data['branches']:
                condition = b.get('condition')
                if isinstance(condition, bool):
                    condition = 'true' if condition else 'false'
                elif condition is None:
                    condition = ''
                branches_list.append(Branch(str(condition), b['next']))
            branches = branches_list

        nodes[node_name] = WorkflowNode(
            task=node_data.get('task', ''),
            executor=node_data.get('executor'),
            next=node_data.get('next'),
            branches=branches,
            terminal=bool(node_data.get('terminal')),
            max_visits=node_data.get('max_visits'),
            guard=node_data.get('guard')
        )

    wf = Workflow(
        name=doc['name'],
        description=doc.get('description'),
        start=doc['start'],
        nodes=nodes
    )

    if wf.start not in wf.nodes:
        raise ValueError(f"Start node '{wf.start}' not found in nodes")

    for node_name, node in wf.nodes.items():
        if not node.task:
            raise ValueError(f"Node '{node_name}' missing 'task'")
        if not node.next and not node.branches and not node.terminal:
            raise ValueError(f"Node '{node_name}' must have 'next', 'branches', or 'terminal: true'")
        if node.next and node.next not in wf.nodes:
            raise ValueError(f"Node '{node_name}' next points to unknown node '{node.next}'")
        if node.branches:
            for b in node.branches:
                if not b.condition or not b.next:
                    raise ValueError(f"Node '{node_name}' has invalid branch")
                if b.next not in wf.nodes:
                    raise ValueError(f"Node '{node_name}' branch points to unknown node '{b.next}'")

    return wf