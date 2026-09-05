import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeSaleQuantity, createOtherSaleLineItem, createSaleLineItem, createSaleLineItemsFromDeal, getSaleItemsTotal, normalizeSaleLineItems, recalculateSaleLineItem } from '../lib/sale-items.ts';
import { createSaleNumber, getLocalCalendarDate, normalizeSaleDate, normalizeSalePayment } from '../lib/sale-workflow.ts';

const catalogItem = (overrides = {}) => ({ id: 'catalog-1', type: 'SERVICE', name: 'Website Design', code: 'WEB-01', categoryId: 'web', category: 'Web', unit: 'project', regularPrice: 40000, salePrice: 35000, effectivePrice: 35000, status: 'ACTIVE', archived: false, createdBy: 'admin', createdAt: '2026-01-01T00:00:00.000Z', updatedBy: 'admin', updatedAt: '2026-01-01T00:00:00.000Z', ...overrides });

test('Sales snapshot catalog values and do not retain a live Catalog reference', () => {
  const source = catalogItem(); const item = createSaleLineItem(source); source.name = 'Changed'; source.effectivePrice = 1;
  assert.equal(item.name, 'Website Design'); assert.equal(item.unitPrice, 35000); assert.equal(item.source, 'CATALOG');
});

test('Deal-to-Sale conversion preserves negotiated snapshots and has a legacy Other fallback', () => {
  const dealItem = { source: 'CATALOG', catalogItemId: 'catalog-1', type: 'SERVICE', name: 'Website Design', code: 'WEB-01', categoryId: 'web', category: 'Web', unit: 'project', regularPrice: 40000, salePrice: 35000, quantity: 2, unitPrice: 30000, subtotal: 60000 };
  const [saleItem] = createSaleLineItemsFromDeal([dealItem], 'Unused fallback', 0);
  dealItem.name = 'Changed after conversion'; dealItem.unitPrice = 1;
  assert.equal(saleItem.name, 'Website Design'); assert.equal(saleItem.quantity, 2); assert.equal(saleItem.unitPrice, 30000); assert.equal(saleItem.subtotal, 60000);
  const [fallback] = createSaleLineItemsFromDeal([], 'Legacy Deal Title', 12500);
  assert.equal(fallback.source, 'OTHER'); assert.equal(fallback.name, 'Legacy Deal Title'); assert.equal(fallback.quantity, 1); assert.equal(fallback.unitPrice, 12500);
});

test('Other Sale items are immediate, quantity-one rows and preserve typed spaces until submission', () => {
  const other = createOtherSaleLineItem('Other item', 0); const editing = recalculateSaleLineItem(other, { name: 'On-site support ', quantity: 9, unitPrice: 1250 });
  assert.equal(editing.name, 'On-site support '); assert.equal(editing.quantity, 1); assert.equal(editing.subtotal, 1250);
  const [saved] = normalizeSaleLineItems([editing]); assert.equal(saved.name, 'On-site support'); assert.equal(saved.quantity, 1);
});

test('Sales normalize whole quantities, negotiated prices, totals, and 1–50-item boundaries', () => {
  const service = recalculateSaleLineItem(createSaleLineItem(catalogItem()), { quantity: 2, unitPrice: 30000 });
  const other = createOtherSaleLineItem('Setup', 2500);
  assert.equal(getSaleItemsTotal([service, other]), 62500); assert.equal(changeSaleQuantity(1, -1), 1);
  assert.throws(() => normalizeSaleLineItems([]), /between 1 and 50/);
  assert.throws(() => normalizeSaleLineItems(Array.from({ length: 51 }, () => service)), /between 1 and 50/);
  assert.throws(() => normalizeSaleLineItems([{ ...service, quantity: 1.5 }]), /positive whole number/);
});

test('payment status produces mutually consistent paid and balance values', () => {
  assert.deepEqual(normalizeSalePayment(100, 'PAID', 'CASH', 1), { paymentStatus: 'PAID', paymentMethod: 'CASH', amountPaid: 100, balance: 0 });
  assert.deepEqual(normalizeSalePayment(100, 'UNPAID', '', 99), { paymentStatus: 'UNPAID', paymentMethod: undefined, amountPaid: 0, balance: 100 });
  assert.deepEqual(normalizeSalePayment(100, 'PARTIAL', 'GCASH', 25), { paymentStatus: 'PARTIAL', paymentMethod: 'GCASH', amountPaid: 25, balance: 75 });
  assert.throws(() => normalizeSalePayment(100, 'PARTIAL', 'CASH', 0), /greater than zero/);
  assert.throws(() => normalizeSalePayment(100, 'PAID', '', 100), /payment method/);
});

test('Sale numbers are doc-ID derived and dates preserve local calendar days', () => {
  assert.equal(createSaleNumber('Ab-c_123456789'), 'S-ABC1234567'); assert.notEqual(createSaleNumber('a1'), createSaleNumber('b2'));
  assert.equal(normalizeSaleDate('2026-09-03'), '2026-09-03'); assert.throws(() => normalizeSaleDate('2026-02-30'), /not valid/);
  assert.equal(getLocalCalendarDate(new Date('2026-09-03T12:00:00')), '2026-09-03');
});
