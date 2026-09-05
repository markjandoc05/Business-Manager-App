import { deleteField, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, startAfter, updateDoc, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { CatalogItem, CatalogItemInput, CatalogItemStatus, CatalogItemType } from '@/types';
import { getEffectiveCatalogPrice, getSelectableCatalogItems, normalizeCatalogItemInput } from '@/lib/catalog-items';
import { requireOrganizationAccess } from '@/lib/permissions';
import { organizationCollection, organizationDocumentInCollection } from '@/lib/organizations/paths';
import type { FirestoreCursor, PageResult } from '@/lib/repositories/pagination';

export const CATALOG_ITEM_PAGE_SIZE = 25;

function toIsoDate(value: unknown, fallback = new Date().toISOString()) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return typeof value === 'string' ? value : fallback;
}

function optionalIsoDate(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return typeof value === 'string' ? value : undefined;
}

function mapCatalogItem(id: string, data: Record<string, unknown>): CatalogItem {
  const type: CatalogItemType = data.type === 'SERVICE' ? 'SERVICE' : 'PRODUCT';
  const status: CatalogItemStatus = data.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
  const regularPrice = typeof data.regularPrice === 'number' && Number.isFinite(data.regularPrice) && data.regularPrice >= 0
    ? data.regularPrice
    : typeof data.standardPrice === 'number' && Number.isFinite(data.standardPrice) && data.standardPrice >= 0
      ? data.standardPrice
    : 0;
  const salePrice = typeof data.salePrice === 'number' && Number.isFinite(data.salePrice) && data.salePrice >= 0 && data.salePrice <= regularPrice
    ? data.salePrice
    : undefined;
  return {
    id,
    type,
    name: typeof data.name === 'string' ? data.name : '',
    code: typeof data.code === 'string' ? data.code : undefined,
    categoryId: typeof data.categoryId === 'string' ? data.categoryId : undefined,
    category: typeof data.category === 'string' ? data.category : undefined,
    unit: typeof data.unit === 'string' ? data.unit : undefined,
    description: typeof data.description === 'string' ? data.description : undefined,
    regularPrice,
    salePrice,
    effectivePrice: getEffectiveCatalogPrice(regularPrice, salePrice),
    status,
    archived: data.archived === true,
    archivedAt: optionalIsoDate(data.archivedAt),
    archivedBy: typeof data.archivedBy === 'string' ? data.archivedBy : undefined,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : '',
    createdAt: toIsoDate(data.createdAt),
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : '',
    updatedAt: toIsoDate(data.updatedAt),
  };
}

function legacyCatalogPriceMigration(data: Record<string, unknown>) {
  const migration: Record<string, unknown> = {};
  const hasRegularPrice = typeof data.regularPrice === 'number' && Number.isFinite(data.regularPrice) && data.regularPrice >= 0;
  if (!hasRegularPrice) {
    migration.regularPrice = typeof data.standardPrice === 'number' && Number.isFinite(data.standardPrice) && data.standardPrice >= 0
      ? data.standardPrice
      : 0;
  }
  if (!Object.hasOwn(data, 'salePrice')) migration.salePrice = null;
  if (Object.hasOwn(data, 'standardPrice')) migration.standardPrice = deleteField();
  return migration;
}

async function requireCatalogManager(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId, ['ADMIN', 'MANAGER']);
}

export async function listCatalogItemsPage(
  user: AppUser | null,
  organizationId: string,
  archived = false,
  cursor: FirestoreCursor = null,
  pageSize = CATALOG_ITEM_PAGE_SIZE,
): Promise<PageResult<CatalogItem>> {
  await requireOrganizationAccess(user, organizationId);
  const itemsCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'catalogItems');
  const constraints = [where('archived', '==', archived), orderBy('createdAt', 'desc')];
  const itemsQuery = cursor
    ? query(itemsCollection, ...constraints, startAfter(cursor), limit(pageSize))
    : query(itemsCollection, ...constraints, limit(pageSize));
  const snapshot = await getDocs(itemsQuery);
  const items = snapshot.docs
    .map((itemDoc) => mapCatalogItem(itemDoc.id, itemDoc.data()))
    .filter((item) => item.archived === archived);
  return {
    items,
    nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null,
    hasMore: snapshot.docs.length === pageSize,
  };
}

