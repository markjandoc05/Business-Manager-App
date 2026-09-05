import assert from 'node:assert/strict';
import test from 'node:test';
import { readKpiPreference, reorderKpiIds, writeKpiPreference } from '../lib/kpi-preferences.ts';

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('KPI reorder changes presentation order without changing membership', () => {
  assert.deepEqual(reorderKpiIds(['total', 'transactions', 'outstanding'], 'outstanding', 'total'), ['outstanding', 'total', 'transactions']);
  assert.deepEqual(reorderKpiIds(['total', 'transactions'], 'missing', 'total'), ['total', 'transactions']);
});

test('KPI preferences sanitize invalid IDs and enforce selection bounds', () => {
  const store = storage();
  writeKpiPreference(store, 'reports', ['total', 'bad', 'total', 'transactions', 'amount']);
  assert.deepEqual(readKpiPreference(store, 'reports', ['total', 'transactions', 'amount'], ['total', 'transactions', 'amount']), ['total', 'transactions', 'amount']);
  writeKpiPreference(store, 'reports', ['total']);
  assert.deepEqual(readKpiPreference(store, 'reports', ['total', 'transactions', 'amount'], ['total', 'transactions', 'amount']), ['total', 'transactions', 'amount']);
});
