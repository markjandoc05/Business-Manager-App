import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSelectableCatalogItems } from '../lib/catalog-items.ts';
import { changeDealQuantity, createDealLineItem, createOtherDealLineItem, getDealItemsTotal, getDealValue, normalizeDealLineItems, recalculateDealLineItem } from '../lib/deal-items.ts';
import { DEAL_ACTIVE_STAGES, DEAL_STAGES, DEAL_TERMINAL_STAGES, getDealCreationStages, getDealProbability, getDealStatusForStage } from '../lib/deal-workflow.ts';

const catalogItem = (overrides = {}) => ({
  id: 'catalog-product',
  type: 'PRODUCT',
  name: 'Ultrasound Probe',
  code: 'USP-01',
  categoryId: 'equipment',
  category: 'Medical Equipment',
  unit: 'pc',
  description: '',
  regularPrice: 100000,
  salePrice: null,
  effectivePrice: 100000,
  status: 'ACTIVE',
  archived: false,
  createdBy: 'admin',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'admin',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

test('manual Deals remain valid without Catalog items', () => {
  assert.equal(getDealValue(12500, []), 12500);
  assert.equal(getDealValue(12500), 12500);
});

test('Deal creation uses the canonical open and closed stage order and mappings', () => {
  assert.deepEqual(DEAL_ACTIVE_STAGES, ['New', 'Qualified', 'Proposal', 'Negotiation']);
  assert.deepEqual(DEAL_TERMINAL_STAGES, ['Won', 'Lost']);
  assert.deepEqual(DEAL_STAGES, ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
  assert.deepEqual(getDealCreationStages().map((stage) => stage.name), [...DEAL_STAGES]);
  assert.equal(getDealProbability('Won'), 100);
  assert.equal(getDealProbability('Lost'), 0);
  assert.equal(getDealStatusForStage('Won'), 'Won');
  assert.equal(getDealStatusForStage('Lost'), 'Lost');
});

test('Catalog line items snapshot Product and Service prices, preferring a valid sale price', () => {
  const product = createDealLineItem(catalogItem());
  const service = createDealLineItem(catalogItem({ id: 'catalog-service', type: 'SERVICE', name: 'Website Development', regularPrice: 40000, salePrice: 35000, effectivePrice: 35000, unit: 'project' }));
  assert.equal(product.type, 'PRODUCT');
  assert.equal(product.unitPrice, 100000);
  assert.equal(service.type, 'SERVICE');
  assert.equal(service.unitPrice, 35000);
  assert.equal(service.salePrice, 35000);
});

test('Other line items are Deal-only, editable, and included in mixed totals', () => {
  const other = createOtherDealLineItem('Installation fee', 2500);
  assert.equal(other.source, 'OTHER');
  assert.equal(other.catalogItemId, null);
  assert.equal(other.type, null);
  const edited = recalculateDealLineItem(other, { name: 'Rush installation', quantity: 2, unitPrice: 3000 });
  assert.equal(edited.name, 'Rush installation');
  assert.equal(edited.quantity, 1);
  assert.equal(edited.subtotal, 3000);
  assert.equal(getDealItemsTotal([createDealLineItem(catalogItem()), edited]), 103000);
});

test('Other item names preserve spaces while the field is being edited', () => {
  const other = createOtherDealLineItem('Other item', 0);
  const typed = recalculateDealLineItem(other, { name: 'Website ' });
  assert.equal(typed.name, 'Website ');
  assert.equal(recalculateDealLineItem(typed, { name: 'Website Design' }).name, 'Website Design');
});

test('quantity stepper changes by one and never drops below one', () => {
  assert.equal(changeDealQuantity(1, 1), 2);
  assert.equal(changeDealQuantity(2, 1), 3);
  assert.equal(changeDealQuantity(3, -1), 2);
  assert.equal(changeDealQuantity(2, -1), 1);
  assert.equal(changeDealQuantity(1, -1), 1);
});

test('quantity, negotiated price, subtotals, and mixed Deal totals use whole units and two-decimal money precision', () => {
  const product = recalculateDealLineItem(createDealLineItem(catalogItem()), { quantity: 2, unitPrice: 99999.995 });
  const service = recalculateDealLineItem(createDealLineItem(catalogItem({ id: 'catalog-service', type: 'SERVICE', name: 'Maintenance', regularPrice: 5000, effectivePrice: 5000 })), { quantity: 2 });
  assert.equal(product.unitPrice, 100000);
  assert.equal(product.subtotal, 200000);
  assert.equal(service.subtotal, 10000);
  assert.equal(getDealItemsTotal([product, service]), 210000);
  assert.equal(getDealValue(1, [product, service]), 210000);
});

test('normalizing line items recalculates subtotal and rejects invalid quantities or duplicate Catalog items', () => {
  const item = createDealLineItem(catalogItem());
  const normalized = normalizeDealLineItems([{ ...item, quantity: 2, unitPrice: 100.25, subtotal: 1 }]);
  assert.equal(normalized[0].subtotal, 200.5);
  assert.equal(normalized[0].quantity, 2);
  for (const quantity of [0, -2, 0.1, 1.1, 2.5, '', 'not-a-number']) {
    assert.throws(() => normalizeDealLineItems([{ ...item, quantity }]), /positive whole number/);
  }
  assert.equal(recalculateDealLineItem(item, { quantity: 0 }).quantity, 1);
  assert.equal(recalculateDealLineItem(item, { quantity: -2 }).quantity, 1);
  assert.equal(recalculateDealLineItem(item, { quantity: 1.5 }).quantity, 1);
  assert.equal(recalculateDealLineItem(item, { quantity: '' }).quantity, 1);
  assert.throws(() => normalizeDealLineItems([item, { ...item }]), /only once/);
});

test('Catalog changes do not mutate stored Deal snapshots', () => {
  const source = catalogItem({ regularPrice: 40000, salePrice: 35000, effectivePrice: 35000, name: 'Website Development' });
  const snapshot = createDealLineItem(source);
  source.name = 'Website Development 2027';
  source.regularPrice = 45000;
  source.salePrice = 42000;
  source.effectivePrice = 42000;
  assert.deepEqual(snapshot, {
    source: 'CATALOG', catalogItemId: 'catalog-product', type: 'PRODUCT', name: 'Website Development', code: 'USP-01', categoryId: 'equipment', category: 'Medical Equipment', unit: 'pc', regularPrice: 40000, salePrice: 35000, quantity: 1, unitPrice: 35000, subtotal: 35000,
  });
});

test('legacy Catalog snapshots without source remain readable', () => {
  const legacyItem = { ...createDealLineItem(catalogItem()), source: undefined };
  const [normalized] = normalizeDealLineItems([legacyItem]);
  assert.equal(normalized.source, 'CATALOG');
  assert.equal(normalized.catalogItemId, 'catalog-product');
});

test('Other normalization strips Catalog metadata and recalculates its subtotal', () => {
  const [normalized] = normalizeDealLineItems([{
    source: 'OTHER', catalogItemId: null, type: null, name: 'Custom support', code: 'SHOULD-NOT-PERSIST', category: 'Catalog category', unit: 'hour', regularPrice: 1, salePrice: 1, quantity: 3, unitPrice: 1250, subtotal: 1,
  }]);
  assert.deepEqual(normalized, {
    source: 'OTHER', catalogItemId: null, type: null, name: 'Custom support', code: '', categoryId: null, category: '', unit: '', regularPrice: 1250, salePrice: null, quantity: 1, unitPrice: 1250, subtotal: 1250,
  });
});

test('only active, non-archived Catalog items are selectable for a new Deal', () => {
  const selectable = getSelectableCatalogItems([
    catalogItem({ id: 'inactive', name: 'Inactive', status: 'INACTIVE' }),
    catalogItem({ id: 'archived', name: 'Archived', archived: true }),
    catalogItem({ id: 'service', name: 'Website Development', type: 'SERVICE' }),
    catalogItem({ id: 'product', name: 'Equipment' }),
  ]);
  assert.deepEqual(selectable.map((item) => item.id), ['product', 'service']);
});
