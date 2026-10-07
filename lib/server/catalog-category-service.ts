import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/server/firebase-admin';
import { normalizeCatalogCategoryInput, normalizeCatalogCategoryName } from '@/lib/catalog-categories';
import { recordId, requireWorkspaceRecordAccess, WorkspaceRecordError } from './workspace-record-access';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const reservationId = (type: string, name: string) => hash(JSON.stringify([type, name]));

export async function saveCatalogCategory(orgId: string, uid: string, input: Record<string, unknown>, key: string, categoryId?: string) {
  if (!recordId(orgId) || (categoryId !== undefined && !recordId(categoryId))) throw new WorkspaceRecordError('Invalid category reference.');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new WorkspaceRecordError('A valid request key is required.');
  const allowed = categoryId ? ['name', 'status'] : ['name', 'type', 'status'];
  if (Object.keys(input).some(field => !allowed.includes(field)) || typeof input.name !== 'string'
    || (Object.hasOwn(input, 'status') && input.status !== 'ACTIVE' && input.status !== 'INACTIVE')) throw new WorkspaceRecordError('Invalid category details.');
  let normalized;
  try {
    normalized = categoryId
      ? { ...normalizeCatalogCategoryName(input.name), status: input.status }
      : normalizeCatalogCategoryInput(input as unknown as Parameters<typeof normalizeCatalogCategoryInput>[0]);
    if (normalized.status !== 'ACTIVE' && normalized.status !== 'INACTIVE') throw new Error('Choose a valid category status.');
  } catch (error) { throw new WorkspaceRecordError(error instanceof Error ? error.message : 'Invalid category details.'); }
  const requestHash = hash(JSON.stringify([categoryId || null, normalized]));
  const org = adminDb.doc(`organizations/${orgId}`);
  const operation = org.collection('catalogCategoryOperations').doc(hash(JSON.stringify([uid, key])));
  const ref = org.collection('catalogCategories').doc(categoryId || hash(JSON.stringify([uid, key, 'category'])));
  return adminDb.runTransaction(async transaction => {
    await requireWorkspaceRecordAccess(transaction, orgId, uid, 'mirror');
    const replay = await transaction.get(operation);
    if (replay.exists) {
      const data = replay.data() || {};
      if (data.requestHash !== requestHash || data.uid !== uid) throw new WorkspaceRecordError('This request key was used for different category details.', 409);
      return String(data.categoryId);
    }
    const existing = await transaction.get(ref);
    if (categoryId && !existing.exists) throw new WorkspaceRecordError('The category could not be found.', 404);
    const previous = existing.data() || {};
    const type = categoryId ? previous.type : (normalized as { type: string }).type;
    if (!['PRODUCT', 'SERVICE'].includes(type)) throw new WorkspaceRecordError('This category has an invalid type. Its existing record has been retained.', 409);
    const nextKey = reservationId(type, normalized.normalizedName);
    const nextRef = org.collection('catalogCategoryNames').doc(nextKey);
    const previousName = typeof previous.name === 'string' && previous.name.trim() ? normalizeCatalogCategoryName(previous.name).normalizedName : null;
    const oldKey = previousName ? reservationId(type, previousName) : null;
    const oldRef = oldKey && oldKey !== nextKey ? org.collection('catalogCategoryNames').doc(oldKey) : null;
    const [occupied, oldReservation, legacy] = await Promise.all([
      transaction.get(nextRef), oldRef ? transaction.get(oldRef) : Promise.resolve(null),
      // Historical browser writes could store an inconsistent normalizedName.
      // Scan the existing type using its actual name; never rewrite legacy rows.
      transaction.get(org.collection('catalogCategories').where('type', '==', type)),
    ]);
    const conflicting = legacy.docs.some(item => item.id !== ref.id && typeof item.data().name === 'string'
      && item.data().name.trim() && normalizeCatalogCategoryName(item.data().name).normalizedName === normalized.normalizedName);
    const unchangedName = categoryId && previousName === normalized.normalizedName;
    if (!unchangedName && (conflicting || (occupied.exists && occupied.data()?.categoryId !== ref.id))) {
      throw new WorkspaceRecordError(`A ${type === 'PRODUCT' ? 'Product' : 'Service'} category with this name already exists, including inactive categories. Choose a unique name.`, 409);
    }
    const now = Timestamp.now();
    if (!categoryId) transaction.create(ref, { ...normalized, createdBy: uid, createdAt: now, updatedBy: uid, updatedAt: now });
    else transaction.update(ref, { ...normalized, updatedBy: uid, updatedAt: now });
    // Unchanged legacy duplicates may still change status; never claim another
    // row's name reservation or release its historical category identity.
    if (!conflicting && (!occupied.exists || occupied.data()?.categoryId === ref.id)) transaction.set(nextRef, { categoryId: ref.id, type, normalizedName: normalized.normalizedName });
    if (oldRef && oldReservation?.data()?.categoryId === ref.id) transaction.delete(oldRef);
    transaction.create(operation, { uid, requestHash, categoryId: ref.id, createdAt: now });
    return ref.id;
  });
}
