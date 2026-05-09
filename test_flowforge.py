import unittest
import sys
import os
import shutil

sys.path.insert(0, os.path.dirname(__file__))

import db
import engine
import workflow

class TestWorkflow(unittest.TestCase):
    def setUp(self):
        db.db.execute("DELETE FROM history")
        db.db.execute("DELETE FROM instances")
        db.db.execute("DELETE FROM workflows")
        db.db.commit()

    def test_parse_minimal(self):
        wf = workflow.parse_workflow("""
name: test
start: a
nodes:
  a:
    task: do A
    terminal: true
""")
        self.assertEqual(wf.name, "test")
        self.assertEqual(wf.start, "a")
        self.assertEqual(wf.nodes['a'].task, "do A")
        self.assertTrue(wf.nodes['a'].terminal)

    def test_parse_linear(self):
        wf = workflow.parse_workflow("""
name: linear
start: a
nodes:
  a:
    task: do A
    next: b
  b:
    task: do B
    terminal: true
""")
        self.assertEqual(wf.nodes['a'].next, "b")

    def test_parse_branches(self):
        wf = workflow.parse_workflow("""
name: branchy
start: a
nodes:
  a:
    task: do A
    branches:
      - condition: yes
        next: b
      - condition: no
        next: c
  b:
    task: do B
    terminal: true
  c:
    task: do C
    terminal: true
""")
        self.assertEqual(len(wf.nodes['a'].branches), 2)
        self.assertEqual(wf.nodes['a'].branches[0].next, "b")

    def test_invalid_yaml(self):
        with self.assertRaises(ValueError):
            workflow.parse_workflow("")

    def test_missing_name(self):
        with self.assertRaises(ValueError) as ctx:
            workflow.parse_workflow("start: a\nnodes:\n  a:\n    task: t\n    terminal: true")
        self.assertIn("name", str(ctx.exception).lower())

    def test_missing_start(self):
        with self.assertRaises(ValueError) as ctx:
            workflow.parse_workflow("name: x\nnodes:\n  a:\n    task: t\n    terminal: true")
        self.assertIn("start", str(ctx.exception).lower())

    def test_missing_nodes(self):
        with self.assertRaises(ValueError) as ctx:
            workflow.parse_workflow("name: x\nstart: a")
        self.assertIn("nodes", str(ctx.exception).lower())

    def test_start_node_not_in_nodes(self):
        with self.assertRaises(ValueError) as ctx:
            workflow.parse_workflow("name: x\nstart: z\nnodes:\n  a:\n    task: t\n    terminal: true")
        self.assertIn("z", str(ctx.exception))

    def test_node_missing_task(self):
        with self.assertRaises(ValueError) as ctx:
            workflow.parse_workflow("name: x\nstart: a\nnodes:\n  a:\n    next: a")
        self.assertIn("task", str(ctx.exception).lower())

    def test_node_no_next_branches_terminal(self):
        with self.assertRaises(ValueError) as ctx:
            workflow.parse_workflow("name: x\nstart: a\nnodes:\n  a:\n    task: t")
        self.assertIn("next", str(ctx.exception).lower())

    def test_next_points_to_unknown_node(self):
        with self.assertRaises(ValueError) as ctx:
            workflow.parse_workflow("name: x\nstart: a\nnodes:\n  a:\n    task: t\n    next: z")
        self.assertIn("z", str(ctx.exception))

    def test_branch_points_to_unknown_node(self):
        with self.assertRaises(ValueError):
            workflow.parse_workflow("""
name: x
start: a
nodes:
  a:
    task: t
    branches:
      - condition: yes
        next: missing
""")


