import { collection, doc, getDocs, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { Client, Lead, LeadStatus } from '@/types';
import { canManageLeads, canViewBusinessData } from '@/lib/permissions';

export type LeadInput = Pick<Lead, 'name' | 'company' | 'email' | 'phone' | 'source' | 'assignedTo'>;

function toIsoDate(value: unknown, fallback = new Date().toISOString()) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return typeof value === 'string' ? value : fallback;
}

function mapLead(id: string, data: Record<string, unknown>): Lead {
  const validStatuses: LeadStatus[] = ['New', 'Follow-up', 'Opportunity', 'Client', 'Lost'];
  return {
    id,
    name: typeof data.name === 'string' ? data.name : '',
    company: typeof data.company === 'string' ? data.company : '',
    email: typeof data.email === 'string' ? data.email : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    source: typeof data.source === 'string' ? data.source : '',
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo : '',
    status: validStatuses.includes(data.status as LeadStatus) ? data.status as LeadStatus : 'New',
    archived: data.archived === true,
    convertedClientId: typeof data.convertedClientId === 'string' ? data.convertedClientId : undefined,
    createdAt: toIsoDate(data.createdAt),
    updatedAt: toIsoDate(data.updatedAt),
  };
}

function requireActiveUser(user: AppUser | null) {
  if (!canViewBusinessData(user)) throw new Error('You do not have access to business data.');
}

function requireLeadManager(user: AppUser | null) {
  if (!canManageLeads(user)) throw new Error('You do not have permission to manage leads.');
}

export async function listLeads(user: AppUser | null) {
  requireActiveUser(user);
  const snapshot = await getDocs(collection(db, 'leads'));
  return snapshot.docs
    .map((leadDoc) => mapLead(leadDoc.id, leadDoc.data()))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createLead(user: AppUser | null, input: LeadInput) {
  requireLeadManager(user);
  if (!user) throw new Error('You must be signed in to create a lead.');

  const leadRef = doc(collection(db, 'leads'));
  const now = serverTimestamp();
  const data = {
    ...input,
    company: input.company || '',
    assignedTo: input.assignedTo || '',
    status: 'New' as const,
    archived: false,
    createdAt: now,
    createdBy: user.uid,
    updatedAt: now,
    updatedBy: user.uid,
  };
  await writeBatch(db).set(leadRef, data).commit();

  return mapLead(leadRef.id, { ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

export async function updateLead(user: AppUser | null, leadId: string, input: LeadInput) {
  requireLeadManager(user);
  if (!user) throw new Error('You must be signed in to update a lead.');
  await updateDoc(doc(db, 'leads', leadId), {
    ...input,
    company: input.company || '',
    assignedTo: input.assignedTo || '',
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
}

export async function updateLeadStatus(user: AppUser | null, lead: Lead, status: LeadStatus) {
  requireLeadManager(user);
  if (!user) throw new Error('You must be signed in to update a lead.');
  if (status === 'Client') throw new Error('Use lead conversion to create a client.');
  await updateDoc(doc(db, 'leads', lead.id), { status, updatedAt: serverTimestamp(), updatedBy: user.uid });
}

export async function archiveLead(user: AppUser | null, leadId: string) {
  requireLeadManager(user);
  if (!user) throw new Error('You must be signed in to archive a lead.');
  await updateDoc(doc(db, 'leads', leadId), { archived: true, updatedAt: serverTimestamp(), updatedBy: user.uid });
}

export async function convertLeadToClient(user: AppUser | null, lead: Lead) {
  requireLeadManager(user);
  if (!user) throw new Error('You must be signed in to convert a lead.');
  if (lead.status === 'Client' || lead.convertedClientId) throw new Error('This lead has already been converted.');

  const leadRef = doc(db, 'leads', lead.id);
  const clientRef = doc(collection(db, 'clients'));
  const now = serverTimestamp();
  const client = {
    name: lead.name,
    company: lead.company || '',
    email: lead.email,
    phone: lead.phone,
    assignedTo: lead.assignedTo || '',
    status: 'ACTIVE',
    notes: [],
    documents: [],
    sourceLeadId: lead.id,
    createdAt: now,
    createdBy: user.uid,
    updatedAt: now,
    updatedBy: user.uid,
  };

  const batch = writeBatch(db);
  batch.set(clientRef, client);
  batch.update(leadRef, {
    status: 'Client',
    convertedClientId: clientRef.id,
    updatedAt: now,
    updatedBy: user.uid,
  });
  await batch.commit();

  return { clientId: clientRef.id, leadId: lead.id };
}
