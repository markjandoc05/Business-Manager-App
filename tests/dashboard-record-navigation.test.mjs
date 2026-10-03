import test from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardActivityHref, getDashboardRecordHref } from '../lib/dashboard-record-navigation.ts';

test('Dashboard record shortcuts use existing deep-link routes and preserve record IDs', () => {
  assert.equal(getDashboardRecordHref('Lead', 'lead/one'), '/leads?leadId=lead%2Fone');
  assert.equal(getDashboardRecordHref('Client', 'client one'), '/clients?clientId=client%20one');
  assert.equal(getDashboardRecordHref('Deal', 'deal-1'), '/pipeline?dealId=deal-1');
  assert.equal(getDashboardRecordHref('Task', 'task-1'), '/tasks?taskId=task-1');
});

test('Dashboard activity navigation accepts only supported structured entity references', () => {
  assert.equal(getDashboardActivityHref({ entityType: 'Lead', entityId: 'lead-1' }), '/leads?leadId=lead-1');
  assert.equal(getDashboardActivityHref({ entityType: 'Client', entityId: 'client-1' }), '/clients?clientId=client-1');
  assert.equal(getDashboardActivityHref({ entityType: 'Deal', entityId: 'deal-1' }), '/pipeline?dealId=deal-1');
  assert.equal(getDashboardActivityHref({ entityType: 'Task', entityId: 'task-1' }), '/tasks?taskId=task-1');
  assert.equal(getDashboardActivityHref({ entityType: 'Note', entityId: 'note-1', metadata: { clientId: 'client-1' } }), '/clients?clientId=client-1&tab=notes');
});

test('Dashboard activity navigation fails closed for unsupported, incomplete, or descriptive-only records', () => {
  assert.equal(getDashboardActivityHref({ entityType: 'Note', entityId: 'note-1' }), null);
  assert.equal(getDashboardActivityHref({ entityType: 'Settings', entityId: 'settings-1' }), null);
  assert.equal(getDashboardActivityHref({ entityType: 'Deal' }), null);
  assert.equal(getDashboardActivityHref({ entityType: undefined, entityId: 'deal-1' }), null);
  assert.equal(getDashboardActivityHref({ entityType: undefined, entityId: undefined, metadata: { description: 'Deal created: deal-1' } }), null);
});
