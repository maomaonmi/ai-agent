import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCodeTaskEvent,
  projectCodeTaskPlanSnapshot,
} from '../src/Code/codeTaskPlan.ts';

test('ledger task-list events keep implementation and verification as separate states', () => {
  const plan = applyCodeTaskEvent(null, {
    type: 'task_list',
    run_id: 'run-1',
    plan_id: 'goal-ledger-1',
    plan_path: '',
    todo_path: '',
    projection_source: 'goal_obligation_ledger',
    goal_id: 'goal-1',
    goal_set_revision: 3,
    sequence: 1,
    done: false,
    status: 'awaiting_verification',
    tasks: [{
      id: 'obl-1',
      task_key: 'obl-1',
      obligation_id: 'obl-1',
      goal_id: 'goal-1',
      title: 'Persist the requirement',
      description: 'Persist the requirement',
      target_files: [],
      status: 'implemented_unverified',
      implementation_status: 'implemented',
      verification_status: 'pending',
    }],
  });

  assert.equal(plan.projectionSource, 'goal_obligation_ledger');
  assert.equal(plan.planKind, 'acceptance');
  assert.equal(plan.goalId, 'goal-1');
  assert.equal(plan.goalSetRevision, 3);
  assert.equal(plan.planPath, '');
  assert.equal(plan.todoPath, '');
  assert.equal(plan.implementedCount, 1);
  assert.equal(plan.completedCount, 0);
  assert.equal(plan.tasks[0].implementation_status, 'implemented');
  assert.equal(plan.tasks[0].verification_status, 'pending');
});

test('persisted ledger snapshot projection does not invent Plan or todo files', () => {
  const plan = projectCodeTaskPlanSnapshot({
    run_id: 'run-2',
    plan_id: 'goal-ledger-1',
    plan_path: '',
    todo_path: '',
    ledger_path: 'goal_obligation_ledger',
    projection_source: 'goal_obligation_ledger',
    goal_id: 'goal-1',
    goal_set_revision: 3,
    sequence: 2,
    status: 'completed',
    tasks: [{
      id: 'obl-1',
      obligation_id: 'obl-1',
      goal_id: 'goal-1',
      title: 'Persist the requirement',
      description: 'Persist the requirement',
      target_files: [],
      status: 'completed',
      implementation_status: 'implemented',
      verification_status: 'verified',
    }],
  }, null);

  assert.ok(plan);
  assert.equal(plan.planPath, '');
  assert.equal(plan.todoPath, '');
  assert.equal(plan.implementedCount, 1);
  assert.equal(plan.completedCount, 1);
});

test('execution task lists are tagged separately from acceptance projections', () => {
  const plan = applyCodeTaskEvent(null, {
    type: 'task_list',
    run_id: 'run-execution-1',
    plan_id: 'execution-plan-1',
    plan_kind: 'execution',
    projection_source: 'execution_plan',
    sequence: 1,
    done: false,
    status: 'running',
    tasks: [{
      id: 'task-1',
      task_key: 'task-1',
      title: 'Complete the page structure',
      description: 'Build the user-requested page structure.',
      target_files: ['index.html'],
      status: 'pending',
    }],
  });

  assert.equal(plan.planKind, 'execution');
  assert.equal(plan.projectionSource, 'execution_plan');
  assert.equal(plan.totalCount, 1);
  assert.equal(plan.completedCount, 0);
});

test('planning presentation mode survives event projection and updates', () => {
  const plan = applyCodeTaskEvent(null, {
    type: 'task_list',
    run_id: 'run-plan-mode',
    plan_id: 'execution-plan-mode',
    plan_kind: 'execution',
    projection_source: 'execution_plan',
    planning_mode: 'COMPACT',
    sequence: 1,
    done: false,
    status: 'running',
    tasks: [{
      id: 'task-1',
      task_key: 'task-1',
      title: 'Create the requested artifact',
      description: 'Complete one coherent delivery.',
      target_files: [],
      status: 'pending',
    }],
  });

  assert.equal(plan.planningMode, 'COMPACT');
  const updated = applyCodeTaskEvent(plan, {
    type: 'task_update',
    run_id: 'run-plan-mode',
    plan_id: 'execution-plan-mode',
    plan_kind: 'execution',
    planning_mode: 'COMPACT',
    task_id: 'task-1',
    task_key: 'task-1',
    status: 'in_progress',
    done: false,
    sequence: 2,
  });
  assert.equal(updated.planningMode, 'COMPACT');
  assert.equal(updated.tasks[0].status, 'in_progress');
});
