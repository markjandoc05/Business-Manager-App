import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogItemMatchesFilters, getEffectiveCatalogPrice, normalizeCatalogItemInput } from '../lib/catalog-items.ts';

const item = (overrides = {}) => ({
  id: 'item-1',
  type: 'PRODUCT',
  name: 'Frozen Bagnet 450g',
  code: 'BAG-450',
  category: 'Food',
  unit: 'pack',
  description: '',
  regularPrice: 599,
  salePrice: null,
  effectivePrice: 599,
  status: 'ACTIVE',
  archived: false,
  createdBy: 'admin',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedBy: 'admin',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

test('normalizes catalog input and defaults new items to Active', () => {
  assert.deepEqual(normalizeCatalogItemInput({
    type: 'SERVICE', name: '  Website Development  ', code: ' WEB-001 ', categoryId: ' category-1 ', category: '  Digital ', unit: 'hour', description: '  Build and launch. ', regularPrice: 99,
  }), {
    type: 'SERVICE', name: 'Website Development', code: 'WEB-001', categoryId: 'category-1', category: 'Digital', unit: 'hour', description: 'Build and launch.', regularPrice: 99, salePrice: null, status: 'ACTIVE',
  });
});

test('rejects missing names, invalid regular prices, and sale prices above regular price', () => {
  assert.throws(() => normalizeCatalogItemInput({ type: 'PRODUCT', name: '  ', regularPrice: 1 }), /Name is required/);
  assert.throws(() => normalizeCatalogItemInput({ type: 'PRODUCT', name: 'Item', regularPrice: -1 }), /zero or greater/);
  assert.throws(() => normalizeCatalogItemInput({ type: 'PRODUCT', name: 'Item', regularPrice: Number.NaN }), /zero or greater/);
  assert.throws(() => normalizeCatalogItemInput({ type: 'PRODUCT', name: 'Item', regularPrice: 10, salePrice: 11 }), /cannot be greater/);
  assert.throws(() => normalizeCatalogItemInput({ type: 'PRODUCT', name: 'Item', regularPrice: 10, salePrice: -1 }), /zero or greater/);
});

test('uses a valid sale price as the effective price and otherwise falls back to regular price', () => {
  assert.equal(getEffectiveCatalogPrice(100, 75), 75);
  assert.equal(getEffectiveCatalogPrice(100), 100);
  assert.equal(getEffectiveCatalogPrice(100, 125), 100);
});

test('search matches name, code, and category and respects type and status filters', () => {
  assert.equal(catalogItemMatchesFilters(item(), 'bag-450', 'All', 'All'), true);
  assert.equal(catalogItemMatchesFilters(item(), 'food', 'PRODUCT', 'ACTIVE'), true);
  assert.equal(catalogItemMatchesFilters(item({ type: 'SERVICE' }), '', 'PRODUCT', 'All'), false);
  assert.equal(catalogItemMatchesFilters(item({ status: 'INACTIVE' }), '', 'All', 'ACTIVE'), false);
});
