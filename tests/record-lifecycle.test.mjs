import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyLifecycleDependencies, evaluateLifecycle } from '../lib/record-lifecycle.ts';

const deps = (overrides = {}) => ({ ...emptyLifecycleDependencies, ...overrides });

test('archive preserves related lead history with a warning', () => {
  const decision = evaluateLifecycle('Lead', 'archive', deps({ tasks: 2, activities: 1 }));
  assert.equal(decision.outcome, 'ALLOWED_WITH_WARNING');
  assert.deepEqual(decision.affectedRecords, { Tasks: 2, Activities: 1 });
});

test('Client trash is blocked while an active deal exists', () => {
  const decision = evaluateLifecycle('Client', 'trash', deps({ activeDeals: 1 }));
  assert.equal(decision.outcome, 'BLOCKED');
  assert.match(decision.reason, /active deal/i);
  assert.equal(decision.recommendedAction, 'Close, reassign, or remove the active Deals first.');
});

test('converted Lead trash remains allowed with an explicit warning', () => {
  const decision = evaluateLifecycle('Lead', 'trash', deps({ convertedClientName: 'Acme Client' }));
  assert.equal(decision.outcome, 'ALLOWED_WITH_WARNING');
  assert.match(decision.reason, /converted/i);
  assert.match(decision.reason, /Client and its records will remain unchanged/i);
});

test('Lead permanent deletion allows safe child cleanup and preserves history', () => {
  const decision = evaluateLifecycle('Lead', 'permanent-delete', deps({ tasks: 2, notes: 1, activities: 4, timelineEntries: 1, convertedClientName: 'Acme Client' }));
  assert.equal(decision.outcome, 'ALLOWED_WITH_WARNING');
  assert.deepEqual(decision.cleanupRecords, { Tasks: 2, Notes: 1 });
  assert.deepEqual(decision.preservedRecords, { Activities: 4, 'Converted Client': 'Acme Client' });
  assert.deepEqual(decision.blockingRecords, {});
});

test('permanent deletion blocks protected Client history but reports the exact blockers', () => {
  const decision = evaluateLifecycle('Client', 'permanent-delete', deps({
    tasks: 1,
    notes: 2,
    documents: 1,
    wonDeals: 1,
  }));
  assert.equal(decision.outcome, 'BLOCKED');
  assert.deepEqual(decision.affectedRecords, { Tasks: 1, Notes: 2, Documents: 1, 'Won Deals': 1 });
  assert.deepEqual(decision.blockingRecords, { 'Won Deals': 1 });
  assert.deepEqual(decision.cleanupRecords, { Tasks: 1, Notes: 2, Documents: 1 });
});

test('a converted Lead without child records can be permanently deleted safely', () => {
  const decision = evaluateLifecycle('Lead', 'permanent-delete', deps({ convertedClientName: 'Acme Client' }));
  assert.equal(decision.outcome, 'ALLOWED_WITH_WARNING');
  assert.match(decision.reason, /converted/i);
});
