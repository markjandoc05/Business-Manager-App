import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  serverTimestamp,
  startAfter,
  Timestamp,
  updateDoc,
  writeBatch,
  type QueryDocumentSnapshot,
  type DocumentData,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { LeadActivityStatus, LeadActivityType, LeadTimelineEntry, LeadTimelineEntryType } from '@/types';
import { requireOrganizationAccess } from '@/lib/permissions';
import { organizationSubcollection, organizationSubcollectionDocument } from '@/lib/organizations/paths';

export const LEAD_TIMELINE_PAGE_SIZE = 20;

export type LeadTimelineCursor = QueryDocumentSnapshot<DocumentData> | null;

async function requireActiveUser(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
}

function toIsoDate(value: unknown, fallback = new Date().toISOString()) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return typeof value === 'string' ? value : fallback;
}

function mapEntry(leadId: string, id: string, data: Record<string, unknown>): LeadTimelineEntry {
  const activityStatus = data.activityStatus === 'SCHEDULED' || data.activityStatus === 'COMPLETED'
    ? data.activityStatus as LeadActivityStatus
    : undefined;
  return {
    id,
    leadId,
    entryType: data.entryType as LeadTimelineEntryType,
    activityType: typeof data.activityType === 'string' ? data.activityType as LeadActivityType : undefined,
    activityStatus: data.entryType === 'ACTIVITY' ? activityStatus : undefined,
    content: typeof data.content === 'string' ? data.content : '',
    occurredAt: toIsoDate(data.occurredAt),
    createdAt: toIsoDate(data.createdAt),
    createdByUid: typeof data.createdByUid === 'string' ? data.createdByUid : '',
    createdByName: typeof data.createdByName === 'string' ? data.createdByName : 'Unknown user',
  };
}

function timelineCollection(organizationId: string, leadId: string) {
  return organizationSubcollection<DocumentData>(db, organizationId, 'leads', leadId, 'timeline');
}

export async function listLeadTimeline(user: AppUser | null, organizationId: string, leadId: string, cursor: LeadTimelineCursor = null) {
  await requireActiveUser(user, organizationId);
  try {
    const timelineQuery = cursor
      ? query(timelineCollection(organizationId, leadId), orderBy('occurredAt', 'desc'), startAfter(cursor), limit(LEAD_TIMELINE_PAGE_SIZE))
      : query(timelineCollection(organizationId, leadId), orderBy('occurredAt', 'desc'), limit(LEAD_TIMELINE_PAGE_SIZE));
    const snapshot = await getDocs(timelineQuery);
    return {
      entries: snapshot.docs.map((entryDoc) => mapEntry(leadId, entryDoc.id, entryDoc.data())),
      nextCursor: snapshot.docs.length === LEAD_TIMELINE_PAGE_SIZE ? snapshot.docs[snapshot.docs.length - 1] : null,
    };
  } catch (error) {
    console.error('Unable to load lead timeline', error);
    throw new Error('Unable to load lead activity and notes. Please try again.');
  }
}

export async function listScheduledLeadActivities(user: AppUser | null, organizationId: string, leadId: string) {
  await requireActiveUser(user, organizationId);
  try {
    const snapshot = await getDocs(query(
      timelineCollection(organizationId, leadId),
      where('activityStatus', '==', 'SCHEDULED'),
    ));
    return snapshot.docs
      .map((entryDoc) => mapEntry(leadId, entryDoc.id, entryDoc.data()))
      .filter((entry) => entry.entryType === 'ACTIVITY' && entry.activityStatus === 'SCHEDULED');
  } catch (error) {
    console.error('Unable to load scheduled lead activities', error);
    throw new Error('Unable to load scheduled lead activities. Please try again.');
  }
}

export async function createLeadTimelineEntry(
  user: AppUser | null,
  organizationId: string,
  leadId: string,
  input: { entryType: Exclude<LeadTimelineEntryType, 'SYSTEM'>; activityType?: LeadActivityType; content: string; occurredAt: Date },
) {
  await requireActiveUser(user, organizationId);
  if (!user) throw new Error('You must be signed in to add a timeline entry.');
  const content = input.content.trim();
  if (!content) throw new Error('Please enter a description or note.');
  if (Number.isNaN(input.occurredAt.getTime())) throw new Error('Please select a valid date and time.');

  try {
    const entryRef = doc(timelineCollection(organizationId, leadId));
    const activityStatus = input.entryType === 'ACTIVITY'
      ? (input.occurredAt.getTime() > Date.now() ? 'SCHEDULED' : 'COMPLETED')
      : undefined;
    const data = {
      entryType: input.entryType,
      ...(input.activityType ? { activityType: input.activityType } : {}),
      ...(activityStatus ? { activityStatus } : {}),
      content,
      occurredAt: Timestamp.fromDate(input.occurredAt),
      createdAt: serverTimestamp(),
      createdByUid: user.uid,
      createdByName: user.name,
    };
    await writeBatch(db).set(entryRef, data).commit();
    const now = new Date().toISOString();
    return mapEntry(leadId, entryRef.id, { ...data, createdAt: now, occurredAt: input.occurredAt.toISOString() });
  } catch (error) {
    console.error('Unable to create lead timeline entry', error);
    throw new Error('Unable to save the timeline entry. Please try again.');
  }
}

export async function completeLeadTimelineActivity(
  user: AppUser | null,
  organizationId: string,
  leadId: string,
  entryId: string,
) {
  await requireActiveUser(user, organizationId);
  const entryRef = organizationSubcollectionDocument(db, organizationId, 'leads', leadId, 'timeline', entryId);
  try {
    const snapshot = await getDoc(entryRef);
    if (!snapshot.exists()) throw new Error('The timeline activity could not be found.');
    const data = snapshot.data() as Record<string, unknown>;
    if (data.entryType !== 'ACTIVITY') throw new Error('Only activities can be marked complete.');
    if (data.activityStatus === 'COMPLETED') return mapEntry(leadId, entryId, data);
    if (data.activityStatus !== 'SCHEDULED') throw new Error('This activity is not scheduled.');
    await updateDoc(entryRef, { activityStatus: 'COMPLETED' });
    return mapEntry(leadId, entryId, { ...data, activityStatus: 'COMPLETED' });
  } catch (error) {
    if (error instanceof Error && error.message !== 'The timeline activity could not be found.' && error.message !== 'Only activities can be marked complete.' && error.message !== 'This activity is not scheduled.') {
      const firebaseError = error as { code?: string; message?: string };
      console.error('Unable to complete lead timeline activity', {
        code: firebaseError.code || 'unknown',
        message: firebaseError.message || error.message,
        path: entryRef.path,
      });
      throw new Error('Unable to mark the activity complete. Please try again.');
    }
    throw error;
  }
}

export function systemTimelineRef(organizationId: string, leadId: string, event: 'created' | 'lost' | 'converted') {
  return organizationSubcollectionDocument(db, organizationId, 'leads', leadId, 'timeline', `system-${event}`);
}

export function systemTimelineData(user: AppUser, content: string, occurredAt = serverTimestamp()) {
  return {
    entryType: 'SYSTEM' as const,
    content,
    occurredAt,
    createdAt: serverTimestamp(),
    createdByUid: user.uid,
    createdByName: user.name,
  };
}
