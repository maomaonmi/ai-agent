import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseVideoParameterPlacement } from '../src/features/omni/videoParamPlacement.ts';

test('video settings open downward when the composer is near the top', () => {
  assert.equal(chooseVideoParameterPlacement(120, 170, 900), 'down');
});

test('video settings open upward when the composer is near the bottom', () => {
  assert.equal(chooseVideoParameterPlacement(720, 770, 900), 'up');
});

test('video settings use the side with more room in a constrained viewport', () => {
  assert.equal(chooseVideoParameterPlacement(320, 380, 500, 390), 'up');
});
