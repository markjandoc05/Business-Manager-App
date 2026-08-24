import { collection, doc, serverTimestamp, type DocumentReference, type WriteBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { ActivityInput } from '@/lib/repositories/activities';
import { organizationCollection } from '@/lib/organizations/paths';

/** Builds a deterministic, repository-owned activity payload for a coupled mutation. */
export function activityData(user: AppUser, input: ActivityInput) {
  return {
    type: input.type,
    description: input.description,
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    createdAt: serverTimestamp(),
    createdBy: user.uid,
  };
}

export function activityRef(organizationId: string): DocumentReference<Record<string, unknown>> {
  return doc(organizationCollection<Record<string, unknown>>(db, organizationId, 'activities'));
}

export function addActivityToBatch(batch: WriteBatch, organizationId: string, user: AppUser, input: ActivityInput) {
  const ref = activityRef(organizationId);
  batch.set(ref, activityData(user, input));
  return ref;
}
