import {
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { DealActivityType, DealTimelineEntry, DealTimelineEntryType } from '@/types';
import { canViewBusinessData } from '@/lib/permissions';
import { organizationSubcollection, organizationSubcollectionDocument } from '@/lib/organizations/paths';

export const DEAL_TIMELINE_PAGE_SIZE = 20;
export type DealTimelineCursor = QueryDocumentSnapshot<DocumentData> | null;

function requireActiveUser(user: AppUser | null) {
  if (!canViewBusinessData(user)) throw new Error('You do not have access to this deal timeline.');
}

function toIsoDate(value: unknown, fallback = new Date().toISOString()) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return typeof value === 'string' ? value : fallback;
}

function mapEntry(dealId: string, id: string, data: Record<string, unknown>): DealTimelineEntry {
  return {
    id,
    dealId,
    entryType: data.entryType as DealTimelineEntryType,
    activityType: typeof data.activityType === 'string' ? data.activityType as DealActivityType : undefined,
    content: typeof data.content === 'string' ? data.content : '',
    occurredAt: toIsoDate(data.occurredAt),
    createdAt: toIsoDate(data.createdAt),
    createdByUid: typeof data.createdByUid === 'string' ? data.createdByUid : '',
    createdByName: typeof data.createdByName === 'string' ? data.createdByName : 'Unknown user',
  };
}

function timelineCollection(organizationId: string, dealId: string) {
  return organizationSubcollection<DocumentData>(db, organizationId, 'deals', dealId, 'timeline');
}

export async function listDealTimeline(user: AppUser | null, organizationId: string, dealId: string, cursor: DealTimelineCursor = null) {
  requireActiveUser(user);
  try {
    const timelineQuery = cursor
      ? query(timelineCollection(organizationId, dealId), orderBy('occurredAt', 'desc'), startAfter(cursor), limit(DEAL_TIMELINE_PAGE_SIZE))
      : query(timelineCollection(organizationId, dealId), orderBy('occurredAt', 'desc'), limit(DEAL_TIMELINE_PAGE_SIZE));
    const snapshot = await getDocs(timelineQuery);
    return {
      entries: snapshot.docs.map((entryDoc) => mapEntry(dealId, entryDoc.id, entryDoc.data())),
      nextCursor: snapshot.docs.length === DEAL_TIMELINE_PAGE_SIZE ? snapshot.docs[snapshot.docs.length - 1] : null,
    };
  } catch (error) {
    console.error('Unable to load deal timeline', error);
    throw new Error('Unable to load deal activity and notes. Please try again.');
  }
}

export async function createDealTimelineEntry(
  user: AppUser | null,
  organizationId: string,
  dealId: string,
  input: { entryType: Exclude<DealTimelineEntryType, 'SYSTEM'>; activityType?: DealActivityType; content: string; occurredAt: Date },
) {
  requireActiveUser(user);
  if (!user) throw new Error('You must be signed in to add a timeline entry.');
  const content = input.content.trim();
  if (!content) throw new Error('Please enter a description or note.');
  try {
    const entryRef = doc(timelineCollection(organizationId, dealId));
    const data = {
      entryType: input.entryType,
      ...(input.activityType ? { activityType: input.activityType } : {}),
      content,
      occurredAt: Timestamp.fromDate(input.occurredAt),
      createdAt: serverTimestamp(),
      createdByUid: user.uid,
      createdByName: user.name,
    };
    await writeBatch(db).set(entryRef, data).commit();
    const now = new Date().toISOString();
    return mapEntry(dealId, entryRef.id, { ...data, occurredAt: input.occurredAt.toISOString(), createdAt: now });
  } catch (error) {
    console.error('Unable to create deal timeline entry', error);
    throw new Error('Unable to save the timeline entry. Please try again.');
  }
}

export function dealSystemTimelineRef(organizationId: string, dealId: string, event: string) {
  return organizationSubcollectionDocument(db, organizationId, 'deals', dealId, 'timeline', `system-${event}`);
}

export function dealSystemTimelineData(user: AppUser, content: string, occurredAt = serverTimestamp()) {
  return {
    entryType: 'SYSTEM' as const,
    content,
    occurredAt,
    createdAt: serverTimestamp(),
    createdByUid: user.uid,
    createdByName: user.name,
  };
}
