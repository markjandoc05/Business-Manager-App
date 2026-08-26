import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activityBelongsToClient } from '../lib/activity-history.ts';

const activity = (overrides = {}) => ({ id: 'activity', type: 'client_update', description: '', createdAt: new Date().toISOString(), ...overrides });

test('Client activity matching includes Client, source Lead, and conversion metadata records', () => {
  assert.equal(activityBelongsToClient(activity({ entityType: 'Client', entityId: 'client-a' }), 'client-a'), true);
  assert.equal(activityBelongsToClient(activity({ entityType: 'Lead', entityId: 'lead-a' }), 'client-a', 'lead-a'), true);
  assert.equal(activityBelongsToClient(activity({ metadata: { clientId: 'client-a' } }), 'client-a'), true);
});

test('Client activity matching excludes unrelated Clients and Leads', () => {
  assert.equal(activityBelongsToClient(activity({ entityType: 'Client', entityId: 'client-b' }), 'client-a'), false);
  assert.equal(activityBelongsToClient(activity({ entityType: 'Lead', entityId: 'lead-b' }), 'client-a', 'lead-a'), false);
  assert.equal(activityBelongsToClient(activity({ metadata: { clientId: 'client-b' } }), 'client-a'), false);
});

test('Client activity matching includes Deal, Task, and Note metadata records', () => {
  for (const entityType of ['Deal', 'Task', 'Note']) {
    assert.equal(activityBelongsToClient(activity({ entityType, entityId: `${entityType.toLowerCase()}-a`, metadata: { clientId: 'client-a' } }), 'client-a'), true);
  }
});
