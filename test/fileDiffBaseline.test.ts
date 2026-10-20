import assert from 'node:assert/strict';
import test from 'node:test';
import { transitionFileDiffBaseline } from '../src/Code/fileDiffBaseline.ts';

test('captures the source snapshot when a run starts and keeps it after completion', () => {
  const source = { 'src/app.ts': 'before' };
  const started = transitionFileDiffBaseline(
    'modifying',
    'idle',
    source,
    {},
    false,
  );
  const afterPatch = { 'src/app.ts': 'after' };
  const finished = transitionFileDiffBaseline(
    'done',
    'modifying',
    afterPatch,
    started.baseline,
    true,
  );

  assert.deepEqual(started.baseline, source);
  assert.equal(started.captured, true);
  assert.deepEqual(finished.baseline, source);
  assert.equal(finished.captured, false);
});

test('the next run uses the previous completed candidate as its baseline', () => {
  const candidate = { 'src/app.ts': 'after' };
  const nextRun = transitionFileDiffBaseline(
    'generating',
    'done',
    candidate,
    { 'src/app.ts': 'before' },
    true,
  );

  assert.deepEqual(nextRun.baseline, candidate);
  assert.equal(nextRun.captured, true);
});

test('a newly created file is distinguishable from an equal baseline file', () => {
  const baseline = { 'src/app.ts': 'unchanged' };
  const transition = transitionFileDiffBaseline(
    'done',
    'modifying',
    { ...baseline, 'src/new.ts': 'new file' },
    baseline,
    true,
  );

  assert.equal(transition.captured, false);
  assert.equal(transition.baseline['src/new.ts'], undefined);
});
