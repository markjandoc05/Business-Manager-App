import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { Client } from '@/types';
import { canManageClients, canViewBusinessData } from '@/lib/permissions';

export type ClientInput = Pick<Client, 'name' | 'company' | 'email' | 'phone' | 'assignedTo'>;

function toIsoDate(value: unknown, fallback = new Date().toISOString()) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return typeof value === 'string' ? value : fallback;
}

function mapClient(id: string, data: Record<string, unknown>): Client {
  return {
    id,
    name: typeof data.name === 'string' ? data.name : '',
    company: typeof data.company === 'string' ? data.company : '',
    email: typeof data.email === 'string' ? data.email : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo : '',
    status: data.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    createdAt: toIsoDate(data.createdAt),
    updatedAt: toIsoDate(data.updatedAt),
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
    sourceLeadId: typeof data.sourceLeadId === 'string' ? data.sourceLeadId : undefined,
    notes: Array.isArray(data.notes) ? data.notes as Client['notes'] : [],
    documents: Array.isArray(data.documents) ? data.documents as Client['documents'] : [],
  };
}

function requireActiveUser(user: AppUser | null) {
  if (!canViewBusinessData(user)) throw new Error('You do not have access to business data.');
}

function requireClientManager(user: AppUser | null) {
  if (!canManageClients(user)) throw new Error('You do not have permission to manage clients.');
}

export async function listClients(user: AppUser | null) {
  requireActiveUser(user);
  const snapshot = await getDocs(collection(db, 'clients'));
  return snapshot.docs
    .map((clientDoc) => mapClient(clientDoc.id, clientDoc.data()))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createClient(user: AppUser | null, input: ClientInput) {
  requireClientManager(user);
  if (!user) throw new Error('You must be signed in to create a client.');

  const clientRef = await addDoc(collection(db, 'clients'), {
    ...input,
    company: input.company || '',
    assignedTo: input.assignedTo || '',
    status: 'ACTIVE',
    notes: [],
    documents: [],
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });

  return mapClient(clientRef.id, { ...input, status: 'ACTIVE', notes: [], documents: [], createdAt: new Date().toISOString(), createdBy: user.uid, updatedAt: new Date().toISOString(), updatedBy: user.uid });
}

export async function updateClient(user: AppUser | null, clientId: string, input: ClientInput) {
  requireClientManager(user);
  if (!user) throw new Error('You must be signed in to update a client.');

  await updateDoc(doc(db, 'clients', clientId), {
    ...input,
    company: input.company || '',
    assignedTo: input.assignedTo || '',
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
}

export async function archiveClient(user: AppUser | null, clientId: string) {
  requireClientManager(user);
  if (!user) throw new Error('You must be signed in to archive a client.');

  await updateDoc(doc(db, 'clients', clientId), {
    status: 'ARCHIVED',
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
}
