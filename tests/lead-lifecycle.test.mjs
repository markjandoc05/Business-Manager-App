import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyLeads, getLeadLifecycleState } from '../lib/lead-lifecycle.ts';

const lead = (id, lifecycle = {}) => ({
  id,
  name: id,
  email: `${id}@example.com`,
  phone: '',
  status: 'New',
  source: 'Website',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...lifecycle,
});

test('trash takes precedence over archive', () => {
  assert.equal(getLeadLifecycleState(lead('trashed', { archived: true, trashed: true })), 'TRASHED');
});

test('classification is mutually exclusive and deduplicated by lead id', () => {
  const views = classifyLeads([
    lead('active'),
    lead('archived', { archived: true }),
    lead('trashed', { archived: true, trashed: true }),
    lead('archived', { archived: true }),
  ]);

  assert.deepEqual(views.active.map(({ id }) => id), ['active']);
  assert.deepEqual(views.archived.map(({ id }) => id), ['archived']);
  assert.deepEqual(views.trashed.map(({ id }) => id), ['trashed']);
  assert.equal(new Set([...views.active, ...views.archived, ...views.trashed].map(({ id }) => id)).size, 3);
});
