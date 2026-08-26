import { collection, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, updateDoc, where, writeBatch, type QueryConstraint } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { Client, Lead, LeadStatus } from '@/types';
import { requireOrganizationAccess } from '@/lib/permissions';
import { resolveOrganizationAssignment } from '@/lib/ownership';
import { systemTimelineData, systemTimelineRef } from '@/lib/repositories/leadTimeline';
import { addActivityToBatch } from '@/lib/repositories/activityEvents';
import { organizationCollection, organizationDocumentInCollection, organizationSubcollection } from '@/lib/organizations/paths';
import type { FirestoreCursor, PageResult } from '@/lib/repositories/pagination';
import { getLifecycleDecision, permanentlyDeleteRecord } from '@/lib/repositories/lifecycle';

export const LEAD_PAGE_SIZE = 25;
export type LeadViewFilter = 'All' | 'Active' | 'Converted' | 'Lost';
export type LeadListFilters = { view?: LeadViewFilter; status?: LeadStatus | 'All'; source?: string };

export type LeadInput = Pick<Lead, 'name' | 'company' | 'email' | 'phone' | 'source' | 'assignedToUid' | 'assignedToName'>;

export class LeadAlreadyConvertedError extends Error {
  code = 'already-converted' as const;

  constructor() {
    super('This lead has already been converted to a client.');
    this.name = 'LeadAlreadyConvertedError';
  }
}

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
    nextScheduledActivityAt: typeof data.nextScheduledActivityAt === 'string' ? data.nextScheduledActivityAt : toIsoDate(data.nextScheduledActivityAt, ''),
    nextScheduledActivityType: typeof data.nextScheduledActivityType === 'string' ? data.nextScheduledActivityType as Lead['nextScheduledActivityType'] : undefined,
    nextScheduledActivityId: typeof data.nextScheduledActivityId === 'string' ? data.nextScheduledActivityId : undefined,
    lastActivityAt: typeof data.lastActivityAt === 'string' ? data.lastActivityAt : toIsoDate(data.lastActivityAt, ''),
    lastActivityType: typeof data.lastActivityType === 'string' ? data.lastActivityType as Lead['lastActivityType'] : undefined,
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
    createdAt: toIsoDate(data.createdAt),
    updatedAt: toIsoDate(data.updatedAt),
    archivedAt: toIsoDate(data.archivedAt, ''),
    archivedBy: typeof data.archivedBy === 'string' ? data.archivedBy : undefined,
    trashed: data.trashed === true,
    trashedAt: toIsoDate(data.trashedAt, ''),
    trashedBy: typeof data.trashedBy === 'string' ? data.trashedBy : undefined,
  };
}

async function requireActiveUser(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
}

async function requireLeadManager(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId, ['ADMIN', 'MANAGER']);
}

async function requireLeadEditor(user: AppUser | null, organizationId: string, assignedToUid?: string) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  if (membership.role === 'USER' && assignedToUid !== user?.uid) throw new Error('You can only update Leads assigned to you.');
}

function leadFilterConstraints(filters: LeadListFilters = {}): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];
  const status = filters.status && filters.status !== 'All' ? filters.status : undefined;
  if (status) constraints.push(where('status', '==', status));
  else if (filters.view === 'Active') constraints.push(where('status', 'in', ['New', 'Follow-up', 'Opportunity']));
  else if (filters.view === 'Converted') constraints.push(where('status', '==', 'Client'));
  else if (filters.view === 'Lost') constraints.push(where('status', '==', 'Lost'));
  if (filters.source && filters.source !== 'All') constraints.push(where('source', '==', filters.source));
  return constraints;
}

export async function listLeadsPage(user: AppUser | null, organizationId: string, cursor: FirestoreCursor = null, pageSize = LEAD_PAGE_SIZE, filters: LeadListFilters = {}): Promise<PageResult<Lead>> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const leadsCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'leads');
  const constraints: QueryConstraint[] = membership.role === 'USER'
    ? [where('assignedToUid', '==', user?.uid), where('archived', '==', false), ...leadFilterConstraints(filters), orderBy('createdAt', 'desc')]
    : [where('archived', '==', false), ...leadFilterConstraints(filters), orderBy('createdAt', 'desc')];
  const leadsQuery = cursor
    ? query(leadsCollection, ...constraints, startAfter(cursor), limit(pageSize))
    : query(leadsCollection, ...constraints, limit(pageSize));
  const snapshot = await getDocs(leadsQuery);
  const items = snapshot.docs
    .map((leadDoc) => mapLead(leadDoc.id, leadDoc.data()))
    .filter((lead) => !lead.archived && !lead.trashed);
  return { items, nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null, hasMore: snapshot.docs.length === pageSize };
}

export async function listLeads(user: AppUser | null, organizationId: string) {
  return (await listLeadsPage(user, organizationId)).items;
}

