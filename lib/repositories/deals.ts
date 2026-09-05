import { count, deleteDoc, doc, getAggregateFromServer, getDoc, getDocs, limit, orderBy, query, serverTimestamp, startAfter, sum, where, writeBatch, type DocumentData } from 'firebase/firestore';
import type { FirestoreCursor, PageResult } from '@/lib/repositories/pagination';
import { firestoreQueryErrorMessage } from '@/lib/repositories/pagination';
import { db } from '@/lib/firebase/client';
import type { AppUser, OrganizationMembership } from '@/types/auth';
import type { Deal } from '@/types';
import { requireOrganizationAccess } from '@/lib/permissions';
import { DEAL_ACTIVE_STAGES, getDealStatusForStage } from '@/lib/deal-workflow';
import { getDealValue, normalizeDealLineItems, readDealLineItems } from '@/lib/deal-items';
import { resolveAssignment } from '@/lib/ownership';
import { dealSystemTimelineData, dealSystemTimelineRef } from '@/lib/repositories/dealTimeline';
import { addActivityToBatch } from '@/lib/repositories/activityEvents';
import { organizationCollection, organizationDocumentInCollection } from '@/lib/organizations/paths';
import { incrementStartupCounter } from '@/lib/startupTiming';

export const PIPELINE_DEAL_LIMIT = 100;
export const DEAL_PAGE_SIZE = 25;

export type DealStatus = 'Active' | 'Won' | 'Lost';
export type DealInput = Pick<Deal, 'title' | 'clientId' | 'leadId' | 'value' | 'stage' | 'expectedCloseDate' | 'productServiceName' | 'notes' | 'assignedToUid' | 'assignedToName' | 'lossReason' | 'items'>;

function reportFirestoreFailure(operation: string, error: unknown, details?: Record<string, unknown>) {
  const firebaseError = error as { code?: string; message?: string };
  console.error(`[Firestore] deals:${operation} failed code=${firebaseError.code || 'unknown'} message=${firebaseError.message || 'unknown error'}`, details || {});
}

function toIsoDate(value: unknown, fallback = new Date().toISOString()) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return typeof value === 'string' ? value : fallback;
}

function toOptionalIsoDate(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return typeof value === 'string' ? value : undefined;
}

function mapDeal(id: string, data: Record<string, unknown>): Deal {
  const status = data.status === 'Won' || data.status === 'Lost' ? data.status : 'Active';
  const items = readDealLineItems(data.items);
  return {
    id,
    title: typeof data.title === 'string' ? data.title : '',
    clientId: typeof data.clientId === 'string' ? data.clientId : '',
    leadId: typeof data.leadId === 'string' ? data.leadId : undefined,
    value: typeof data.value === 'number' ? data.value : 0,
    stage: typeof data.stage === 'string' ? data.stage : 'New',
    status,
    wonAt: toOptionalIsoDate(data.wonAt),
    lostAt: toOptionalIsoDate(data.lostAt),
    expectedCloseDate: typeof data.expectedCloseDate === 'string' ? data.expectedCloseDate : '',
    productServiceName: typeof data.productServiceName === 'string' ? data.productServiceName : undefined,
    notes: typeof data.notes === 'string' ? data.notes : undefined,
    assignedToUid: typeof data.assignedToUid === 'string' ? data.assignedToUid : '',
    assignedToName: typeof data.assignedToName === 'string' ? data.assignedToName : typeof data.assignedTo === 'string' ? data.assignedTo : '',
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo : undefined,
    lossReason: typeof data.lossReason === 'string' ? data.lossReason : undefined,
    archived: data.archived === true,
    createdAt: toIsoDate(data.createdAt),
    updatedAt: toIsoDate(data.updatedAt),
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
    archivedAt: toIsoDate(data.archivedAt, ''),
    archivedBy: typeof data.archivedBy === 'string' ? data.archivedBy : undefined,
    ...(items !== undefined ? { items } : {}),
  };
}

async function requireActiveUser(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
}

async function requireDealManager(user: AppUser | null, organizationId: string, deal?: Deal): Promise<OrganizationMembership> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  if (['ADMIN', 'MANAGER'].includes(membership.role)) return membership;
  if (membership.role === 'USER' && deal?.assignedToUid === user?.uid) return membership;
  throw new Error('You do not have permission to manage this deal.');
}

