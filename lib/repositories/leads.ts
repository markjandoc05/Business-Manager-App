import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { Client, Lead, LeadStatus } from '@/types';
import { canManageLeads, canViewBusinessData } from '@/lib/permissions';
import { resolveOrganizationAssignment } from '@/lib/ownership';
import { systemTimelineData, systemTimelineRef } from '@/lib/repositories/leadTimeline';
import { organizationCollection, organizationDocumentInCollection } from '@/lib/organizations/paths';

export type LeadInput = Pick<Lead, 'name' | 'company' | 'email' | 'phone' | 'source' | 'assignedToUid' | 'assignedToName'>;

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
    assignedToUid: typeof data.assignedToUid === 'string' ? data.assignedToUid : '',
    assignedToName: typeof data.assignedToName === 'string' ? data.assignedToName : typeof data.assignedTo === 'string' ? data.assignedTo : '',
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo : undefined,
    status: validStatuses.includes(data.status as LeadStatus) ? data.status as LeadStatus : 'New',
    archived: data.archived === true,
    convertedClientId: typeof data.convertedClientId === 'string' ? data.convertedClientId : undefined,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
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

function requireLeadEditor(user: AppUser | null, assignedToUid?: string) {
  if (!user?.active || !['ADMIN', 'MANAGER', 'USER'].includes(user.role)) throw new Error('You do not have permission to update a lead.');
  if (user.role === 'USER' && assignedToUid !== user.uid) throw new Error('You can only update Leads assigned to you.');
}

export async function listLeads(user: AppUser | null, organizationId: string) {
  requireActiveUser(user);
  const leadsCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'leads');
  const snapshot = await getDocs(user?.role === 'USER' ? query(leadsCollection, where('assignedToUid', '==', user.uid)) : leadsCollection);
  return snapshot.docs
    .map((leadDoc) => mapLead(leadDoc.id, leadDoc.data()))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createLead(user: AppUser | null, organizationId: string, input: LeadInput) {
  requireLeadManager(user);
  if (!user) throw new Error('You must be signed in to create a lead.');

  const leadRef = doc(organizationCollection<Record<string, unknown>>(db, organizationId, 'leads'));
  const now = serverTimestamp();
  const assignment = await resolveOrganizationAssignment(user, organizationId, input.assignedToUid, input.assignedToName);
  const data = {
    name: input.name,
    email: input.email,
    phone: input.phone,
    source: input.source,
    company: input.company || '',
    ...assignment,
    status: 'New' as const,
    archived: false,
    createdAt: now,
    createdBy: user.uid,
    updatedAt: now,
    updatedBy: user.uid,
  };
  const batch = writeBatch(db);
  batch.set(leadRef, data);
  batch.set(systemTimelineRef(organizationId, leadRef.id, 'created'), systemTimelineData(user, 'Lead created.'));
  try {
    await batch.commit();
  } catch (error) {
    const firebaseError = error as { code?: string; message?: string };
    console.error('[Firestore] leads:create failed', {
      code: firebaseError.code || 'unknown',
      message: firebaseError.message || 'unknown error',
      organizationId,
      leadPath: leadRef.path,
      authUid: user.uid,
      role: user.role,
      active: user.active,
      payload: {
        ...data,
        createdAt: 'serverTimestamp()',
        updatedAt: 'serverTimestamp()',
      },
    });
    throw error;
  }

  return mapLead(leadRef.id, { ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

export async function updateLead(user: AppUser | null, organizationId: string, leadId: string, input: LeadInput) {
  requireLeadEditor(user, input.assignedToUid);
  if (!user) throw new Error('You must be signed in to update a lead.');
  const assignment = await resolveOrganizationAssignment(user, organizationId, input.assignedToUid, input.assignedToName);
  await updateDoc(organizationDocumentInCollection(db, organizationId, 'leads', leadId), {
    ...input,
    company: input.company || '',
    ...assignment,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
}

export async function updateLeadStatus(user: AppUser | null, organizationId: string, lead: Lead, status: LeadStatus) {
  requireLeadEditor(user, lead.assignedToUid);
  if (!user) throw new Error('You must be signed in to update a lead.');
  if (status === 'Client') throw new Error('Use lead conversion to create a client.');
  const leadRef = organizationDocumentInCollection(db, organizationId, 'leads', lead.id);
  const batch = writeBatch(db);
  batch.update(leadRef, { status, updatedAt: serverTimestamp(), updatedBy: user.uid });
  if (status === 'Lost' && lead.status !== 'Lost') {
    batch.set(systemTimelineRef(organizationId, lead.id, 'lost'), systemTimelineData(user, 'Lead marked Lost.'));
  }
  await batch.commit();
}

export async function archiveLead(user: AppUser | null, organizationId: string, leadId: string) {
  requireLeadEditor(user);
  if (!user) throw new Error('You must be signed in to archive a lead.');
  if (user.role === 'USER') {
    const existing = await getDoc(organizationDocumentInCollection(db, organizationId, 'leads', leadId));
    if (!existing.exists() || existing.data().assignedToUid !== user.uid) throw new Error('You can only archive Leads assigned to you.');
  }
  await updateDoc(organizationDocumentInCollection(db, organizationId, 'leads', leadId), { archived: true, updatedAt: serverTimestamp(), updatedBy: user.uid });
}

export async function convertLeadToClient(user: AppUser | null, organizationId: string, lead: Lead) {
  requireLeadManager(user);
  if (!user) throw new Error('You must be signed in to convert a lead.');
  if (lead.status === 'Client' || lead.convertedClientId) throw new Error('This lead has already been converted.');

  const leadRef = organizationDocumentInCollection(db, organizationId, 'leads', lead.id);
  const clientRef = doc(organizationCollection<Record<string, unknown>>(db, organizationId, 'clients'));
  const now = serverTimestamp();
  const client = {
    name: lead.name,
    company: lead.company || '',
    email: lead.email,
    phone: lead.phone,
    ...(await resolveOrganizationAssignment(user, organizationId, lead.assignedToUid || lead.createdBy, lead.assignedToName || lead.assignedTo)),
    status: 'ACTIVE',
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
  batch.set(systemTimelineRef(organizationId, lead.id, 'converted'), systemTimelineData(user, 'Converted to Client.'));
  await batch.commit();

  return { clientId: clientRef.id, leadId: lead.id };
}
