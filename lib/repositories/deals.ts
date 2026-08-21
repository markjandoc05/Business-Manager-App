import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { Deal } from '@/types';
import { canManageClients, canViewBusinessData } from '@/lib/permissions';

export type DealStatus = 'Active' | 'Won' | 'Lost';
export type DealInput = Pick<Deal, 'title' | 'clientId' | 'leadId' | 'value' | 'stage' | 'expectedCloseDate' | 'assignedTo' | 'lossReason'>;

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
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo : '',
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

function requireDealManager(user: AppUser | null) {
  if (!canManageClients(user)) throw new Error('You do not have permission to manage deals.');
}

function validateDealState(stage: string, status: DealStatus, lossReason?: string) {
  if (status === 'Won' && stage !== 'Won') throw new Error('Won deals must be in the Won stage.');
  if (status === 'Lost' && (stage !== 'Lost' || !lossReason?.trim())) throw new Error('Lost deals require a loss reason and Lost stage.');
  if (status === 'Active' && (stage === 'Won' || stage === 'Lost')) throw new Error('Active deals cannot be in Won or Lost stages.');
}

async function requireExistingClient(clientId: string) {
  const clientSnapshot = await getDoc(doc(db, 'clients', clientId));
  if (!clientSnapshot.exists() || clientSnapshot.data().status === 'ARCHIVED') throw new Error('The selected client is not available.');
}

export async function listDeals(user: AppUser | null) {
  requireActiveUser(user);
  try {
    const snapshot = await getDocs(collection(db, 'deals'));
    return snapshot.docs.map((dealDoc) => mapDeal(dealDoc.id, dealDoc.data())).filter((deal) => !deal.archived).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (error) {
    reportFirestoreFailure('list', error);
    throw error;
  }
}

export async function createDeal(user: AppUser | null, input: DealInput) {
  requireDealManager(user);
  if (!user) throw new Error('You must be signed in to create a deal.');
  if (!input.title.trim() || !input.clientId || !Number.isFinite(input.value) || input.value < 0) throw new Error('Deal details are incomplete.');
  validateDealState(input.stage, 'Active');
  try {
    await requireExistingClient(input.clientId);
  } catch (error) {
    reportFirestoreFailure('create-client-check', error);
    throw error;
  }

  let dealRef;
  try {
    dealRef = await addDoc(collection(db, 'deals'), {
      ...input,
      leadId: input.leadId || null,
      assignedTo: input.assignedTo || '',
      status: 'Active',
      archived: false,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    });
  } catch (error) {
    reportFirestoreFailure('create', error);
    throw error;
  }
  return mapDeal(dealRef.id, { ...input, status: 'Active', archived: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: user.uid, updatedBy: user.uid });
}

export async function updateDeal(user: AppUser | null, dealId: string, input: DealInput) {
  requireDealManager(user);
  if (!user) throw new Error('You must be signed in to update a deal.');
  validateDealState(input.stage, 'Active');
  await requireExistingClient(input.clientId);
  try {
    await updateDoc(doc(db, 'deals', dealId), { ...input, leadId: input.leadId || null, assignedTo: input.assignedTo || '', updatedAt: serverTimestamp(), updatedBy: user.uid });
  } catch (error) {
    reportFirestoreFailure('update', error);
    throw error;
  }
}

export async function updateDealStage(user: AppUser | null, deal: Deal, stage: string, status: DealStatus = 'Active', lossReason?: string) {
  requireDealManager(user);
  if (!user) throw new Error('You must be signed in to update a deal.');
  validateDealState(stage, status, lossReason);
  try {
    await updateDoc(doc(db, 'deals', deal.id), { stage, status, lossReason: status === 'Lost' ? lossReason?.trim() : null, updatedAt: serverTimestamp(), updatedBy: user.uid });
  } catch (error) {
    reportFirestoreFailure('stage-update', error);
    throw error;
  }
}

export async function archiveDeal(user: AppUser | null, dealId: string) {
  requireDealManager(user);
  if (!user) throw new Error('You must be signed in to archive a deal.');
  try {
    await updateDoc(doc(db, 'deals', dealId), { archived: true, updatedAt: serverTimestamp(), updatedBy: user.uid });
  } catch (error) {
    reportFirestoreFailure('archive', error);
    throw error;
  }
}
