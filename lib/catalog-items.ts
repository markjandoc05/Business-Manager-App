import type { CatalogItem, CatalogItemInput, CatalogItemStatus, CatalogItemType } from '@/types';

export type CatalogItemTypeFilter = CatalogItemType | 'All';
export type CatalogItemStatusFilter = CatalogItemStatus | 'All';

export function normalizeCatalogItemInput(input: CatalogItemInput) {
  if (input.type !== 'PRODUCT' && input.type !== 'SERVICE') {
    throw new Error('Choose whether this item is a Product or Service.');
  }

  const name = input.name.trim();
  if (!name) throw new Error('Name is required.');

  const regularPrice = Number(input.regularPrice);
  if (!Number.isFinite(regularPrice) || regularPrice < 0) {
    throw new Error('Regular price must be zero or greater.');
  }

  const salePrice = input.salePrice === undefined || input.salePrice === null
    ? null
    : Number(input.salePrice);
  if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice < 0)) {
    throw new Error('Sale price must be zero or greater.');
  }
  if (salePrice !== null && salePrice > regularPrice) {
    throw new Error('Sale price cannot be greater than the regular price.');
  }

  if (input.status && input.status !== 'ACTIVE' && input.status !== 'INACTIVE') {
    throw new Error('Choose a valid item status.');
  }

  return {
    type: input.type,
    name,
    code: input.code?.trim() || '',
    categoryId: input.categoryId?.trim() || null,
    category: input.category?.trim() || '',
    unit: input.unit?.trim() || '',
    description: input.description?.trim() || '',
    regularPrice,
    salePrice,
    status: input.status || 'ACTIVE',
  };
}

export function getEffectiveCatalogPrice(regularPrice: number, salePrice?: number) {
  return typeof salePrice === 'number' && Number.isFinite(salePrice) && salePrice >= 0 && salePrice <= regularPrice
    ? salePrice
    : regularPrice;
}

export function catalogItemMatchesFilters(
  item: CatalogItem,
  searchTerm: string,
  typeFilter: CatalogItemTypeFilter,
  statusFilter: CatalogItemStatusFilter,
) {
  const query = searchTerm.trim().toLocaleLowerCase();
  const searchableText = [item.name, item.code || '', item.category || ''].join(' ').toLocaleLowerCase();
  return (typeFilter === 'All' || item.type === typeFilter)
    && (statusFilter === 'All' || item.status === statusFilter)
    && (!query || searchableText.includes(query));
}

export function getSelectableCatalogItems(items: CatalogItem[]) {
  return items
    .filter((item) => item.status === 'ACTIVE' && !item.archived)
    .sort((left, right) => left.name.localeCompare(right.name));
}
