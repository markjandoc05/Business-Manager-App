import { count, deleteDoc, doc, getAggregateFromServer, getDoc, getDocs, limit, orderBy, query, serverTimestamp, startAfter, updateDoc, where, writeBatch, type DocumentData } from 'firebase/firestore';
import type { FirestoreCursor, PageResult } from '@/lib/repositories/pagination';
import { firestoreQueryErrorMessage } from '@/lib/repositories/pagination';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { Deal } from '@/types';
import { requireOrganizationAccess } from '@/lib/permissions';
import { DEAL_ACTIVE_STAGES, getDealStatusForStage } from '@/lib/deal-workflow';
import { resolveAssignment } from '@/lib/ownership';
import { dealSystemTimelineData, dealSystemTimelineRef } from '@/lib/repositories/dealTimeline';
import { addActivityToBatch } from '@/lib/repositories/activityEvents';
import { organizationCollection, organizationDocumentInCollection } from '@/lib/organizations/paths';

export const PIPELINE_DEAL_LIMIT = 100;
export const DEAL_PAGE_SIZE = 25;

export type DealStatus = 'Active' | 'Won' | 'Lost';
export type DealInput = Pick<Deal, 'title' | 'clientId' | 'leadId' | 'value' | 'stage' | 'expectedCloseDate' | 'productServiceName' | 'notes' | 'assignedToUid' | 'assignedToName' | 'lossReason'>;

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
  };
}

async function requireActiveUser(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
}

async function requireDealManager(user: AppUser | null, organizationId: string, deal?: Deal) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  if (['ADMIN', 'MANAGER'].includes(membership.role)) return;
  if (membership.role === 'USER' && deal?.assignedToUid === user?.uid) return;
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

export async function createDeal(user: AppUser | null, organizationId: string, input: DealInput) {
  await requireDealManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to create a deal.');
  if (!input.title.trim() || !input.clientId || !Number.isFinite(input.value) || input.value < 0) throw new Error('Deal details are incomplete.');
  validateDealState(input.stage, 'Active');
  try {
    await requireExistingClient(organizationId, input.clientId);
  } catch (error) {
    reportFirestoreFailure('create-client-check', error);
    throw error;
  }

  const assignment = await resolveAssignment(user, organizationId, input.assignedToUid, input.assignedToName);
  let dealRef;
  let dealPath = '';
  let timelinePath = '';
  let payloadKeys: string[] = [];
  try {
    dealRef = doc(organizationCollection<Record<string, unknown>>(db, organizationId, 'deals'));
    const dealData = {
      ...input,
      leadId: input.leadId || null,
      ...assignment,
      status: 'Active',
      wonAt: null,
      lostAt: null,
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
    addActivityToBatch(batch, organizationId, user, { type: 'deal_creation', description: `New deal created: ${input.title}`, entityType: 'Deal', entityId: dealRef.id });
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
  return mapDeal(dealRef.id, { ...input, ...assignment, status: 'Active', archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: user.uid, updatedBy: user.uid });
}

export async function updateDeal(user: AppUser | null, organizationId: string, deal: Deal, input: DealInput) {
  await requireDealManager(user, organizationId, deal);
  if (!user) throw new Error('You must be signed in to update a deal.');
  if (deal.clientId !== input.clientId || deal.leadId !== (input.leadId || undefined)) throw new Error('Client and lead relationships cannot be changed from Deal editing.');
  if (deal.status !== 'Active' && input.stage !== deal.stage && getDealStatusForStage(input.stage) !== 'Active') {
    throw new Error('Won and Lost deals can only be reopened into an active stage.');
  }
  if (!input.title.trim() || !Number.isFinite(input.value) || input.value < 0) throw new Error('Deal details are incomplete.');
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
      value: input.value,
      stage: input.stage,
      status: nextStatus,
      expectedCloseDate: input.expectedCloseDate || '',
      ...(input.productServiceName !== undefined ? { productServiceName: input.productServiceName.trim() } : {}),
      ...(input.notes !== undefined ? { notes: input.notes.trim() } : {}),
      assignedToUid: input.assignedToUid || '',
      assignedToName: input.assignedToName || '',
      lossReason: nextLossReason || null,
      ...closureFields,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    });
    if (deal.stage !== input.stage) {
      const stageKey = `system-stage-${encodeURIComponent(deal.stage)}-to-${encodeURIComponent(input.stage)}`;
      const description = nextStatus === 'Won'
        ? 'Deal won.'
        : nextStatus === 'Lost'
          ? `Deal lost. Reason: ${nextLossReason}`
          : `Stage changed: ${deal.stage} → ${input.stage}`;
      batch.set(dealSystemTimelineRef(organizationId, deal.id, stageKey), dealSystemTimelineData(user, description));
      const activityType = nextStatus === 'Won' ? 'deal_won' : nextStatus === 'Lost' ? 'deal_lost' : 'stage_change';
      addActivityToBatch(batch, organizationId, user, { type: activityType, description, entityType: 'Deal', entityId: deal.id, ...(nextStatus === 'Lost' ? { metadata: { reason: nextLossReason } } : {}) });
    } else {
      addActivityToBatch(batch, organizationId, user, { type: nextStatus === 'Won' ? 'deal_won' : nextStatus === 'Lost' ? 'deal_lost' : 'deal_update', description: `Deal "${input.title}" updated`, entityType: 'Deal', entityId: deal.id });
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
  await requireDealManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to archive a deal.');
  try {
    await updateDoc(organizationDocumentInCollection(db, organizationId, 'deals', dealId), { archived: true, archivedAt: serverTimestamp(), archivedBy: user.uid, updatedAt: serverTimestamp(), updatedBy: user.uid });
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
  const constraints = [where('archived', '==', false), ...(membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : [])] as const;
  const snapshot = await getAggregateFromServer(query(organizationCollection<DocumentData>(db, organizationId, 'deals'), ...constraints), { count: count() });
  return snapshot.data().count;
}

export async function restoreDeal(user: AppUser | null, organizationId: string, dealId: string) {
  await requireDealManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to restore a deal.');
  await updateDoc(organizationDocumentInCollection(db, organizationId, 'deals', dealId), { archived: false, archivedAt: null, archivedBy: null, updatedAt: serverTimestamp(), updatedBy: user.uid });
}

export async function permanentlyDeleteDeal(user: AppUser | null, organizationId: string, dealId: string) {
  await requireDealManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to delete a deal.');
  const dealRef = organizationDocumentInCollection(db, organizationId, 'deals', dealId);
  const snapshot = await getDoc(dealRef);
  if (!snapshot.exists() || snapshot.data().archived !== true) throw new Error('Only archived deals can be permanently deleted.');
  await deleteDoc(dealRef);
}
