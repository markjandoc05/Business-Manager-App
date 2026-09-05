import { getDocs, limit, orderBy, query, startAfter } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { Activity } from '@/types';
import { requireOrganizationAccess } from '@/lib/permissions';
import { organizationCollection } from '@/lib/organizations/paths';
import type { FirestoreCursor, PageResult } from '@/lib/repositories/pagination';
export { activityBelongsToClient } from '@/lib/activity-history';
import { activityBelongsToClient } from '@/lib/activity-history';

export const ACTIVITY_PAGE_SIZE = 25;

export type ActivityInput = Pick<Activity, 'type' | 'description' | 'entityType' | 'entityId' | 'metadata'> & {
};

function toIsoDate(value: unknown, fallback = new Date().toISOString()) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return typeof value === 'string' ? value : fallback;
}

function mapActivity(id: string, data: Record<string, unknown>): Activity {
  const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata as Record<string, unknown> : undefined;
  const createdAt = toIsoDate(data.createdAt);
  const meta = typeof metadata?.detail === 'string'
    ? metadata.detail
    : typeof metadata?.reason === 'string'
      ? `Reason: ${metadata.reason}`
      : undefined;
  return {
    id,
    type: typeof data.type === 'string' ? data.type as Activity['type'] : 'stage_change',
    description: typeof data.description === 'string' ? data.description : '',
    entityType: typeof data.entityType === 'string' ? data.entityType as Activity['entityType'] : undefined,
    entityId: typeof data.entityId === 'string' ? data.entityId : undefined,
    createdAt,
    timestamp: createdAt,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    metadata,
    meta,
  };
}

async function requireActiveUser(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
}

export async function listActivitiesPage(user: AppUser | null, organizationId: string, cursor: FirestoreCursor = null, pageSize = ACTIVITY_PAGE_SIZE): Promise<PageResult<Activity>> {
  await requireActiveUser(user, organizationId);
  try {
    const activitiesCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'activities');
    const activitiesQuery = cursor
      ? query(activitiesCollection, orderBy('createdAt', 'desc'), startAfter(cursor), limit(pageSize))
      : query(activitiesCollection, orderBy('createdAt', 'desc'), limit(pageSize));
    const snapshot = await getDocs(activitiesQuery);
    const items = snapshot.docs.map((activityDoc) => mapActivity(activityDoc.id, activityDoc.data()));
    return { items, nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null, hasMore: snapshot.docs.length === pageSize };
  } catch (error) {
    console.error('Unable to load Firestore activities', error);
    throw new Error('Unable to load activity history. Please try again.');
  }
}

export async function listActivities(user: AppUser | null, organizationId: string, pageSize = ACTIVITY_PAGE_SIZE) {
  return (await listActivitiesPage(user, organizationId, null, pageSize)).items;
}

export async function listActivitiesForClientPage(user: AppUser | null, organizationId: string, clientId: string, sourceLeadId?: string, cursor: FirestoreCursor = null, pageSize = ACTIVITY_PAGE_SIZE): Promise<PageResult<Activity>> {
  await requireActiveUser(user, organizationId);
  try {
    const activitiesCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'activities');
    const pageLimit = Math.max(1, Math.floor(pageSize));
    const matches: Activity[] = [];
    const matchingCursors: FirestoreCursor[] = [];
    let scanCursor = cursor;
    let lastRawCursor: FirestoreCursor = null;
    let exhausted = false;
    for (let page = 0; page < 20 && matches.length <= pageLimit; page += 1) {
      const activitiesQuery = query(activitiesCollection, orderBy('createdAt', 'desc'), ...(scanCursor ? [startAfter(scanCursor)] : []), limit(pageLimit));
      const snapshot = await getDocs(activitiesQuery);
      if (snapshot.empty) { exhausted = true; break; }
      lastRawCursor = snapshot.docs.at(-1) || null;
      for (const activityDoc of snapshot.docs) {
        const activity = mapActivity(activityDoc.id, activityDoc.data());
        if (activityBelongsToClient(activity, clientId, sourceLeadId)) {
          matches.push(activity);
          matchingCursors.push(activityDoc);
          if (matches.length > pageLimit) break;
        }
      }
      if (matches.length > pageLimit) break;
      if (snapshot.docs.length < pageLimit) { exhausted = true; break; }
      scanCursor = lastRawCursor;
    }
    const items = matches.slice(0, pageLimit);
    if (matches.length > pageLimit) return { items, nextCursor: matchingCursors[pageLimit - 1] || null, hasMore: true };
    if (exhausted) return { items, nextCursor: null, hasMore: false };
    return { items, nextCursor: matchingCursors[items.length - 1] || lastRawCursor, hasMore: true };
  } catch (error) {
    console.error('Unable to load Client activity history', error);
    throw new Error('Unable to load activity history. Please try again.');
  }
}

export async function listActivitiesForClient(user: AppUser | null, organizationId: string, clientId: string, sourceLeadId?: string) {
  return (await listActivitiesForClientPage(user, organizationId, clientId, sourceLeadId)).items;
}
