import type { CatalogCategoryInput, CatalogCategoryStatus, CatalogItemType } from '@/types';

export function normalizeCatalogCategoryName(value: string) {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Category name is required.');
  return { name, normalizedName: name.toLocaleLowerCase() };
}

export function normalizeCatalogCategoryInput(input: CatalogCategoryInput) {
  if (input.type !== 'PRODUCT' && input.type !== 'SERVICE') {
    throw new Error('Choose whether this category is for Products or Services.');
  }
  if (input.status && input.status !== 'ACTIVE' && input.status !== 'INACTIVE') {
    throw new Error('Choose a valid category status.');
  }
  return {
    ...normalizeCatalogCategoryName(input.name),
    type: input.type as CatalogItemType,
    status: (input.status || 'ACTIVE') as CatalogCategoryStatus,
  };
}
