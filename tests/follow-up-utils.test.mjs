import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getNextFollowUp, getTaskCalendarBucket, isFollowUpTask } from '../lib/task-utils.ts';

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

test('calendar task tabs are mutually exclusive', () => {
  const now = new Date(2026, 8, 14, 12, 0, 0);
  assert.equal(getTaskCalendarBucket(new Date(2026, 8, 14, 8, 0, 0).toISOString(), now), 'Today');
  assert.equal(getTaskCalendarBucket(new Date(2026, 8, 15, 0, 0, 0).toISOString(), now), 'Upcoming');
  assert.equal(getTaskCalendarBucket(new Date(2026, 8, 13, 23, 59, 59).toISOString(), now), 'Overdue');
});
