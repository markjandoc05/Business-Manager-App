import { getDoc, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { CatalogCategory, CatalogCategoryInput, CatalogCategoryStatus, CatalogItemType } from '@/types';
import { normalizeCatalogCategoryInput, normalizeCatalogCategoryName } from '@/lib/catalog-categories';
import { requireOrganizationAccess } from '@/lib/permissions';
import { organizationCollection, organizationDocumentInCollection } from '@/lib/organizations/paths';
import { authenticatedFetch } from '@/lib/repositories/authenticatedRequest';

function toIsoDate(value: unknown, fallback = new Date().toISOString()) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return typeof value === 'string' ? value : fallback;
}

function mapCatalogCategory(id: string, data: Record<string, unknown>): CatalogCategory {
  return {
    id,
    name: typeof data.name === 'string' ? data.name : '',
    normalizedName: typeof data.normalizedName === 'string' ? data.normalizedName : '',
    type: data.type === 'SERVICE' ? 'SERVICE' : 'PRODUCT',
    status: data.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    createdAt: toIsoDate(data.createdAt),
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
    updatedAt: toIsoDate(data.updatedAt),
  };
}

async function requireCatalogManager(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId, ['ADMIN', 'MANAGER']);
}

const pendingCategoryKeys = new Map<string, string>();
async function sendCategoryChange(user: AppUser, organizationId: string, body: object, categoryId?: string) {
  const identity = JSON.stringify([user.uid, organizationId, categoryId || null, body]);
  const key = pendingCategoryKeys.get(identity) || crypto.randomUUID();
  pendingCategoryKeys.set(identity, key);
  const endpoint = `/api/organizations/${encodeURIComponent(organizationId)}/catalog/categories${categoryId ? `/${encodeURIComponent(categoryId)}` : ''}`;
  const response = await authenticatedFetch(endpoint, { method: categoryId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null) as { error?: string; categoryId?: string } | null;
  if (!response.ok || !payload?.categoryId) throw new Error(payload?.error || 'The category change could not be confirmed. Retry the same details.');
  return { id: payload.categoryId, confirm: () => pendingCategoryKeys.delete(identity) };
}

export async function listCatalogCategories(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
  const categories = organizationCollection<Record<string, unknown>>(db, organizationId, 'catalogCategories');
  const snapshot = await getDocs(query(categories, orderBy('name', 'asc')));
  const rows = snapshot.docs.map((category) => mapCatalogCategory(category.id, category.data()));
  const keys = rows.map(row => JSON.stringify([row.type, row.name.trim() ? normalizeCatalogCategoryName(row.name).normalizedName : row.normalizedName]));
  const counts = new Map<string, number>();
  keys.forEach(key => counts.set(key, (counts.get(key) || 0) + 1));
  return rows.map((row, index) => ({ ...row, nameConflict: (counts.get(keys[index]) || 0) > 1 }));
}

export async function createCatalogCategory(user: AppUser | null, organizationId: string, input: CatalogCategoryInput) {
  await requireCatalogManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to create a category.');
  const normalized = normalizeCatalogCategoryInput(input);
  const result = await sendCategoryChange(user, organizationId, { name: normalized.name, type: normalized.type, status: normalized.status });
  const snapshot = await getDoc(organizationDocumentInCollection(db, organizationId, 'catalogCategories', result.id));
  if (!snapshot.exists()) throw new Error('The saved category could not be loaded. Retry the same details.');
  result.confirm();
  return mapCatalogCategory(result.id, snapshot.data());
}

export async function updateCatalogCategory(user: AppUser | null, organizationId: string, categoryId: string, input: { name: string; status: CatalogCategoryStatus }) {
  await requireCatalogManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to update a category.');
  const categoryRef = organizationDocumentInCollection(db, organizationId, 'catalogCategories', categoryId);
  const existing = await getDoc(categoryRef);
  if (!existing.exists()) throw new Error('The category could not be found.');
  const existingData = existing.data();
  const type: CatalogItemType = existingData.type === 'SERVICE' ? 'SERVICE' : 'PRODUCT';
  const { name } = normalizeCatalogCategoryName(input.name);
  if (input.status !== 'ACTIVE' && input.status !== 'INACTIVE') throw new Error('Choose a valid category status.');
  if (!['PRODUCT', 'SERVICE'].includes(type)) throw new Error('Choose a valid category type.');
  const result = await sendCategoryChange(user, organizationId, { name, status: input.status }, categoryId);
  result.confirm();
}
