import { doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { CatalogCategory, CatalogCategoryInput, CatalogCategoryStatus, CatalogItemType } from '@/types';
import { normalizeCatalogCategoryInput, normalizeCatalogCategoryName } from '@/lib/catalog-categories';
import { requireOrganizationAccess } from '@/lib/permissions';
import { organizationCollection, organizationDocumentInCollection } from '@/lib/organizations/paths';

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

async function assertNoDuplicateCategory(organizationId: string, type: CatalogItemType, normalizedName: string, exceptId?: string) {
  const categories = organizationCollection<Record<string, unknown>>(db, organizationId, 'catalogCategories');
  const snapshot = await getDocs(query(categories, where('type', '==', type), where('normalizedName', '==', normalizedName), limit(2)));
  if (snapshot.docs.some((category) => category.id !== exceptId)) {
    throw new Error(`A ${type === 'PRODUCT' ? 'Product' : 'Service'} category with this name already exists.`);
  }
}

export async function listCatalogCategories(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
  const categories = organizationCollection<Record<string, unknown>>(db, organizationId, 'catalogCategories');
  const snapshot = await getDocs(query(categories, orderBy('name', 'asc')));
  return snapshot.docs.map((category) => mapCatalogCategory(category.id, category.data()));
}

export async function createCatalogCategory(user: AppUser | null, organizationId: string, input: CatalogCategoryInput) {
  await requireCatalogManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to create a category.');
  const normalized = normalizeCatalogCategoryInput(input);
  await assertNoDuplicateCategory(organizationId, normalized.type, normalized.normalizedName);
  const categoryRef = doc(organizationCollection<Record<string, unknown>>(db, organizationId, 'catalogCategories'));
  const now = serverTimestamp();
  await setDoc(categoryRef, { ...normalized, createdBy: user.uid, createdAt: now, updatedBy: user.uid, updatedAt: now });
  return mapCatalogCategory(categoryRef.id, { ...normalized, createdBy: user.uid, createdAt: new Date().toISOString(), updatedBy: user.uid, updatedAt: new Date().toISOString() });
}

export async function updateCatalogCategory(user: AppUser | null, organizationId: string, categoryId: string, input: { name: string; status: CatalogCategoryStatus }) {
  await requireCatalogManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to update a category.');
  const categoryRef = organizationDocumentInCollection(db, organizationId, 'catalogCategories', categoryId);
  const existing = await getDoc(categoryRef);
  if (!existing.exists()) throw new Error('The category could not be found.');
  const existingData = existing.data();
  const type: CatalogItemType = existingData.type === 'SERVICE' ? 'SERVICE' : 'PRODUCT';
  const { name, normalizedName } = normalizeCatalogCategoryName(input.name);
  if (input.status !== 'ACTIVE' && input.status !== 'INACTIVE') throw new Error('Choose a valid category status.');
  await assertNoDuplicateCategory(organizationId, type, normalizedName, categoryId);
  await updateDoc(categoryRef, { name, normalizedName, status: input.status, updatedBy: user.uid, updatedAt: serverTimestamp() });
}