function validateDealState(stage: string, status: DealStatus, lossReason?: string) {
  if (status === 'Active' && !DEAL_ACTIVE_STAGES.includes(stage as typeof DEAL_ACTIVE_STAGES[number])) throw new Error('Active deals must use New, Qualified, Proposal, or Negotiation stages.');
  if (status === 'Won' && stage !== 'Won') throw new Error('Won deals must be in the Won stage.');
  if (status === 'Lost' && (stage !== 'Lost' || !lossReason?.trim())) throw new Error('Lost deals require a loss reason and Lost stage.');
  if (status === 'Active' && (stage === 'Won' || stage === 'Lost')) throw new Error('Active deals cannot be in Won or Lost stages.');
}

async function requireExistingClient(organizationId: string, clientId: string) {
  const clientSnapshot = await getDoc(organizationDocumentInCollection(db, organizationId, 'clients', clientId));
  if (!clientSnapshot.exists() || clientSnapshot.data().status === 'ARCHIVED') throw new Error('The selected client is not available.');
}

export async function getDealById(user: AppUser | null, organizationId: string, dealId: string) {
  await requireOrganizationAccess(user, organizationId);
  const snapshot = await getDoc(organizationDocumentInCollection(db, organizationId, 'deals', dealId));
  if (!snapshot.exists()) throw new Error('The deal was not found.');
  return mapDeal(snapshot.id, snapshot.data());
}

type DealDisplay = Pick<Deal, 'title' | 'value'>;
type DealCacheEntry = { deal: DealDisplay; cachedAt: number };
const DEAL_DISPLAY_CACHE_LIMIT = 50;
const dealDisplayCache = new Map<string, DealCacheEntry>();
const dealDisplayRequests = new Map<string, Promise<DealDisplay>>();

function dealCacheKey(organizationId: string, dealId: string) { return `${organizationId}:${dealId}`; }

/** Returns a previously loaded display snapshot without performing a read. */
export function getCachedDealDisplay(organizationId: string, dealId: string): DealDisplay | null {
  return dealDisplayCache.get(dealCacheKey(organizationId, dealId))?.deal || null;
}

/** Loads current Deal data while sharing simultaneous requests for the same organization/Deal. */
export function refreshDealDisplay(user: AppUser | null, organizationId: string, dealId: string): Promise<DealDisplay> {
  const key = dealCacheKey(organizationId, dealId);
  const inFlight = dealDisplayRequests.get(key);
  if (inFlight) return inFlight;
  const request = getDealById(user, organizationId, dealId).then((deal) => {
    if (dealDisplayCache.size >= DEAL_DISPLAY_CACHE_LIMIT && !dealDisplayCache.has(key)) {
      const oldestKey = [...dealDisplayCache.entries()].sort((left, right) => left[1].cachedAt - right[1].cachedAt)[0]?.[0];
      if (oldestKey) dealDisplayCache.delete(oldestKey);
    }
    const display = { title: deal.title, value: deal.value };
    dealDisplayCache.set(key, { deal: display, cachedAt: Date.now() });
    return display;
  }).finally(() => { dealDisplayRequests.delete(key); });
  dealDisplayRequests.set(key, request);
  return request;
}

export async function listDeals(user: AppUser | null, organizationId: string, pageSize = PIPELINE_DEAL_LIMIT) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  try {
    const constraints = [where('archived', '==', false), ...(membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : []), orderBy('createdAt', 'desc'), limit(pageSize)] as const;
    const snapshot = await getDocs(query(organizationCollection<Record<string, unknown>>(db, organizationId, 'deals'), ...constraints));
    return snapshot.docs.map((dealDoc) => mapDeal(dealDoc.id, dealDoc.data())).filter((deal) => !deal.archived).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (error) {
    reportFirestoreFailure('list', error);
    throw new Error(firestoreQueryErrorMessage(error, 'Unable to load deals. Please try again.'));
  }
}

export type PipelineStageSummary = Record<string, { count: number; value: number }>;

// Pipeline summaries are authoritative and intentionally not persisted in a
// cache. Sharing only the currently running request prevents simultaneous
// Dashboard/focus refreshes from issuing duplicate aggregate batches while
// preserving a fresh read for every later refresh.
const pipelineSummaryRequests = new Map<string, Promise<PipelineStageSummary>>();

function pipelineSummaryRequestKey(user: AppUser | null, organizationId: string) {
  return `${user?.uid || 'anonymous'}:${organizationId}`;
}

