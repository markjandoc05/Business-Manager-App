import type { CatalogItem, DealLineItem, SaleLineItem } from '@/types';

export const SALE_LINE_ITEM_LIMIT = 50;

export function roundSaleMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function requiredText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function moneyAtLeast(value: unknown, minimum: number, message: string) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < minimum) throw new Error(message);
  return roundSaleMoney(numberValue);
}

export function normalizeSaleQuantity(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue) || numberValue < 1) throw new Error('Sale item quantity must be a positive whole number.');
  return numberValue;
}

export function changeSaleQuantity(value: unknown, direction: 1 | -1) {
  const current = Number(value);
  return Math.max(1, Number.isFinite(current) && Number.isInteger(current) ? current + direction : 1);
}

export function createSaleLineItem(item: CatalogItem): SaleLineItem {
  const unitPrice = roundSaleMoney(item.effectivePrice);
  return { source: 'CATALOG', catalogItemId: item.id, type: item.type, name: item.name, code: item.code || '', categoryId: item.categoryId || null, category: item.category || '', unit: item.unit || '', regularPrice: roundSaleMoney(item.regularPrice), salePrice: item.salePrice ?? null, quantity: 1, unitPrice, subtotal: unitPrice };
}

export function createOtherSaleLineItem(name: string, unitPrice: number): SaleLineItem {
  const itemName = requiredText(name);
  if (!itemName) throw new Error('Other item name is required.');
  const price = moneyAtLeast(unitPrice, 0, 'Other item price must be zero or greater.');
  return { source: 'OTHER', catalogItemId: null, type: null, name: itemName, code: '', categoryId: null, category: '', unit: '', regularPrice: price, salePrice: null, quantity: 1, unitPrice: price, subtotal: price };
}

/** Copies the Deal's negotiated snapshot into a new Sale snapshot. */
export function createSaleLineItemsFromDeal(items: DealLineItem[] | undefined, fallbackName: string, fallbackValue: number): SaleLineItem[] {
  if (!items || items.length === 0) return [createOtherSaleLineItem(fallbackName, fallbackValue)];
  return normalizeSaleLineItems(items.map((item) => ({ ...item })));
}

export function recalculateSaleLineItem(item: SaleLineItem, changes: Partial<Pick<SaleLineItem, 'name' | 'quantity' | 'unitPrice'>>): SaleLineItem {
  const enteredQuantity = Number(changes.quantity ?? item.quantity);
  const enteredPrice = Number(changes.unitPrice ?? item.unitPrice);
  const quantity = item.source === 'OTHER' ? 1 : Number.isFinite(enteredQuantity) && Number.isInteger(enteredQuantity) && enteredQuantity >= 1 ? enteredQuantity : 1;
  const unitPrice = Number.isFinite(enteredPrice) && enteredPrice >= 0 ? roundSaleMoney(enteredPrice) : 0;
  // Keep leading/trailing spaces while the user is editing; createSale normalizes it.
  const name = item.source === 'OTHER' && changes.name !== undefined && typeof changes.name === 'string' ? changes.name : item.name;
  return { ...item, name, quantity, unitPrice, subtotal: roundSaleMoney(quantity * unitPrice) };
}

export function normalizeSaleLineItems(items: unknown): SaleLineItem[] {
  if (!Array.isArray(items)) throw new Error('Sale items must be a list.');
  if (items.length < 1 || items.length > SALE_LINE_ITEM_LIMIT) throw new Error(`A sale must include between 1 and ${SALE_LINE_ITEM_LIMIT} products or services.`);
  const catalogIds = new Set<string>();
  return items.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Sale item ${index + 1} is invalid.`);
    const value = raw as Record<string, unknown>;
    const source = value.source === 'OTHER' ? 'OTHER' : value.source === 'CATALOG' ? 'CATALOG' : null;
    if (!source) throw new Error(`Sale item ${index + 1} has an invalid source.`);
    const name = requiredText(value.name);
    if (!name) throw new Error(`Sale item ${index + 1} must include a name.`);
    const unitPrice = moneyAtLeast(value.unitPrice, 0, `Sale item ${index + 1} has an invalid sale price.`);
    if (source === 'OTHER') return { source, catalogItemId: null, type: null, name, code: '', categoryId: null, category: '', unit: '', regularPrice: unitPrice, salePrice: null, quantity: 1, unitPrice, subtotal: unitPrice };
    const catalogItemId = requiredText(value.catalogItemId);
    if (!catalogItemId) throw new Error(`Sale item ${index + 1} must include a catalog item.`);
    if (catalogIds.has(catalogItemId)) throw new Error('Add each catalog item only once and adjust its quantity as needed.');
    catalogIds.add(catalogItemId);
    const type = value.type === 'PRODUCT' || value.type === 'SERVICE' ? value.type : null;
    if (!type) throw new Error(`Sale item ${index + 1} must be a Product or Service.`);
    const regularPrice = moneyAtLeast(value.regularPrice, 0, `Sale item ${index + 1} has an invalid regular price.`);
    const salePrice = value.salePrice === null || value.salePrice === undefined || value.salePrice === '' ? null : moneyAtLeast(value.salePrice, 0, `Sale item ${index + 1} has an invalid sale price.`);
    if (salePrice !== null && salePrice > regularPrice) throw new Error(`Sale item ${index + 1} has a sale price above its regular price.`);
    const quantity = normalizeSaleQuantity(value.quantity);
    return { source, catalogItemId, type, name, code: requiredText(value.code), categoryId: requiredText(value.categoryId) || null, category: requiredText(value.category), unit: requiredText(value.unit), regularPrice, salePrice, quantity, unitPrice, subtotal: roundSaleMoney(quantity * unitPrice) };
  });
}

export function readSaleLineItems(value: unknown): SaleLineItem[] {
  try { return normalizeSaleLineItems(value); } catch { return []; }
}

export function getSaleItemsTotal(items: SaleLineItem[]) {
  return roundSaleMoney(items.reduce((total, item) => total + roundSaleMoney(item.subtotal), 0));
}