export async function listSelectableCatalogItems(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
  const itemsCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'catalogItems');
  const snapshot = await getDocs(query(itemsCollection, where('archived', '==', false), orderBy('createdAt', 'desc')));
  return getSelectableCatalogItems(snapshot.docs.map((itemDoc) => mapCatalogItem(itemDoc.id, itemDoc.data())));
}

export async function getCatalogItemById(user: AppUser | null, organizationId: string, itemId: string) {
  await requireOrganizationAccess(user, organizationId);
  const snapshot = await getDoc(organizationDocumentInCollection(db, organizationId, 'catalogItems', itemId));
  if (!snapshot.exists()) throw new Error('The catalog item could not be found.');
  return mapCatalogItem(snapshot.id, snapshot.data());
}

export async function createCatalogItem(user: AppUser | null, organizationId: string, input: CatalogItemInput) {
  await requireCatalogManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to create a catalog item.');
  const normalized = normalizeCatalogItemInput(input);
  const itemRef = doc(organizationCollection<Record<string, unknown>>(db, organizationId, 'catalogItems'));
  const now = serverTimestamp();
  await setDoc(itemRef, {
    ...normalized,
    archived: false,
    archivedAt: null,
    archivedBy: null,
    createdBy: user.uid,
    createdAt: now,
    updatedBy: user.uid,
    updatedAt: now,
  });
  return mapCatalogItem(itemRef.id, {
    ...normalized,
    archived: false,
    createdBy: user.uid,
    createdAt: new Date().toISOString(),
    updatedBy: user.uid,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateCatalogItem(user: AppUser | null, organizationId: string, itemId: string, input: CatalogItemInput) {
  await requireCatalogManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to update a catalog item.');
  const normalized = normalizeCatalogItemInput(input);
  const itemRef = organizationDocumentInCollection(db, organizationId, 'catalogItems', itemId);
  const existing = await getDoc(itemRef);
  if (!existing.exists()) throw new Error('The catalog item could not be found.');
  const existingData = existing.data();
  await updateDoc(itemRef, {
    ...legacyCatalogPriceMigration(existingData),
    ...normalized,
    archived: existingData.archived === true,
    archivedAt: existingData.archivedAt || null,
    archivedBy: existingData.archivedBy || null,
    updatedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
}

export async function archiveCatalogItem(user: AppUser | null, organizationId: string, itemId: string) {
  await requireCatalogManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to archive a catalog item.');
  const itemRef = organizationDocumentInCollection(db, organizationId, 'catalogItems', itemId);
  const existing = await getDoc(itemRef);
  if (!existing.exists()) throw new Error('The catalog item could not be found.');
  await updateDoc(itemRef, {
    ...legacyCatalogPriceMigration(existing.data()),
    archived: true,
    archivedAt: serverTimestamp(),
    archivedBy: user.uid,
    updatedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
}

export async function restoreCatalogItem(user: AppUser | null, organizationId: string, itemId: string) {
  await requireCatalogManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to restore a catalog item.');
  const itemRef = organizationDocumentInCollection(db, organizationId, 'catalogItems', itemId);
  const existing = await getDoc(itemRef);
  if (!existing.exists()) throw new Error('The catalog item could not be found.');
  await updateDoc(itemRef, {
    ...legacyCatalogPriceMigration(existing.data()),
    archived: false,
    archivedAt: null,
    archivedBy: null,
    updatedBy: user.uid,
    updatedAt: serverTimestamp(),
  });
}