async function loadPipelineStageSummaries(user: AppUser | null, organizationId: string): Promise<PipelineStageSummary> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const dealsCollection = organizationCollection<DocumentData>(db, organizationId, 'deals');
  const assigned = membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : [];
  const stages = [...DEAL_ACTIVE_STAGES, 'Won', 'Lost'] as const;
  const summaries = await Promise.all(stages.map(async (stage) => {
    incrementStartupCounter('dashboard-pipeline-aggregate-queries');
    const snapshot = await getAggregateFromServer(
      query(dealsCollection, where('archived', '==', false), ...assigned, where('stage', '==', stage)),
      { count: count(), value: sum('value') },
    );
    const data = snapshot.data();
    return [stage, { count: data.count, value: data.value || 0 }] as const;
  }));
  return Object.fromEntries(summaries);
}

/**
 * Loads authoritative, organization-scoped Pipeline totals without relying on
 * the paginated Deal list used to render the board cards.
 */
export async function getPipelineStageSummaries(user: AppUser | null, organizationId: string): Promise<PipelineStageSummary> {
  const key = pipelineSummaryRequestKey(user, organizationId);
  const pending = pipelineSummaryRequests.get(key);
  if (pending) return pending;
  const request = loadPipelineStageSummaries(user, organizationId).finally(() => {
    if (pipelineSummaryRequests.get(key) === request) pipelineSummaryRequests.delete(key);
  });
  pipelineSummaryRequests.set(key, request);
  return request;
}

/**
 * Drops only in-flight sharing state after a known Deal mutation. The next
 * Dashboard refresh therefore cannot reuse a query that began before the
 * mutation committed.
 */
export function invalidatePipelineStageSummaryRequests(organizationId?: string) {
  for (const key of pipelineSummaryRequests.keys()) {
    if (!organizationId || key.endsWith(`:${organizationId}`)) pipelineSummaryRequests.delete(key);
  }
}

export async function createDeal(user: AppUser | null, organizationId: string, input: DealInput) {
  const membership = await requireDealManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to create a deal.');
  const items = input.items === undefined ? undefined : normalizeDealLineItems(input.items);
  const value = getDealValue(input.value, items);
  const productServiceName = input.productServiceName?.trim() || undefined;
  const nextStatus = getDealStatusForStage(input.stage);
  const nextLossReason = nextStatus === 'Lost' ? input.lossReason?.trim() : undefined;
  if (!input.title.trim() || !input.clientId) throw new Error('Deal details are incomplete.');
  validateDealState(input.stage, nextStatus, nextLossReason);
  try {
    await requireExistingClient(organizationId, input.clientId);
  } catch (error) {
    reportFirestoreFailure('create-client-check', error);
    throw error;
  }

  const assignment = await resolveAssignment(user, organizationId, input.assignedToUid, input.assignedToName, membership);
  let dealRef;
  let dealPath = '';
  let timelinePath = '';
  let payloadKeys: string[] = [];
  try {
    dealRef = doc(organizationCollection<Record<string, unknown>>(db, organizationId, 'deals'));
    const dealData = {
      title: input.title.trim(),
      clientId: input.clientId,
      leadId: input.leadId || null,
      value,
      stage: input.stage,
      expectedCloseDate: input.expectedCloseDate || '',
      ...(productServiceName !== undefined ? { productServiceName } : {}),
      ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
      ...(items !== undefined ? { items } : {}),
      ...assignment,
      status: nextStatus,
      wonAt: nextStatus === 'Won' ? serverTimestamp() : null,
      lostAt: nextStatus === 'Lost' ? serverTimestamp() : null,
      lossReason: nextLossReason || null,
      archived: false,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    };
    dealPath = dealRef.path;
    timelinePath = dealSystemTimelineRef(organizationId, dealRef.id, 'system-created').path;
    payloadKeys = Object.keys(dealData);
    const batch = writeBatch(db);
    batch.set(dealRef, dealData);
    batch.set(dealSystemTimelineRef(organizationId, dealRef.id, 'system-created'), dealSystemTimelineData(user, 'Deal created.'));
    addActivityToBatch(batch, organizationId, user, { type: 'deal_creation', description: `New deal created: ${input.title}`, entityType: 'Deal', entityId: dealRef.id, metadata: { clientId: input.clientId, dealId: dealRef.id } });
    await batch.commit();
  } catch (error) {
    reportFirestoreFailure('create', error, {
      organizationId,
      dealPath,
      timelinePath,
      payloadKeys,
    });
    throw error;
  }
  return mapDeal(dealRef.id, { title: input.title.trim(), clientId: input.clientId, leadId: input.leadId || null, value, stage: input.stage, expectedCloseDate: input.expectedCloseDate || '', ...(productServiceName !== undefined ? { productServiceName } : {}), ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}), ...(items !== undefined ? { items } : {}), ...assignment, status: nextStatus, wonAt: nextStatus === 'Won' ? new Date().toISOString() : null, lostAt: nextStatus === 'Lost' ? new Date().toISOString() : null, lossReason: nextLossReason || undefined, archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: user.uid, updatedBy: user.uid });
}

