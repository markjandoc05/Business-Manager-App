import { addDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { Activity } from '@/types';
import { canViewBusinessData } from '@/lib/permissions';
import { organizationCollection } from '@/lib/organizations/paths';

export type ActivityInput = Pick<Activity, 'type' | 'description' | 'entityType' | 'entityId' | 'metadata'>;

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

function requireActiveUser(user: AppUser | null) {
  if (!canViewBusinessData(user)) throw new Error('You do not have access to activity history.');
}

export async function listActivities(user: AppUser | null, organizationId: string) {
  requireActiveUser(user);
  try {
    const snapshot = await getDocs(organizationCollection<Record<string, unknown>>(db, organizationId, 'activities'));
    return snapshot.docs.map((activityDoc) => mapActivity(activityDoc.id, activityDoc.data())).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (error) {
    console.error('Unable to load Firestore activities', error);
    throw new Error('Unable to load activity history. Please try again.');
  }
}

export async function createActivity(user: AppUser | null, organizationId: string, input: ActivityInput) {
  requireActiveUser(user);
  if (!user) throw new Error('You must be signed in to create an activity.');
  try {
    const activityRef = await addDoc(organizationCollection<Record<string, unknown>>(db, organizationId, 'activities'), {
      type: input.type,
      description: input.description,
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.entityId ? { entityId: input.entityId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });
    const now = new Date().toISOString();
    return mapActivity(activityRef.id, { ...input, createdAt: now, createdBy: user.uid });
  } catch (error) {
    console.error('Unable to create Firestore activity', error);
    throw new Error('Unable to save activity history. Please try again.');
  }
}