export async function getLeadById(user: AppUser | null, organizationId: string, leadId: string) {
  await requireActiveUser(user, organizationId);
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const snapshot = await getDoc(organizationDocumentInCollection(db, organizationId, 'leads', leadId));
  if (!snapshot.exists()) throw new Error('The lead could not be found.');
  const data = snapshot.data();
  if (data.trashed === true) throw new Error('The lead could not be found.');
  if (membership.role === 'USER' && data.assignedToUid !== user?.uid) throw new Error('The lead could not be found.');
  return mapLead(snapshot.id, data);
}

export async function createLead(user: AppUser | null, organizationId: string, input: LeadInput) {
  await requireLeadManager(user, organizationId);
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
    trashed: false,
    createdAt: now,
    createdBy: user.uid,
    updatedAt: now,
    updatedBy: user.uid,
  };
  const batch = writeBatch(db);
  batch.set(leadRef, data);
  batch.set(systemTimelineRef(organizationId, leadRef.id, 'created'), systemTimelineData(user, 'Lead created.'));
  addActivityToBatch(batch, organizationId, user, { type: 'lead_creation', description: `Lead added: ${data.name} (${data.company || 'Independent'})`, entityType: 'Lead', entityId: leadRef.id });
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
      role: 'organization membership',
      active: true,
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
  await requireLeadEditor(user, organizationId, input.assignedToUid);
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
  await requireLeadEditor(user, organizationId, lead.assignedToUid);
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
  await requireOrganizationAccess(user, organizationId);
  if (!user) throw new Error('You must be signed in to archive a lead.');
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const existing = await getDoc(organizationDocumentInCollection(db, organizationId, 'leads', leadId));
  if (!existing.exists() || (membership.role === 'USER' && existing.data().assignedToUid !== user.uid)) throw new Error('You can only archive Leads assigned to you.');
  const decision = await getLifecycleDecision(user, organizationId, 'Lead', 'archive', leadId);
  if (decision.outcome === 'BLOCKED') throw new Error(`${decision.reason} ${decision.recommendedAction}`);
  await updateDoc(organizationDocumentInCollection(db, organizationId, 'leads', leadId), { archived: true, trashed: false, trashedAt: null, trashedBy: null, archivedAt: serverTimestamp(), archivedBy: user.uid, updatedAt: serverTimestamp(), updatedBy: user.uid });
}

export async function listArchivedLeadsPage(user: AppUser | null, organizationId: string, cursor: FirestoreCursor = null, pageSize = LEAD_PAGE_SIZE): Promise<PageResult<Lead>> {
  await requireActiveUser(user, organizationId);
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const leadsCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'leads');
  const constraints = membership.role === 'USER'
    ? [where('assignedToUid', '==', user?.uid), where('archived', '==', true), orderBy('createdAt', 'desc')]
    : [where('archived', '==', true), orderBy('createdAt', 'desc')];
  const leadsQuery = cursor
    ? query(leadsCollection, ...constraints, startAfter(cursor), limit(pageSize))
    : query(leadsCollection, ...constraints, limit(pageSize));
  const snapshot = await getDocs(leadsQuery);
  const items = snapshot.docs.map((leadDoc) => mapLead(leadDoc.id, leadDoc.data())).filter((lead) => lead.archived && !lead.trashed);
  return { items, nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null, hasMore: snapshot.docs.length === pageSize };
}

export async function listArchivedLeads(user: AppUser | null, organizationId: string) {
  return (await listArchivedLeadsPage(user, organizationId)).items;
}

export async function listTrashedLeadsPage(user: AppUser | null, organizationId: string, cursor: FirestoreCursor = null, pageSize = LEAD_PAGE_SIZE): Promise<PageResult<Lead>> {
  await requireActiveUser(user, organizationId);
  const leadsCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'leads');
  const leadsQuery = cursor
    ? query(leadsCollection, where('trashed', '==', true), orderBy('createdAt', 'desc'), startAfter(cursor), limit(pageSize))
    : query(leadsCollection, where('trashed', '==', true), orderBy('createdAt', 'desc'), limit(pageSize));
  const snapshot = await getDocs(leadsQuery);
  const items = snapshot.docs.map((leadDoc) => mapLead(leadDoc.id, leadDoc.data())).filter((lead) => lead.trashed);
  return { items, nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null, hasMore: snapshot.docs.length === pageSize };
}

export async function restoreLead(user: AppUser | null, organizationId: string, leadId: string) {
  await requireOrganizationAccess(user, organizationId);
  if (!user) throw new Error('You must be signed in to restore a lead.');
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const existing = await getDoc(organizationDocumentInCollection(db, organizationId, 'leads', leadId));
  if (!existing.exists() || (membership.role === 'USER' && existing.data().assignedToUid !== user.uid)) throw new Error('You can only restore Leads assigned to you.');
  await updateDoc(organizationDocumentInCollection(db, organizationId, 'leads', leadId), { archived: false, trashed: false, trashedAt: null, trashedBy: null, archivedAt: null, archivedBy: null, updatedAt: serverTimestamp(), updatedBy: user.uid });
}