export async function updateDeal(user: AppUser | null, organizationId: string, deal: Deal, input: DealInput) {
  await requireDealManager(user, organizationId, deal);
  if (!user) throw new Error('You must be signed in to update a deal.');
  if (deal.clientId !== input.clientId || deal.leadId !== (input.leadId || undefined)) throw new Error('Client and lead relationships cannot be changed from Deal editing.');
  if (deal.status !== 'Active' && input.stage !== deal.stage && getDealStatusForStage(input.stage) !== 'Active') {
    throw new Error('Won and Lost deals can only be reopened into an active stage.');
  }
  const items = input.items === undefined ? undefined : normalizeDealLineItems(input.items);
  const value = getDealValue(input.value, items);
  const productServiceName = input.productServiceName?.trim() || undefined;
  if (!input.title.trim()) throw new Error('Deal details are incomplete.');
  const nextStatus = getDealStatusForStage(input.stage);
  const nextLossReason = nextStatus === 'Lost' ? input.lossReason?.trim() : undefined;
  validateDealState(input.stage, nextStatus, nextLossReason);
  await requireExistingClient(organizationId, input.clientId);
  try {
    const closureFields = nextStatus === 'Won'
      ? deal.status === 'Won' ? {} : { wonAt: serverTimestamp(), lostAt: null }
      : nextStatus === 'Lost'
        ? deal.status === 'Lost' ? {} : { lostAt: serverTimestamp(), wonAt: null }
        : { wonAt: null, lostAt: null };
    const batch = writeBatch(db);
    batch.update(organizationDocumentInCollection(db, organizationId, 'deals', deal.id), {
      title: input.title.trim(),
      value,
      stage: input.stage,
      status: nextStatus,
      expectedCloseDate: input.expectedCloseDate || '',
      ...(productServiceName !== undefined ? { productServiceName } : {}),
      ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
      ...(items !== undefined ? { items } : {}),
      assignedToUid: input.assignedToUid || '',
      assignedToName: input.assignedToName || '',
      lossReason: nextLossReason || null,
      ...closureFields,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    });
    const dealWasTerminal = deal.status === 'Won' || deal.status === 'Lost';
    if (deal.stage !== input.stage) {
      const stageKey = `system-stage-${encodeURIComponent(deal.stage)}-to-${encodeURIComponent(input.stage)}`;
      const isReopened = dealWasTerminal && nextStatus === 'Active';
      const description = isReopened
        ? `Deal reopened: ${deal.stage} → ${input.stage}`
        : nextStatus === 'Won'
          ? `Deal won: ${input.title} — ${value}`
          : nextStatus === 'Lost'
            ? `Deal lost: ${input.title}. Reason: ${nextLossReason}`
            : `Stage changed: ${deal.stage} → ${input.stage}`;
      batch.set(dealSystemTimelineRef(organizationId, deal.id, stageKey), dealSystemTimelineData(user, description));
      const activityType = isReopened ? 'deal_reopened' : nextStatus === 'Won' ? 'deal_won' : nextStatus === 'Lost' ? 'deal_lost' : 'stage_change';
      addActivityToBatch(batch, organizationId, user, { type: activityType, description, entityType: 'Deal', entityId: deal.id, metadata: { clientId: deal.clientId, dealId: deal.id, ...(nextStatus === 'Lost' ? { reason: nextLossReason } : {}) } });
    } else {
      batch.set(dealSystemTimelineRef(organizationId, deal.id, `edit-${Date.now()}`), dealSystemTimelineData(user, `Deal edited: ${input.title}`));
      addActivityToBatch(batch, organizationId, user, { type: 'deal_update', description: `Deal edited: ${input.title}`, entityType: 'Deal', entityId: deal.id, metadata: { clientId: deal.clientId, dealId: deal.id } });
    }
    await batch.commit();
  } catch (error) {
    reportFirestoreFailure('update', error);
    throw error;
  }
}

