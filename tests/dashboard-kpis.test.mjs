import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DASHBOARD_KPI_IDS,
  KPI_REGISTRY,
  MAX_DASHBOARD_KPIS,
  normalizeDashboardKpiIds,
} from '../lib/dashboard-kpis.ts';

test('KPI registry has unique stable IDs and a valid default dashboard', () => {
  assert.equal(new Set(KPI_REGISTRY.map((kpi) => kpi.id)).size, KPI_REGISTRY.length);
  assert.equal(DEFAULT_DASHBOARD_KPI_IDS.length, 6);
  assert.deepEqual(DEFAULT_DASHBOARD_KPI_IDS, ['deals.potentialSales', 'leads.total', 'clients.total', 'deals.open', 'tasks.followupsDue', 'sales.total']);
  assert.ok(DEFAULT_DASHBOARD_KPI_IDS.every((id) => KPI_REGISTRY.some((kpi) => kpi.id === id)));
  assert.ok(KPI_REGISTRY.every((kpi) => ['RANGE', 'CURRENT_STATE'].includes(kpi.dateBehavior)));
  assert.ok(KPI_REGISTRY.every((kpi) => kpi.description.trim().endsWith('.') && kpi.description.length > 20));
  assert.ok(KPI_REGISTRY.every((kpi) => kpi.cardContext.trim().length > 0));
  assert.ok(KPI_REGISTRY.every((kpi) => typeof kpi.icon === 'object' || typeof kpi.icon === 'function'));
});

test('KPI preference normalization removes bad entries while preserving valid order', () => {
  assert.deepEqual(normalizeDashboardKpiIds(['sales.total', 'missing', 'sales.total', 'deals.open']), DEFAULT_DASHBOARD_KPI_IDS);
  const eight = KPI_REGISTRY.slice(0, MAX_DASHBOARD_KPIS).map((kpi) => kpi.id);
  assert.deepEqual(normalizeDashboardKpiIds([...eight, 'tasks.overdue']), eight);
  assert.deepEqual(normalizeDashboardKpiIds('corrupt'), DEFAULT_DASHBOARD_KPI_IDS);
});