export async function trashLead(user: AppUser | null, organizationId: string, leadId: string) {
  await requireLeadManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to move a lead to Trash.');
  const decision = await getLifecycleDecision(user, organizationId, 'Lead', 'trash', leadId);
  if (decision.outcome === 'BLOCKED') throw new Error(`${decision.reason} ${decision.recommendedAction}`);
  await updateDoc(organizationDocumentInCollection(db, organizationId, 'leads', leadId), { archived: true, trashed: true, trashedAt: serverTimestamp(), trashedBy: user.uid, updatedAt: serverTimestamp(), updatedBy: user.uid });
}

export async function permanentlyDeleteLead(user: AppUser | null, organizationId: string, leadId: string) {
  await requireLeadManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to delete a lead.');
  const decision = await getLifecycleDecision(user, organizationId, 'Lead', 'permanent-delete', leadId);
  if (decision.outcome === 'BLOCKED') throw new Error(`${decision.reason} ${decision.recommendedAction}`);
  await permanentlyDeleteRecord(user, organizationId, 'Lead', leadId);
}

export async function convertLeadToClient(user: AppUser | null, organizationId: string, lead: Lead) {
  await requireLeadManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to convert a lead.');

  const leadRef = organizationDocumentInCollection(db, organizationId, 'leads', lead.id);
  const clientRef = doc(organizationCollection<Record<string, unknown>>(db, organizationId, 'clients'));
  const now = serverTimestamp();
  const conversionTimelineRef = systemTimelineRef(organizationId, lead.id, 'converted');
  let conversionStage = 'read-current-lead';
  let clientPayload: Record<string, unknown> | null = null;

  try {
    const currentLeadSnapshot = await getDoc(leadRef);
    if (!currentLeadSnapshot.exists()) throw new Error('The lead could not be found.');
    const currentLead = currentLeadSnapshot.data();
    if (currentLead.status === 'Client' || typeof currentLead.convertedClientId === 'string') {
      throw new LeadAlreadyConvertedError();
    }

    conversionStage = 'resolve-assignment';
    const assignment = await resolveOrganizationAssignment(
      user,
      organizationId,
      typeof currentLead.assignedToUid === 'string' ? currentLead.assignedToUid : currentLead.createdBy,
      typeof currentLead.assignedToName === 'string' ? currentLead.assignedToName : currentLead.assignedTo,
    );
    clientPayload = {
      name: typeof currentLead.name === 'string' ? currentLead.name : lead.name,
      company: typeof currentLead.company === 'string' ? currentLead.company : '',
      email: typeof currentLead.email === 'string' ? currentLead.email : lead.email,
      phone: typeof currentLead.phone === 'string' ? currentLead.phone : '',
      ...assignment,
      status: 'ACTIVE',
      archived: false,
      trashed: false,
      sourceLeadId: lead.id,
      createdAt: now,
      createdBy: user.uid,
      updatedAt: now,
      updatedBy: user.uid,
    };

    conversionStage = 'commit-transaction';
    await runTransaction(db, async (transaction) => {
      const latestLeadSnapshot = await transaction.get(leadRef);
      if (!latestLeadSnapshot.exists()) throw new Error('The lead could not be found.');
      const latestLead = latestLeadSnapshot.data();
      if (latestLead.status === 'Client' || typeof latestLead.convertedClientId === 'string') {
        throw new LeadAlreadyConvertedError();
      }
      transaction.set(clientRef, clientPayload);
      transaction.update(leadRef, {
        status: 'Client',
        convertedClientId: clientRef.id,
        updatedAt: now,
        updatedBy: user.uid,
      });
      transaction.set(conversionTimelineRef, systemTimelineData(user, 'Converted to Client.'));
      const conversionActivityRef = doc(organizationCollection<Record<string, unknown>>(db, organizationId, 'activities'));
      transaction.set(conversionActivityRef, {
        type: 'client_conversion',
        description: `Converted lead ${typeof currentLead.name === 'string' ? currentLead.name : lead.name} to Client`,
        entityType: 'Lead',
        entityId: lead.id,
        metadata: { clientId: clientRef.id },
        createdAt: now,
        createdBy: user.uid,
      });
      const clientActivityRef = doc(organizationCollection<Record<string, unknown>>(db, organizationId, 'activities'));
      transaction.set(clientActivityRef, {
        type: 'client_creation',
        description: `Client created from lead: ${typeof currentLead.name === 'string' ? currentLead.name : lead.name}`,
        entityType: 'Client',
        entityId: clientRef.id,
        metadata: { sourceLeadId: lead.id },
        createdAt: now,
        createdBy: user.uid,
      });
    });
  } catch (error) {
    const firebaseError = error as { code?: string; message?: string };
    if (error instanceof LeadAlreadyConvertedError) throw error;
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[Firestore] lead conversion failed stage=${conversionStage} code=${firebaseError.code || 'unknown'} message=${firebaseError.message || 'unknown error'} org=${organizationId} lead=${lead.id} client=${clientRef.id} uid=${user.uid}`);
    }
    throw error;
  }

  return { clientId: clientRef.id, leadId: lead.id };
}
