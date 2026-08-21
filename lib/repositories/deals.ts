import { doc, getDoc, getDocs, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { Deal } from '@/types';
import { canManageClients, canViewBusinessData } from '@/lib/permissions';
import { getDealStatusForStage } from '@/lib/deal-workflow';
import { resolveAssignment } from '@/lib/ownership';
import { dealSystemTimelineData, dealSystemTimelineRef } from '@/lib/repositories/dealTimeline';
import { organizationCollection, organizationDocumentInCollection } from '@/lib/organizations/paths';

export type DealStatus = 'Active' | 'Won' | 'Lost';
export type DealInput = Pick<Deal, 'title' | 'clientId' | 'leadId' | 'value' | 'stage' | 'expectedCloseDate' | 'assignedToUid' | 'assignedToName' | 'lossReason'>;

function reportFirestoreFailure(operation: string, error: unknown) {
  const firebaseError = error as { code?: string; message?: string };
  console.error(`[Firestore] deals:${operation} failed code=${firebaseError.code || 'unknown'} message=${firebaseError.message || 'unknown error'}`);
}

function toIsoDate(value: unknown, fallback = new Date().toISOString()) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return value.toDate().toISOString();
  return typeof value === 'string' ? value : fallback;
}

function mapDeal(id: string, data: Record<string, unknown>): Deal {
  const status = data.status === 'Won' || data.status === 'Lost' ? data.status : 'Active';
  return {
    id,
    title: typeof data.title === 'string' ? data.title : '',
    clientId: typeof data.clientId === 'string' ? data.clientId : '',
    leadId: typeof data.leadId === 'string' ? data.leadId : undefined,
    value: typeof data.value === 'number' ? data.value : 0,
    stage: typeof data.stage === 'string' ? data.stage : 'Opportunity',
    status,
    expectedCloseDate: typeof data.expectedCloseDate === 'string' ? data.expectedCloseDate : '',
    assignedToUid: typeof data.assignedToUid === 'string' ? data.assignedToUid : '',
    assignedToName: typeof data.assignedToName === 'string' ? data.assignedToName : typeof data.assignedTo === 'string' ? data.assignedTo : '',
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo : undefined,
    lossReason: typeof data.lossReason === 'string' ? data.lossReason : undefined,
    archived: data.archived === true,
    createdAt: toIsoDate(data.createdAt),
    updatedAt: toIsoDate(data.updatedAt),
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
  };
}

function requireActiveUser(user: AppUser | null) {
  if (!canViewBusinessData(user)) throw new Error('You do not have access to business data.');
}

function requireDealManager(user: AppUser | null, deal?: Deal) {
  if (canManageClients(user)) return;
  if (user?.active === true && user.role === 'USER' && deal?.assignedToUid === user.uid) return;
  throw new Error('You do not have permission to manage this deal.');
}

function validateDealState(stage: string, status: DealStatus, lossReason?: string) {
  if (status === 'Won' && stage !== 'Won') throw new Error('Won deals must be in the Won stage.');
  if (status === 'Lost' && (stage !== 'Lost' || !lossReason?.trim())) throw new Error('Lost deals require a loss reason and Lost stage.');
  if (status === 'Active' && (stage === 'Won' || stage === 'Lost')) throw new Error('Active deals cannot be in Won or Lost stages.');
}

async function requireExistingClient(organizationId: string, clientId: string) {
  const clientSnapshot = await getDoc(organizationDocumentInCollection(db, organizationId, 'clients', clientId));
  if (!clientSnapshot.exists() || clientSnapshot.data().status === 'ARCHIVED') throw new Error('The selected client is not available.');
}

export async function listDeals(user: AppUser | null, organizationId: string) {
  requireActiveUser(user);
  try {
    const snapshot = await getDocs(organizationCollection<Record<string, unknown>>(db, organizationId, 'deals'));
    return snapshot.docs.map((dealDoc) => mapDeal(dealDoc.id, dealDoc.data())).filter((deal) => !deal.archived).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (error) {
    reportFirestoreFailure('list', error);
    throw error;
  }
}

export async function createDeal(user: AppUser | null, organizationId: string, input: DealInput) {
  requireDealManager(user);
  if (!user) throw new Error('You must be signed in to create a deal.');
  if (!input.title.trim() || !input.clientId || !Number.isFinite(input.value) || input.value < 0) throw new Error('Deal details are incomplete.');
  validateDealState(input.stage, 'Active');
  try {
    await requireExistingClient(organizationId, input.clientId);
  } catch (error) {
    reportFirestoreFailure('create-client-check', error);
    throw error;
  }

  const assignment = await resolveAssignment(user, input.assignedToUid, input.assignedToName);
  let dealRef;
  try {
    dealRef = doc(organizationCollection<Record<string, unknown>>(db, organizationId, 'deals'));
    const dealData = {
      ...input,
      leadId: input.leadId || null,
      ...assignment,
      status: 'Active',
      archived: false,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    };
    const batch = writeBatch(db);
    batch.set(dealRef, dealData);
    batch.set(dealSystemTimelineRef(organizationId, dealRef.id, 'system-created'), dealSystemTimelineData(user, 'Deal created.'));
    await batch.commit();
  } catch (error) {
    reportFirestoreFailure('create', error);
    throw error;
  }
  return mapDeal(dealRef.id, { ...input, ...assignment, status: 'Active', archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: user.uid, updatedBy: user.uid });
}

export async function updateDeal(user: AppUser | null, organizationId: string, deal: Deal, input: DealInput) {
  requireDealManager(user, deal);
  if (!user) throw new Error('You must be signed in to update a deal.');
  if (deal.clientId !== input.clientId || deal.leadId !== (input.leadId || undefined)) throw new Error('Client and lead relationships cannot be changed from Deal editing.');
  if (deal.status !== 'Active' && input.stage !== deal.stage) throw new Error('Won and Lost deals cannot be reopened or moved.');
  if (!input.title.trim() || !Number.isFinite(input.value) || input.value < 0) throw new Error('Deal details are incomplete.');
  const nextStatus = getDealStatusForStage(input.stage);
  const nextLossReason = nextStatus === 'Lost' ? input.lossReason?.trim() : undefined;
  validateDealState(input.stage, nextStatus, nextLossReason);
  await requireExistingClient(organizationId, input.clientId);
  try {
    const batch = writeBatch(db);
    batch.update(organizationDocumentInCollection(db, organizationId, 'deals', deal.id), {
      title: input.title.trim(),
      value: input.value,
      stage: input.stage,
      status: nextStatus,
      expectedCloseDate: input.expectedCloseDate || '',
      assignedToUid: input.assignedToUid || '',
      assignedToName: input.assignedToName || '',
      lossReason: nextLossReason || null,
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
  requireDealManager(user);
  if (!user) throw new Error('You must be signed in to archive a deal.');
  try {
    await updateDoc(organizationDocumentInCollection(db, organizationId, 'deals', dealId), { archived: true, updatedAt: serverTimestamp(), updatedBy: user.uid });
  } catch (error) {
    reportFirestoreFailure('archive', error);
    throw error;
  }
}
