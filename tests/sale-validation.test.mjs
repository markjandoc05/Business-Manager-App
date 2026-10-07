import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOtherSaleLineItem } from '../lib/sale-items.ts';
import { normalizeAdditionalSalePayment } from '../lib/sale-workflow.ts';
import { moneyCents, validateSaleRequest } from '../lib/sale-validation.ts';
import { emptyLifecycleDependencies, evaluateLifecycle } from '../lib/record-lifecycle.ts';

const request = (changes = {}) => ({ saleDate: '2026-10-07', customerType: 'WALK_IN', customerName: 'Synthetic buyer', items: [createOtherSaleLineItem('Service', 0.3)], paymentStatus: 'PARTIAL', paymentMethod: 'CASH', amountPaid: 0.1, ...changes });

test('authoritative validation preserves valid cents and additional payment progression', () => {
  const sale = validateSaleRequest(request());
  assert.equal(sale.total, 0.3); assert.equal(sale.amountPaid, 0.1); assert.equal(sale.balance, 0.2);
  const payment = normalizeAdditionalSalePayment(sale.total, sale.amountPaid, 0.2, 'CASH');
  assert.equal(payment.amountPaid, 0.3); assert.equal(payment.balance, 0); assert.equal(payment.paymentStatus, 'PAID');
  assert.equal(moneyCents(19.99), 1999);
});

test('valid large two-decimal amounts remain representable without accepting meaningful fractional cents', () => {
  for (const value of [150000000.02, 9999999999.03]) {
    const sale = validateSaleRequest(request({ items: [createOtherSaleLineItem('Service', value)], paymentStatus: 'UNPAID', amountPaid: 0 }));
    assert.equal(sale.total, value); assert.equal(moneyCents(value), Math.round(value * 100));
  }
  for (const value of [150000000.021, 9999999999.031]) assert.throws(() => moneyCents(value));
});

test('negative, fractional, mismatched and unsafe snapshots are rejected rather than normalized away', () => {
  for (const changes of [{ quantity: -3, subtotal: -3 }, { quantity: 2 }, { subtotal: 999 }, { quantity: 0.5 }, { unitPrice: -1 }, { unitPrice: 0.001 }, { subtotal: '0.30' }, { quantity: Number.MAX_SAFE_INTEGER }]) {
    assert.throws(() => validateSaleRequest(request({ items: [{ ...createOtherSaleLineItem('Service', 0.3), ...changes }] })));
  }
  for (const value of [NaN, Infinity, -1, Number.MAX_VALUE, '0.30', null]) assert.throws(() => moneyCents(value));
});

test('catalog snapshot negotiated price remains independent from catalog metadata', () => {
  const snapshot = { source: 'CATALOG', catalogItemId: 'historic-catalog', type: 'SERVICE', name: 'Negotiated service', code: '', categoryId: null, category: '', unit: 'project', regularPrice: 400, salePrice: 350, quantity: 2, unitPrice: 300, subtotal: 600 };
  const sale = validateSaleRequest(request({ items: [snapshot], paymentStatus: 'UNPAID', amountPaid: 0 }));
  assert.equal(sale.total, 600); assert.equal(sale.items[0].unitPrice, 300);
});

test('zero-value paid and unpaid Sales remain legitimate without positive receipts', () => {
  for (const paymentStatus of ['PAID', 'UNPAID']) {
    const sale = validateSaleRequest(request({ items: [createOtherSaleLineItem('Free service', 0)], paymentStatus, amountPaid: 0 }));
    assert.equal(sale.total, 0); assert.equal(sale.amountPaid, 0); assert.equal(sale.balance, 0);
  }
});

test('unknown fields, references, dates and item-list boundaries cannot bypass validation', () => {
  for (const changes of [{ total: 500 }, { status: 'VOIDED' }, { saleDate: '2026-02-30' }, { customerType: 'invalid' }, { source: 'DEAL' }, { dealId: 'orphan' }, { clientId: 'unexpected' }, { items: [] }, { items: Array.from({ length: 51 }, () => createOtherSaleLineItem('Service', 0.3)) }]) assert.throws(() => validateSaleRequest(request(changes)));
});

test('all recorded Sales block Client hard deletion but preserve archive and recoverable Trash', () => {
  const dependencies = { ...emptyLifecycleDependencies, sales: 2 };
  const decision = evaluateLifecycle('Client', 'permanent-delete', dependencies);
  assert.equal(decision.outcome, 'BLOCKED');
  assert.deepEqual(decision.blockingRecords, { 'Recorded Sales': 2 });
  assert.deepEqual(decision.cleanupRecords, {});
  assert.deepEqual(decision.preservedRecords, { 'Recorded Sales': 2 });
  for (const action of ['archive', 'trash']) assert.notEqual(evaluateLifecycle('Client', action, dependencies).outcome, 'BLOCKED');
});
