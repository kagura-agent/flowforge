#!/usr/bin/env python3
import argparse
import os
import sys
from pathlib import Path
import json

import engine

def auto_load_workflows():
    dirs = [
        Path.cwd() / "workflows",
        Path.home() / ".openclaw" / "workspace" / "flowforge" / "workflows"
    ]

    scanned_names = []

    for dir_path in dirs:
        if not dir_path.exists():
            continue

        try:
            for file in dir_path.iterdir():
                if file.suffix in ('.yaml', '.yml'):
                    try:
                        content = file.read_text(encoding='utf-8')
                        engine.define(content, "auto")
                        import re
                        match = re.search(r'^name:\s*(.+)', content, re.MULTILINE)
                        if match:
                            scanned_names.append(match.group(1).strip())
                    except Exception:
                        pass
        except Exception:
            pass

    all_workflows = engine.list()
    for wf in all_workflows:
        if wf['source'] == 'auto' and wf['name'] not in scanned_names:
            try:
                engine.delete_workflow(wf['name'])
            except Exception:
                pass

auto_load_workflows()

def print_status(opts):
    inst_id = int(opts.instance) if opts.instance else None
    workflow_name = getattr(opts, 'workflow_name', None)
    s = engine.status(workflow_name, inst_id)
    print(f"\n📍 Instance #{s['instanceId']} | {s['workflowName']} | Node: {s['currentNode']}")
    print(f"📋 Task: {s['task']}")
    if s.get('guard'):
        print(f"\n🛡️  Guard: {s['guard']}")
    if s.get('terminal'):
        print("\n🏁 This is a terminal node. Use: flowforge next")
    elif s.get('branches'):
        print("\nBranches:")
        for i, b in enumerate(s['branches']):
            print(f"  {i + 1}. {b['condition']} → {b['next']}")
        print("\nUse: flowforge next --branch <N>")
    elif s.get('nextNode'):
        print(f"\nNext: {s['nextNode']}")
        print("\nUse: flowforge next")
    print()

def cmd_define(args):
    try:
        content = Path(args.yaml).read_text(encoding='utf-8')
        name = engine.define(content, "manual")
        print(f"Workflow '{name}' defined (manual — protected from auto-overwrite).")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_delete(args):
    try:
        engine.delete_workflow(args.workflow)
        print(f"Workflow '{args.workflow}' deleted.")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_start(args):
    try:
        workflow = args.workflow
        if workflow.endswith('.yaml') or workflow.endswith('.yml'):
            abs_path = Path(workflow).resolve()
            if abs_path.exists():
                content = abs_path.read_text(encoding='utf-8')
                engine.define(content, "manual")
                import re
                match = re.search(r'^name:\s*(.+)$', content, re.MULTILINE)
                if match:
                    workflow = match.group(1).strip()

        result = engine.start(workflow)
        inst_id = int(args.instance) if args.instance else None
        if inst_id:
            print(f"Started new instance #{result['id']} at node '{result['node']}'.")
        else:
            print(f"Started instance #{result['id']} at node '{result['node']}'.")
        print_status(args)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_status(args):
    try:
        print_status(args)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_next(args):
    try:
        inst_id = int(args.instance) if args.instance else None
        branch = args.branch
        workflow_name = getattr(args, 'workflow_name', None)
        result = engine.next(branch, workflow_name, inst_id)
        if result.get('plateauWarning'):
            print(f"\n⚠️ {result['plateauWarning']}")
        if result.get('terminal'):
            print(f"\n✅ {result['from']} → (end) — Workflow complete!\n")
        else:
            branch_str = f" ({result['branchTaken']})" if result.get('branchTaken') else ""
            print(f"\n{result['from']} → {result['to']}{branch_str}\n")
            print_status(args)
        if args.notify:
            if result.get('terminal'):
                print("---NOTIFY---")
                print(f"✅ Workflow 完成：{result['from']} → 结束")
            else:
                s = engine.status(workflow_name, inst_id)
                print("---NOTIFY---")
                print(f"🔄 Workflow 进度：{result['from']} → {s['currentNode']}")
                print(f"📋 当前任务：{s['task'].split(chr(10))[0]}")
                if s.get('branches'):
                    print(f"⑂ {len(s['branches'])} 个分支待决策")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_log(args):
    try:
        inst_id = int(args.instance) if args.instance else None
        workflow_name = getattr(args, 'workflow_name', None)
        result = engine.log(workflow_name, inst_id)
        print(f"\nWorkflow: {result['workflowName']} (instance #{result['instanceId']})\n")
        for e in result['entries']:
            branch = f" [{e['branch_taken']}]" if e.get('branch_taken') else ""
            exit_str = f" → exited {e['exited_at']}" if e.get('exited_at') else " (current)"
            print(f"  {e['entered_at']}  {e['node_name']}{branch}{exit_str}")
        print()
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_list(args):
    workflows = engine.list()
    if not workflows:
        print("No workflows defined.")
        return
    for w in workflows:
        source_str = ' [manual]' if w['source'] == 'manual' else ''
        print(f"  {w['name']}{source_str}  (updated {w['updated_at']})")