export async function updateDealStage(user: AppUser | null, organizationId: string, deal: Deal, stage: string, status: DealStatus = 'Active', lossReason?: string) {
  const nextStatus = getDealStatusForStage(stage);
  return updateDeal(user, organizationId, deal, {
    title: deal.title,
    clientId: deal.clientId,
    leadId: deal.leadId,
    value: deal.value,
    stage,
    expectedCloseDate: deal.expectedCloseDate,
    assignedToUid: deal.assignedToUid,
    assignedToName: deal.assignedToName,
    lossReason: nextStatus === 'Lost' ? lossReason : undefined,
  });
}

export async function archiveDeal(user: AppUser | null, organizationId: string, dealId: string) {
  const deal = await getDealById(user, organizationId, dealId);
  await requireDealManager(user, organizationId, deal);
  if (!user) throw new Error('You must be signed in to archive a deal.');
  try {
    const batch = writeBatch(db);
    batch.update(organizationDocumentInCollection(db, organizationId, 'deals', dealId), { archived: true, archivedAt: serverTimestamp(), archivedBy: user.uid, updatedAt: serverTimestamp(), updatedBy: user.uid });
    batch.set(dealSystemTimelineRef(organizationId, dealId, 'archived'), dealSystemTimelineData(user, `Deal archived: ${deal.title}`));
    addActivityToBatch(batch, organizationId, user, { type: 'deal_archive', description: `Deal archived: ${deal.title}`, entityType: 'Deal', entityId: dealId, metadata: { clientId: deal.clientId, dealId } });
    await batch.commit();
  } catch (error) {
    reportFirestoreFailure('archive', error);
    throw error;
  }
}

export async function listArchivedDealsPage(user: AppUser | null, organizationId: string, cursor: FirestoreCursor = null, pageSize = DEAL_PAGE_SIZE): Promise<PageResult<Deal>> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const dealsCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'deals');
  const constraints = [where('archived', '==', true), ...(membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : []), orderBy('createdAt', 'desc'), limit(pageSize)] as const;
  const dealsQuery = cursor ? query(dealsCollection, ...constraints, startAfter(cursor)) : query(dealsCollection, ...constraints);
  const snapshot = await getDocs(dealsQuery);
  const items = snapshot.docs.map((dealDoc) => mapDeal(dealDoc.id, dealDoc.data())).filter((deal) => deal.archived);
  return { items, nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null, hasMore: snapshot.docs.length === pageSize };
}

export async function listArchivedDeals(user: AppUser | null, organizationId: string) {
  return (await listArchivedDealsPage(user, organizationId)).items;
}

export async function countActiveDeals(user: AppUser | null, organizationId: string) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const constraints = [where('archived', '==', false), where('status', '==', 'Active'), ...(membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : [])] as const;
  const snapshot = await getAggregateFromServer(query(organizationCollection<DocumentData>(db, organizationId, 'deals'), ...constraints), { count: count() });
  return snapshot.data().count;
}

export async function restoreDeal(user: AppUser | null, organizationId: string, dealId: string) {
  const deal = await getDealById(user, organizationId, dealId);
  await requireDealManager(user, organizationId, deal);
  if (!user) throw new Error('You must be signed in to restore a deal.');
  const batch = writeBatch(db);
  batch.update(organizationDocumentInCollection(db, organizationId, 'deals', dealId), { archived: false, archivedAt: null, archivedBy: null, updatedAt: serverTimestamp(), updatedBy: user.uid });
  batch.set(dealSystemTimelineRef(organizationId, dealId, 'restored'), dealSystemTimelineData(user, `Deal restored: ${deal.title}`));
  addActivityToBatch(batch, organizationId, user, { type: 'deal_restore', description: `Deal restored: ${deal.title}`, entityType: 'Deal', entityId: dealId, metadata: { clientId: deal.clientId, dealId } });
  await batch.commit();
}

export async function permanentlyDeleteDeal(user: AppUser | null, organizationId: string, dealId: string) {
  await requireDealManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to delete a deal.');
  const dealRef = organizationDocumentInCollection(db, organizationId, 'deals', dealId);
  const snapshot = await getDoc(dealRef);
  if (!snapshot.exists() || snapshot.data().archived !== true) throw new Error('Only archived deals can be permanently deleted.');
  await deleteDoc(dealRef);
}
