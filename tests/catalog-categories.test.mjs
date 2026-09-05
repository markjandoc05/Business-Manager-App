import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeCatalogCategoryInput, normalizeCatalogCategoryName } from '../lib/catalog-categories.ts';

test('normalizes reusable category names to a case-insensitive duplicate key', () => {
  assert.deepEqual(normalizeCatalogCategoryName('  Food   &   Beverage '), {
    name: 'Food & Beverage',
    normalizedName: 'food & beverage',
  });
  assert.equal(normalizeCatalogCategoryName('FOOD & BEVERAGE').normalizedName, 'food & beverage');
});

test('normalizes category input and defaults categories to Active', () => {
  assert.deepEqual(normalizeCatalogCategoryInput({ name: '  Consulting ', type: 'SERVICE' }), {
    name: 'Consulting', normalizedName: 'consulting', type: 'SERVICE', status: 'ACTIVE',
  });
});

test('rejects blank category names, unsupported types, and statuses', () => {
  assert.throws(() => normalizeCatalogCategoryInput({ name: ' ', type: 'PRODUCT' }), /required/);
  assert.throws(() => normalizeCatalogCategoryInput({ name: 'Food', type: 'BUNDLE' }), /Products or Services/);
  assert.throws(() => normalizeCatalogCategoryInput({ name: 'Food', type: 'PRODUCT', status: 'ARCHIVED' }), /valid category status/);
});