def cmd_active(args):
    instances = engine.active(getattr(args, 'workflow_name', None))
    if not instances:
        print("No active instances.")
        return
    for inst in instances:
        print(f"  #{inst['id']}  {inst['workflow_name']}  at '{inst['current_node']}'  (started {inst['created_at']})")

def cmd_kill(args):
    try:
        instance_id = int(args.instance)
        result = engine.kill(instance_id)
        print(f"Instance #{result['id']} ({result['workflowName']} at '{result['node']}') cancelled.")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_reset(args):
    try:
        inst_id = int(args.instance) if args.instance else None
        workflow_name = getattr(args, 'workflow_name', None)
        result = engine.reset(workflow_name, inst_id)
        print(f"Reset. New instance #{result['id']} at node '{result['node']}'.")
        print_status(args)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_run(args):
    try:
        inst_id = int(args.instance) if args.instance else None
        existing = engine.active(args.workflow)
        if not [i for i in existing if i['workflow_name'] == args.workflow]:
            engine.start(args.workflow)

        action = engine.get_action(args.workflow, None, inst_id)
        print(json.dumps({'action': action.to_dict()}, indent=2))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

def cmd_advance(args):
    try:
        inst_id = int(args.instance) if args.instance else None
        result_text = args.result

        if not result_text:
            result_text = sys.stdin.read().strip()

        workflow_name = getattr(args, 'workflow_name', None)
        action = engine.advance_with_result(result_text, workflow_name, inst_id)
        print(json.dumps({'action': action.to_dict()}, indent=2))
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

parser = argparse.ArgumentParser(
    prog='flowforge',
    description='Personal workflow engine'
)
parser.add_argument('--version', action='version', version='%(prog)s 1.2.3')

subparsers = parser.add_subparsers(dest='command', help='Available commands')

shared_instance = argparse.ArgumentParser(add_help=False)
shared_instance.add_argument('--instance', help='Target a specific instance by ID')
shared_instance.add_argument('-w', '--workflow', dest='workflow_name', help='Target a workflow by name')

define_parser = subparsers.add_parser('define', help="Register or update a workflow from a YAML file")
define_parser.add_argument('yaml', help='Path to YAML file')

delete_parser = subparsers.add_parser('delete', help="Delete a registered workflow and its history")
delete_parser.add_argument('workflow', help='Workflow name')

start_parser = subparsers.add_parser('start', parents=[shared_instance], help='Start a new instance of a workflow')
start_parser.add_argument('workflow', help='Workflow name or path to .yaml file')

status_parser = subparsers.add_parser('status', parents=[shared_instance], help='Show current node, task, and available branches')

next_parser = subparsers.add_parser('next', parents=[shared_instance], help='Complete current node and move to next')
next_parser.add_argument('-b', '--branch', dest='branch', type=int, help='Branch number (1-indexed) for branching nodes')
next_parser.add_argument('--notify', action='store_true', help='Output a notification message for the user')

log_parser = subparsers.add_parser('log', parents=[shared_instance], help='Show history of nodes visited')

list_parser = subparsers.add_parser('list', help='List all defined workflows')

active_parser = subparsers.add_parser('active', help='List active instances')
active_parser.add_argument('-w', '--workflow', dest='workflow_name', help='Filter by workflow name')

kill_parser = subparsers.add_parser('kill', help='Kill a running workflow instance')
kill_parser.add_argument('instance', help='Instance ID')

reset_parser = subparsers.add_parser('reset', parents=[shared_instance], help='Reset current instance back to start node')

run_parser = subparsers.add_parser('run', help='Start workflow and output next action as JSON')
run_parser.add_argument('workflow', help='Workflow name')
run_parser.add_argument('--instance', help='Target a specific instance by ID')

advance_parser = subparsers.add_parser('advance', help='Advance workflow with result and output next action as JSON')
advance_parser.add_argument('--instance', help='Target a specific instance by ID')
advance_parser.add_argument('-w', '--workflow', dest='workflow_name', help='Target a workflow by name')
advance_parser.add_argument('--result', help='Result text from previous step')

args = parser.parse_args()

if not args.command:
    parser.print_help()
    sys.exit(1)

dispatch = {
    'define': cmd_define,
    'delete': cmd_delete,
    'start': cmd_start,
    'status': cmd_status,
    'next': cmd_next,
    'log': cmd_log,
    'list': cmd_list,
    'active': cmd_active,
    'kill': cmd_kill,
    'reset': cmd_reset,
    'run': cmd_run,
    'advance': cmd_advance,
}

if args.command in dispatch:
    dispatch[args.command](args)
else:
    parser.print_help()
    sys.exit(1)