class TestEngine(unittest.TestCase):
    def setUp(self):
        db.db.execute("DELETE FROM history")
        db.db.execute("DELETE FROM instances")
        db.db.execute("DELETE FROM workflows")
        db.db.commit()

    linear_yaml = """
name: linear
start: step1
nodes:
  step1:
    task: do step 1
    next: step2
  step2:
    task: do step 2
    terminal: true
"""

    branch_yaml = """
name: branchy
start: decide
nodes:
  decide:
    task: make a decision
    branches:
      - condition: left
        next: left_node
      - condition: right
        next: right_node
  left_node:
    task: go left
    terminal: true
  right_node:
    task: go right
    terminal: true
"""

    subagent_yaml = """
name: sub
start: s1
nodes:
  s1:
    task: agent task
    executor: subagent
    next: s2
  s2:
    task: done
    terminal: true
"""

    def test_define(self):
        name = engine.define(self.linear_yaml)
        self.assertEqual(name, "linear")

    def test_define_invalid_yaml(self):
        with self.assertRaises(Exception):
            engine.define("bad: yaml")

    def test_start_creates_instance(self):
        engine.define(self.linear_yaml)
        result = engine.start("linear")
        self.assertEqual(result['node'], "step1")
        self.assertIsNone(result['previouslyClosed'])

    def test_start_auto_closes_existing(self):
        engine.define(self.linear_yaml)
        first = engine.start("linear")
        second = engine.start("linear")
        self.assertEqual(second['previouslyClosed'], first['id'])

    def test_start_unknown_workflow(self):
        with self.assertRaises(ValueError) as ctx:
            engine.start("nope")
        self.assertIn("not found", str(ctx.exception).lower())
        self.assertIn("list", str(ctx.exception).lower())

    def test_status_returns_node_info(self):
        engine.define(self.linear_yaml)
        engine.start("linear")
        s = engine.status("linear")
        self.assertEqual(s['currentNode'], "step1")
        self.assertEqual(s['task'], "do step 1")
        self.assertTrue(s['hasNext'])
        self.assertFalse(s['terminal'])

    def test_status_no_active_instance(self):
        with self.assertRaises(ValueError) as ctx:
            engine.status("linear")
        self.assertIn("No active instance", str(ctx.exception))

    def test_next_advances_linearly(self):
        engine.define(self.linear_yaml)
        engine.start("linear")
        result = engine.next(None, "linear")
        self.assertEqual(result['from'], "step1")
        self.assertEqual(result['to'], "step2")
        self.assertEqual(result['task'], "do step 2")

    def test_next_handles_terminal(self):
        engine.define(self.linear_yaml)
        engine.start("linear")
        engine.next(None, "linear")
        result = engine.next(None, "linear")
        self.assertTrue(result['terminal'])
        self.assertEqual(result['to'], "(end)")

    def test_next_follows_branch(self):
        engine.define(self.branch_yaml)
        engine.start("branchy")
        result = engine.next(2, "branchy")
        self.assertEqual(result['to'], "right_node")
        self.assertEqual(result['branchTaken'], "right")

    def test_next_branch_required_but_not_given(self):
        engine.define(self.branch_yaml)
        engine.start("branchy")
        with self.assertRaises(ValueError) as ctx:
            engine.next(None, "branchy")
        self.assertIn("branches", str(ctx.exception).lower())

    def test_next_invalid_branch_number(self):
        engine.define(self.branch_yaml)
        engine.start("branchy")
        with self.assertRaises(ValueError) as ctx:
            engine.next(5, "branchy")
        self.assertIn("5", str(ctx.exception))

    def test_log_returns_history(self):
        engine.define(self.linear_yaml)
        engine.start("linear")
        engine.next(None, "linear")
        result = engine.log("linear")
        self.assertEqual(result['workflowName'], "linear")
        self.assertGreater(len(result['entries']), 0)

    def test_list_workflows(self):
        engine.define(self.linear_yaml)
        result = engine.list()
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['name'], "linear")

    def test_active_instances(self):
        engine.define(self.linear_yaml)
        engine.start("linear")
        result = engine.active()
        self.assertEqual(len(result), 1)

    def test_reset_closes_old_creates_new(self):
        engine.define(self.linear_yaml)
        first = engine.start("linear")
        engine.next(None, "linear")
        result = engine.reset("linear")
        self.assertEqual(result['node'], "step1")
        self.assertNotEqual(result['id'], first['id'])

    def test_get_action_prompt(self):
        engine.define(self.linear_yaml)
        engine.start("linear")
        action = engine.get_action("linear")
        self.assertEqual(action.type, "prompt")
        self.assertEqual(action.node, "step1")

    def test_get_action_spawn_for_subagent(self):
        engine.define(self.subagent_yaml)
        engine.start("sub")
        action = engine.get_action("sub")
        self.assertEqual(action.type, "spawn")

    def test_get_action_complete_for_terminal(self):
        engine.define(self.linear_yaml)
        engine.start("linear")
        engine.next(None, "linear")
        action = engine.get_action("linear")
        self.assertEqual(action.type, "complete")

    def test_get_action_appends_previous_result(self):
        engine.define(self.linear_yaml)
        engine.start("linear")
        action = engine.get_action("linear", "some result")
        self.assertIn("some result", action.task)
        self.assertEqual(action.previousResult, "some result")

    def test_advance_with_result_linear(self):
        engine.define(self.linear_yaml)
        engine.start("linear")
        action = engine.advance_with_result("done", "linear")
        self.assertEqual(action.node, "step2")
        self.assertEqual(action.type, "complete")

    def test_advance_with_result_parses_branch(self):
        engine.define(self.branch_yaml)
        engine.start("branchy")
        action = engine.advance_with_result("Branch: 1", "branchy")
        self.assertEqual(action.node, "left_node")


