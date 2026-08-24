import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNextFollowUp, isFollowUpTask } from '../lib/task-utils.ts';

const task = (id, dueDate, type = 'Follow-up', status = 'Pending') => ({ id, title: id, dueDate, type, status, priority: 'Medium' });

test('selects the nearest future open Follow-up Task', () => {
  const result = getNextFollowUp([task('overdue', '2026-08-20T10:00:00.000Z'), task('nearest', '2026-08-25T10:00:00.000Z'), task('later', '2026-08-28T10:00:00.000Z')], Date.parse('2026-08-24T10:00:00.000Z'));
  assert.equal(result?.id, 'nearest');
});

test('falls back to the most recent overdue open Follow-up Task', () => {
  const result = getNextFollowUp([task('older', '2026-08-18T10:00:00.000Z'), task('newer', '2026-08-20T10:00:00.000Z')], Date.parse('2026-08-24T10:00:00.000Z'));
  assert.equal(result?.id, 'newer');
});

test('completed and normal Tasks are excluded', () => {
  const result = getNextFollowUp([task('completed', '2026-08-25T10:00:00.000Z', 'Follow-up', 'Completed'), task('normal', '2026-08-26T10:00:00.000Z', 'Task')], Date.parse('2026-08-24T10:00:00.000Z'));
  assert.equal(result, undefined);
  assert.equal(isFollowUpTask(task('legacy', '2026-08-26T10:00:00.000Z', undefined)), true);
});
