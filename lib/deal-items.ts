import type { CatalogItem, DealLineItem } from '@/types';

export const DEAL_LINE_ITEM_LIMIT = 50;

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function numberAtLeast(value: unknown, minimum: number, message: string) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue < minimum) throw new Error(message);
  return roundMoney(numberValue);
}

export function normalizeDealQuantity(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || !Number.isInteger(numberValue) || numberValue < 1) {
    throw new Error('Deal item quantity must be a positive whole number.');
  }
  return numberValue;
}

export function changeDealQuantity(value: unknown, direction: 1 | -1) {
  const numberValue = Number(value);
  const currentQuantity = Number.isFinite(numberValue) && Number.isInteger(numberValue) && numberValue >= 1 ? numberValue : 1;
  return Math.max(1, currentQuantity + direction);
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createDealLineItem(item: CatalogItem): DealLineItem {
  const unitPrice = roundMoney(item.effectivePrice);
  return {
    source: 'CATALOG',
    catalogItemId: item.id,
    type: item.type,
    name: item.name,
    code: item.code || '',
    categoryId: item.categoryId || null,
    category: item.category || '',
    unit: item.unit || '',
    regularPrice: roundMoney(item.regularPrice),
    salePrice: item.salePrice ?? null,
    quantity: 1,
    unitPrice,
    subtotal: unitPrice,
  };
}

export function createOtherDealLineItem(name: string, unitPrice: number): DealLineItem {
  const itemName = text(name);
  if (!itemName) throw new Error('Other item name is required.');
  const price = numberAtLeast(unitPrice, 0, 'Other item price must be zero or greater.');
  return {
    source: 'OTHER',
    catalogItemId: null,
    type: null,
    name: itemName,
    code: '',
    categoryId: null,
    category: '',
    unit: '',
    regularPrice: price,
    salePrice: null,
    quantity: 1,
    unitPrice: price,
    subtotal: price,
  };
}

export function recalculateDealLineItem(item: DealLineItem, changes: Partial<Pick<DealLineItem, 'name' | 'quantity' | 'unitPrice'>>): DealLineItem {
  const quantity = Number(changes.quantity ?? item.quantity);
  const unitPrice = Number(changes.unitPrice ?? item.unitPrice);
  const safeQuantity = item.source === 'OTHER'
    ? 1
    : Number.isFinite(quantity) && Number.isInteger(quantity) && quantity >= 1
      ? quantity
      : Number.isFinite(quantity) && quantity < 1
        ? 1
        : item.quantity;
  const safeUnitPrice = Number.isFinite(unitPrice) && unitPrice >= 0 ? roundMoney(unitPrice) : 0;
  const name = item.source === 'OTHER' && changes.name !== undefined
    ? typeof changes.name === 'string' ? changes.name : item.name
    : item.name;
  return { ...item, name, quantity: safeQuantity, unitPrice: safeUnitPrice, subtotal: roundMoney(safeQuantity * safeUnitPrice) };
}

export function normalizeDealLineItems(items: unknown): DealLineItem[] {
  if (!Array.isArray(items)) throw new Error('Deal items must be a list.');
  if (items.length > DEAL_LINE_ITEM_LIMIT) throw new Error(`A deal can include up to ${DEAL_LINE_ITEM_LIMIT} products or services.`);

  const catalogItemIds = new Set<string>();
  return items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Deal item ${index + 1} is invalid.`);
    const value = item as Record<string, unknown>;
    const source = value.source === 'OTHER' ? 'OTHER' : value.source === 'CATALOG' || value.source === undefined ? 'CATALOG' : null;
    if (!source) throw new Error(`Deal item ${index + 1} has an invalid source.`);
    const name = text(value.name);
    if (!name) throw new Error(`Deal item ${index + 1} must include a name.`);
    const catalogItemId = source === 'CATALOG' ? text(value.catalogItemId) : null;
    if (source === 'CATALOG' && !catalogItemId) throw new Error(`Deal item ${index + 1} must include a catalog item and name.`);
    if (catalogItemId && catalogItemIds.has(catalogItemId)) throw new Error('Add each catalog item only once and adjust its quantity as needed.');
    if (catalogItemId) catalogItemIds.add(catalogItemId);
    let quantity = 1;
    if (source === 'CATALOG') {
      try {
        quantity = normalizeDealQuantity(value.quantity);
      } catch {
        throw new Error(`Deal item ${index + 1} quantity must be a positive whole number.`);
      }
    }
    const unitPrice = numberAtLeast(value.unitPrice, 0, `Deal item ${index + 1} has an invalid deal price.`);
    if (source === 'OTHER') {
      return {
        source,
        catalogItemId: null,
        type: null,
        name,
        code: '',
        categoryId: null,
        category: '',
        unit: '',
        regularPrice: unitPrice,
        salePrice: null,
        quantity,
        unitPrice,
        subtotal: roundMoney(quantity * unitPrice),
      };
    }
    const type = value.type === 'SERVICE' ? 'SERVICE' : value.type === 'PRODUCT' ? 'PRODUCT' : null;
    if (!type) throw new Error(`Deal item ${index + 1} must be a Product or Service.`);
    const regularPrice = numberAtLeast(value.regularPrice, 0, `Deal item ${index + 1} has an invalid regular price.`);
    const salePrice = value.salePrice === null || value.salePrice === undefined || value.salePrice === ''
      ? null
      : numberAtLeast(value.salePrice, 0, `Deal item ${index + 1} has an invalid sale price.`);
    if (salePrice !== null && salePrice > regularPrice) throw new Error(`Deal item ${index + 1} has a sale price above its regular price.`);
    return {
      source,
      catalogItemId,
      type,
      name,
      code: text(value.code),
      categoryId: text(value.categoryId) || null,
      category: text(value.category),
      unit: text(value.unit),
      regularPrice,
      salePrice,
      quantity,
      unitPrice,
      subtotal: roundMoney(quantity * unitPrice),
    };
  });
}

export function readDealLineItems(value: unknown): DealLineItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  try {
    return normalizeDealLineItems(value);
  } catch {
    return [];
  }
}

export function getDealItemsTotal(items: DealLineItem[]) {
  return roundMoney(items.reduce((total, item) => total + roundMoney(item.subtotal), 0));
}

export function getDealValue(manualValue: number, items?: DealLineItem[]) {
  return items && items.length > 0 ? getDealItemsTotal(items) : numberAtLeast(manualValue, 0, 'Deal value must be zero or greater.');
}

export function getDealProductServiceName(items: DealLineItem[], manualName?: string) {
  const manual = text(manualName);
  return manual || items.map((item) => item.name).join(', ');
}
