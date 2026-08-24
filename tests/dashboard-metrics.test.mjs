import test from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardLeadTotal } from '../lib/dashboard-metrics.ts';

test('Dashboard Leads total uses the aggregate total instead of the paginated loaded list', () => {
  assert.equal(getDashboardLeadTotal({ totalLeads: 12 }), 12);
  assert.equal(getDashboardLeadTotal({ totalLeads: 50 }), 50);
});

test('Dashboard Leads total is zero while aggregate metrics are loading', () => {
  assert.equal(getDashboardLeadTotal(null), 0);
});