class TestPlateauDetection(unittest.TestCase):
    def setUp(self):
        db.db.execute("DELETE FROM history")
        db.db.execute("DELETE FROM instances")
        db.db.execute("DELETE FROM workflows")
        db.db.commit()

    loop_yaml = """
name: looper
start: work
nodes:
  work:
    task: do work
    next: work
"""

    loop_custom_yaml = """
name: looper_custom
start: work
nodes:
  work:
    task: do work
    max_visits: 3
    next: work
"""

    def test_plateau_after_5_visits_default(self):
        engine.define(self.loop_yaml)
        engine.start("looper")
        for i in range(4):
            r = engine.next(None, "looper")
            self.assertIsNone(r.get('plateauWarning'))
        result = engine.next(None, "looper")
        self.assertIsNotNone(result.get('plateauWarning'))
        self.assertIn("work", result['plateauWarning'])
        self.assertIn("limit: 5", result['plateauWarning'])

    def test_plateau_custom_max_visits(self):
        engine.define(self.loop_custom_yaml)
        engine.start("looper_custom")
        for i in range(2):
            r = engine.next(None, "looper_custom")
            self.assertIsNone(r.get('plateauWarning'))
        result = engine.next(None, "looper_custom")
        self.assertIsNotNone(result.get('plateauWarning'))
        self.assertIn("limit: 3", result['plateauWarning'])

    def test_no_plateau_warning_linear_flow(self):
        linear_yaml = """
name: linear
start: step1
nodes:
  step1:
    task: do step 1
    next: step2
  step2:
    task: do step 2
    terminal: true
"""
        engine.define(linear_yaml)
        engine.start("linear")
        result = engine.next(None, "linear")
        self.assertIsNone(result.get('plateauWarning'))


class TestDeleteWorkflow(unittest.TestCase):
    def setUp(self):
        db.db.execute("DELETE FROM history")
        db.db.execute("DELETE FROM instances")
        db.db.execute("DELETE FROM workflows")
        db.db.commit()

    def test_delete_with_active_instance_fails(self):
        engine.define("""
name: test
start: a
nodes:
  a:
    task: do A
    next: b
  b:
    task: do B
    terminal: true
""")
        engine.start("test")
        with self.assertRaises(ValueError) as ctx:
            engine.delete_workflow_by_name("test")
        self.assertIn("active", str(ctx.exception).lower())

    def test_delete_inactive_workflow_succeeds(self):
        engine.define("""
name: test
start: a
nodes:
  a:
    task: do A
    terminal: true
""")
        engine.delete_workflow_by_name("test")
        workflows = engine.list()
        self.assertFalse(any(w['name'] == 'test' for w in workflows))


if __name__ == '__main__':
    unittest.main()