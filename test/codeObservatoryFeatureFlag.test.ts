import assert from 'node:assert/strict';
import test from 'node:test';

import { isCodeObservatoryEnabled } from '../src/lib/codeObservatoryFeatureFlag.ts';

test('Code observability is enabled by default to preserve the current workbench', () => {
  assert.equal(isCodeObservatoryEnabled(undefined), true);
  assert.equal(isCodeObservatoryEnabled('true'), true);
});

test('Code observability can be disabled with common local environment values', () => {
  for (const value of ['false', 'FALSE', '0', 'off', 'disabled']) {
    assert.equal(isCodeObservatoryEnabled(value), false, `${value} should disable the launcher`);
  }
});

test('Code observability ignores surrounding whitespace in the feature flag', () => {
  assert.equal(isCodeObservatoryEnabled('  false  '), false);
  assert.equal(isCodeObservatoryEnabled('  enabled  '), true);
});
