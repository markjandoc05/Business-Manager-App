import { addDoc, collection, doc, endAt, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, startAfter, startAt, updateDoc, where, writeBatch } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import { authenticatedFetch } from '@/lib/repositories/authenticatedRequest';
import type { Client, DocumentItem, Note } from '@/types';
import { requireOrganizationAccess } from '@/lib/permissions';
import { resolveAssignment } from '@/lib/ownership';
import { organizationCollection, organizationDocumentInCollection, organizationSubcollection, organizationSubcollectionDocument } from '@/lib/organizations/paths';
import { addActivityToBatch } from '@/lib/repositories/activityEvents';
import type { FirestoreCursor, PageResult } from '@/lib/repositories/pagination';
import { getClientDocumentSizeError } from '@/lib/client-documents';
import { getLifecycleDecision, permanentlyDeleteRecord } from '@/lib/repositories/lifecycle';

export const CLIENT_PAGE_SIZE = 25;

export type ClientInput = Pick<Client, 'name' | 'company' | 'email' | 'phone' | 'assignedToUid' | 'assignedToName'>;

function toIsoDate(value: unknown, fallback = new Date().toISOString()) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return typeof value === 'string' ? value : fallback;
}

function optionalIsoDate(value: unknown) {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }
  return typeof value === 'string' ? value : undefined;
}

function mapClient(id: string, data: Record<string, unknown>): Client {
  return {
    id,
    name: typeof data.name === 'string' ? data.name : '',
    company: typeof data.company === 'string' ? data.company : '',
    email: typeof data.email === 'string' ? data.email : '',
    phone: typeof data.phone === 'string' ? data.phone : '',
    assignedToUid: typeof data.assignedToUid === 'string' ? data.assignedToUid : '',
    assignedToName: typeof data.assignedToName === 'string' ? data.assignedToName : typeof data.assignedTo === 'string' ? data.assignedTo : '',
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo : undefined,
    status: data.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    archived: data.archived === true || data.status === 'ARCHIVED',
    archivedAt: typeof data.archivedAt === 'object' && data.archivedAt && 'toDate' in data.archivedAt && typeof data.archivedAt.toDate === 'function' ? data.archivedAt.toDate().toISOString() : undefined,
    archivedBy: typeof data.archivedBy === 'string' ? data.archivedBy : undefined,
    trashed: data.trashed === true,
    trashedAt: optionalIsoDate(data.trashedAt),
    trashedBy: typeof data.trashedBy === 'string' ? data.trashedBy : undefined,
    createdAt: toIsoDate(data.createdAt),
    updatedAt: toIsoDate(data.updatedAt),
    createdBy: typeof data.createdBy === 'string' ? data.createdBy : undefined,
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
    sourceLeadId: typeof data.sourceLeadId === 'string' ? data.sourceLeadId : undefined,
    documents: [],
  };
}

async function requireActiveUser(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
}

async function requireClientManager(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId, ['ADMIN', 'MANAGER']);
}

export async function listClientsPage(user: AppUser | null, organizationId: string, cursor: FirestoreCursor = null, pageSize = CLIENT_PAGE_SIZE, search = ''): Promise<PageResult<Client>> {
  await requireActiveUser(user, organizationId);
  const clientsCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'clients');
  const term = search.trim().toLowerCase();
  if (term) {
    const matches: Client[] = [];
    const matchingCursors: FirestoreCursor[] = [];
    let scanCursor = cursor;
    let lastRawCursor: FirestoreCursor = null;
    let exhausted = false;
    for (let page = 0; page < 20 && matches.length <= pageSize; page += 1) {
      const pageQuery = query(clientsCollection, where('archived', '==', false), orderBy('createdAt', 'desc'), ...(scanCursor ? [startAfter(scanCursor)] : []), limit(pageSize));
      const pageSnapshot = await getDocs(pageQuery);
      if (pageSnapshot.empty) { exhausted = true; break; }
      lastRawCursor = pageSnapshot.docs.at(-1) || null;
      for (const clientDoc of pageSnapshot.docs) {
        const client = mapClient(clientDoc.id, clientDoc.data());
        if (!client.archived && !client.trashed && [client.name, client.company || '', client.email, client.phone].some((value) => value.toLowerCase().includes(term))) {
          matches.push(client); matchingCursors.push(clientDoc);
        }
        if (matches.length > pageSize) break;
      }
      if (matches.length > pageSize) break;
      if (pageSnapshot.docs.length < pageSize) { exhausted = true; break; }
      scanCursor = lastRawCursor;
    }
    const items = matches.slice(0, pageSize);
    return { items, nextCursor: matches.length > pageSize ? matchingCursors[pageSize - 1] || null : exhausted ? null : matchingCursors.at(-1) || lastRawCursor, hasMore: matches.length > pageSize || !exhausted };
  }
  const clientsQuery = cursor
    ? query(clientsCollection, where('archived', '==', false), orderBy('createdAt', 'desc'), startAfter(cursor), limit(pageSize))
    : query(clientsCollection, where('archived', '==', false), orderBy('createdAt', 'desc'), limit(pageSize));
  const snapshot = await getDocs(clientsQuery);
  const items = snapshot.docs
    .map((clientDoc) => mapClient(clientDoc.id, clientDoc.data()))
    .filter((client) => !client.archived && !client.trashed)
    .filter((client) => !term || [client.name, client.company || '', client.email, client.phone].some((value) => value.toLowerCase().includes(term)));
  return { items, nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null, hasMore: snapshot.docs.length === pageSize };
}

export async function listClients(user: AppUser | null, organizationId: string) {
  return (await listClientsPage(user, organizationId)).items;
}

/**
 * Bounded server-side prefix search for Client pickers. Firestore has no
 * cross-field text search, so query each supported field and merge the small
 * result sets rather than downloading the organization Client collection.
 */
export async function searchActiveClients(user: AppUser | null, organizationId: string, value: string, pageSize = 8): Promise<Client[]> {
  await requireActiveUser(user, organizationId);
  const term = value.trim();
  if (!term) return (await listClientsPage(user, organizationId, null, pageSize)).items;
  const titleTerm = term.replace(/\b\w/g, (character) => character.toUpperCase());
  const emailTerm = term.toLowerCase();
  const clientsCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'clients');
  const fields: Array<[string, string]> = [
    ['name', term], ['company', term], ['email', emailTerm], ['phone', term],
    ...(titleTerm === term ? [] : [['name', titleTerm], ['company', titleTerm]] as Array<[string, string]>),
  ];
  const snapshots = await Promise.all(fields.map(([field, prefix]) => getDocs(query(
    clientsCollection,
    where('status', '==', 'ACTIVE'),
    where('archived', '==', false),
    where('trashed', '==', false),
    orderBy(field),
    startAt(prefix),
    endAt(`${prefix}\uf8ff`),
    limit(pageSize),
  ))));
  const matches = new Map<string, Client>();
  snapshots.flatMap((snapshot) => snapshot.docs).forEach((clientDoc) => {
    const client = mapClient(clientDoc.id, clientDoc.data());
    if (!client.archived && !client.trashed && client.status === 'ACTIVE') matches.set(client.id, client);
  });
  return [...matches.values()].sort((left, right) => left.name.localeCompare(right.name)).slice(0, pageSize);
}

export async function getClientById(user: AppUser | null, organizationId: string, clientId: string) {
  await requireActiveUser(user, organizationId);
  const snapshot = await getDoc(organizationDocumentInCollection(db, organizationId, 'clients', clientId));
  if (!snapshot.exists()) throw new Error('The client could not be found.');
  if (snapshot.data().trashed === true) throw new Error('The client could not be found.');
  return mapClient(snapshot.id, snapshot.data());
}

export async function createClient(user: AppUser | null, organizationId: string, input: ClientInput) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to create a client.');

  const assignment = await resolveAssignment(user, organizationId, input.assignedToUid, input.assignedToName);
  const clientRef = doc(organizationCollection<Record<string, unknown>>(db, organizationId, 'clients'));
  const clientData = {
    ...input,
    company: input.company || '',
    ...assignment,
    status: 'ACTIVE',
    archived: false,
    trashed: false,
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  };
  const batch = writeBatch(db);
  batch.set(clientRef, clientData);
  addActivityToBatch(batch, organizationId, user, { type: 'client_creation', description: `Client added: ${input.name}`, entityType: 'Client', entityId: clientRef.id });
  await batch.commit();

  return mapClient(clientRef.id, { ...input, ...assignment, status: 'ACTIVE', archived: false, trashed: false, createdAt: new Date().toISOString(), createdBy: user.uid, updatedAt: new Date().toISOString(), updatedBy: user.uid });
}

export async function updateClient(user: AppUser | null, organizationId: string, clientId: string, input: ClientInput) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to update a client.');

  const batch = writeBatch(db);
  batch.update(organizationDocumentInCollection(db, organizationId, 'clients', clientId), {
    ...input,
    company: input.company || '',
    assignedToUid: input.assignedToUid || '',
    assignedToName: input.assignedToName || '',
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  addActivityToBatch(batch, organizationId, user, { type: 'client_update', description: `Client updated: ${input.name}`, entityType: 'Client', entityId: clientId });
  await batch.commit();
}

export async function archiveClient(user: AppUser | null, organizationId: string, clientId: string) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to archive a client.');
  const decision = await getLifecycleDecision(user, organizationId, 'Client', 'archive', clientId);
  if (decision.outcome === 'BLOCKED') throw new Error(`${decision.reason} ${decision.recommendedAction}`);

  const batch = writeBatch(db);
  batch.update(organizationDocumentInCollection(db, organizationId, 'clients', clientId), {
    status: 'ARCHIVED',
    archived: true,
    trashed: false,
    trashedAt: null,
    trashedBy: null,
    archivedAt: serverTimestamp(),
    archivedBy: user.uid,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
  addActivityToBatch(batch, organizationId, user, { type: 'client_archive', description: `Client archived: ${clientId}`, entityType: 'Client', entityId: clientId });
  await batch.commit();
}

export async function listArchivedClientsPage(user: AppUser | null, organizationId: string, cursor: FirestoreCursor = null, pageSize = CLIENT_PAGE_SIZE): Promise<PageResult<Client>> {
  await requireActiveUser(user, organizationId);
  const clientsCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'clients');
  const clientsQuery = cursor
    ? query(clientsCollection, where('archived', '==', true), orderBy('createdAt', 'desc'), startAfter(cursor), limit(pageSize))
    : query(clientsCollection, where('archived', '==', true), orderBy('createdAt', 'desc'), limit(pageSize));
  const snapshot = await getDocs(clientsQuery);
  const items = snapshot.docs.map((clientDoc) => mapClient(clientDoc.id, clientDoc.data())).filter((client) => client.archived && !client.trashed);
  return { items, nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null, hasMore: snapshot.docs.length === pageSize };
}

export async function listArchivedClients(user: AppUser | null, organizationId: string) {
  return (await listArchivedClientsPage(user, organizationId)).items;
}

export async function listTrashedClientsPage(user: AppUser | null, organizationId: string, cursor: FirestoreCursor = null, pageSize = CLIENT_PAGE_SIZE): Promise<PageResult<Client>> {
  await requireActiveUser(user, organizationId);
  const clientsCollection = organizationCollection<Record<string, unknown>>(db, organizationId, 'clients');
  const clientsQuery = cursor
    ? query(clientsCollection, where('trashed', '==', true), orderBy('createdAt', 'desc'), startAfter(cursor), limit(pageSize))
    : query(clientsCollection, where('trashed', '==', true), orderBy('createdAt', 'desc'), limit(pageSize));
  const snapshot = await getDocs(clientsQuery);
  const items = snapshot.docs.map((clientDoc) => mapClient(clientDoc.id, clientDoc.data())).filter((client) => client.trashed);
  return { items, nextCursor: snapshot.docs.length === pageSize ? snapshot.docs[snapshot.docs.length - 1] : null, hasMore: snapshot.docs.length === pageSize };
}

export async function restoreClient(user: AppUser | null, organizationId: string, clientId: string) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to restore a client.');
  const batch = writeBatch(db);
  batch.update(organizationDocumentInCollection(db, organizationId, 'clients', clientId), { status: 'ACTIVE', archived: false, trashed: false, trashedAt: null, trashedBy: null, archivedAt: null, archivedBy: null, updatedAt: serverTimestamp(), updatedBy: user.uid });
  addActivityToBatch(batch, organizationId, user, { type: 'client_restore', description: `Client restored: ${clientId}`, entityType: 'Client', entityId: clientId });
  await batch.commit();
}

export async function trashClient(user: AppUser | null, organizationId: string, clientId: string) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to move a client to Trash.');
  const decision = await getLifecycleDecision(user, organizationId, 'Client', 'trash', clientId);
  if (decision.outcome === 'BLOCKED') throw new Error(`${decision.reason} ${decision.recommendedAction}`);
  const batch = writeBatch(db);
  batch.update(organizationDocumentInCollection(db, organizationId, 'clients', clientId), {
    status: 'ARCHIVED', archived: true, archivedAt: serverTimestamp(), archivedBy: user.uid, trashed: true, trashedAt: serverTimestamp(), trashedBy: user.uid,
    updatedAt: serverTimestamp(), updatedBy: user.uid,
  });
  addActivityToBatch(batch, organizationId, user, { type: 'client_archive', description: `Client moved to Trash: ${clientId}`, entityType: 'Client', entityId: clientId });
  await batch.commit();
}

export async function permanentlyDeleteClient(user: AppUser | null, organizationId: string, clientId: string) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to delete a client.');
  const decision = await getLifecycleDecision(user, organizationId, 'Client', 'permanent-delete', clientId);
  if (decision.outcome === 'BLOCKED') throw new Error(`${decision.reason} ${decision.recommendedAction}`);
  await permanentlyDeleteRecord(user, organizationId, 'Client', clientId);
}

export async function addClientNote(user: AppUser | null, organizationId: string, clientId: string, content: string) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to create a client note.');

  const noteRef = doc(organizationSubcollection(db, organizationId, 'clients', clientId, 'notes'));
  const noteData = {
    content,
    createdAt: serverTimestamp(),
    createdByUid: user.uid,
    createdByName: user.name,
    archived: false,
    archivedAt: null,
    archivedBy: null,
  };
  const batch = writeBatch(db);
  batch.set(noteRef, noteData);
  addActivityToBatch(batch, organizationId, user, { type: 'note_creation', description: 'Note added.', entityType: 'Note', entityId: noteRef.id, metadata: { clientId, noteId: noteRef.id } });
  await batch.commit();

  return {
    id: noteRef.id,
    clientId,
    content,
    author: user.name,
    createdByUid: user.uid,
    createdByName: user.name,
    createdAt: new Date().toISOString(),
    archived: false,
  } satisfies Note;
}

export async function updateClientNote(user: AppUser | null, organizationId: string, clientId: string, noteId: string, content: string) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to update a client note.');
  const trimmedContent = content.trim();
  if (!trimmedContent) throw new Error('Note content is required.');
  const noteRef = organizationSubcollectionDocument(db, organizationId, 'clients', clientId, 'notes', noteId);
  const batch = writeBatch(db);
  batch.update(noteRef, { content: trimmedContent });
  addActivityToBatch(batch, organizationId, user, { type: 'note_update', description: 'Note edited.', entityType: 'Note', entityId: noteId, metadata: { clientId, noteId } });
  await batch.commit();
}

function mapClientNote(id: string, clientId: string, data: Record<string, unknown>): Note {
  return {
    id,
    clientId,
    content: typeof data.content === 'string' ? data.content : '',
    author: typeof data.createdByName === 'string' ? data.createdByName : typeof data.authorName === 'string' ? data.authorName : '',
    createdByUid: typeof data.createdByUid === 'string' ? data.createdByUid : typeof data.createdBy === 'string' ? data.createdBy : undefined,
    createdByName: typeof data.createdByName === 'string' ? data.createdByName : typeof data.authorName === 'string' ? data.authorName : undefined,
    createdAt: toIsoDate(data.createdAt),
    archived: data.archived === true,
    archivedAt: optionalIsoDate(data.archivedAt),
    archivedBy: typeof data.archivedBy === 'string' ? data.archivedBy : undefined,
  } satisfies Note;
}

export async function listClientNotesPage(user: AppUser | null, organizationId: string, clientId: string, cursor: FirestoreCursor = null, pageSize = 20): Promise<PageResult<Note>> {
  await requireActiveUser(user, organizationId);
  const notesCollection = organizationSubcollection<Record<string, unknown>>(db, organizationId, 'clients', clientId, 'notes');
  const pageLimit = Math.max(1, Math.floor(pageSize));
  const matches: Note[] = [];
  const matchingCursors: FirestoreCursor[] = [];
  let scanCursor = cursor;
  let lastRawCursor: FirestoreCursor = null;
  let exhausted = false;
  for (let page = 0; page < 20 && matches.length <= pageLimit; page += 1) {
    const notesQuery = query(notesCollection, orderBy('createdAt', 'desc'), ...(scanCursor ? [startAfter(scanCursor)] : []), limit(pageLimit));
    const snapshot = await getDocs(notesQuery);
    if (snapshot.empty) { exhausted = true; break; }
    lastRawCursor = snapshot.docs.at(-1) || null;
    for (const noteDoc of snapshot.docs) {
      if (noteDoc.data().archived === true) continue;
      matches.push(mapClientNote(noteDoc.id, clientId, noteDoc.data()));
      matchingCursors.push(noteDoc);
      if (matches.length > pageLimit) break;
    }
    if (matches.length > pageLimit) break;
    if (snapshot.docs.length < pageLimit) { exhausted = true; break; }
    scanCursor = lastRawCursor;
  }
  const items = matches.slice(0, pageLimit);
  if (matches.length > pageLimit) return { items, nextCursor: matchingCursors[pageLimit - 1] || null, hasMore: true };
  if (exhausted) return { items, nextCursor: null, hasMore: false };
  return { items, nextCursor: matchingCursors[items.length - 1] || lastRawCursor, hasMore: true };
}

export async function listClientNotes(user: AppUser | null, organizationId: string, clientId: string) {
  return (await listClientNotesPage(user, organizationId, clientId)).items;
}

export async function listArchivedClientNotes(user: AppUser | null, organizationId: string, clientId: string) {
  await requireActiveUser(user, organizationId);
  const snapshot = await getDocs(query(organizationSubcollection<Record<string, unknown>>(db, organizationId, 'clients', clientId, 'notes'), orderBy('createdAt', 'desc'), limit(100)));
  return snapshot.docs.filter((noteDoc) => noteDoc.data().archived === true).map((noteDoc) => mapClientNote(noteDoc.id, clientId, noteDoc.data()));
}

export async function archiveClientNote(user: AppUser | null, organizationId: string, clientId: string, noteId: string) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to archive a client note.');
  const batch = writeBatch(db);
  batch.update(organizationSubcollectionDocument(db, organizationId, 'clients', clientId, 'notes', noteId), { archived: true, archivedAt: serverTimestamp(), archivedBy: user.uid });
  addActivityToBatch(batch, organizationId, user, { type: 'note_archive', description: 'Note archived.', entityType: 'Note', entityId: noteId, metadata: { clientId, noteId } });
  await batch.commit();
}

export async function restoreClientNote(user: AppUser | null, organizationId: string, clientId: string, noteId: string) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to restore a client note.');
  const batch = writeBatch(db);
  batch.update(organizationSubcollectionDocument(db, organizationId, 'clients', clientId, 'notes', noteId), { archived: false, archivedAt: null, archivedBy: null });
  addActivityToBatch(batch, organizationId, user, { type: 'note_restore', description: 'Note restored.', entityType: 'Note', entityId: noteId, metadata: { clientId, noteId } });
  await batch.commit();
}

export async function permanentlyDeleteClientNote(user: AppUser | null, organizationId: string, clientId: string, noteId: string) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to delete a client note.');
  const response = await authenticatedFetch(`/api/organizations/${encodeURIComponent(organizationId)}/clients/${encodeURIComponent(clientId)}/notes/${encodeURIComponent(noteId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || 'Unable to permanently delete this note.');
}

function safeStorageFilename(filename: string) {
  const trimmed = filename.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return trimmed || 'document';
}

const ALLOWED_CLIENT_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
]);
const ALLOWED_CLIENT_DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png']);

function isSupportedClientDocument(file: File) {
  const extension = file.name.toLowerCase().split('.').pop() || '';
  return ALLOWED_CLIENT_DOCUMENT_TYPES.has(file.type) || ALLOWED_CLIENT_DOCUMENT_EXTENSIONS.has(extension);
}

function clientDocumentMimeType(file: File) {
  if (ALLOWED_CLIENT_DOCUMENT_TYPES.has(file.type)) return file.type;
  const extension = file.name.toLowerCase().split('.').pop() || '';
  return ({
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
  } as Record<string, string>)[extension] || 'application/octet-stream';
}

function mapClientDocument(id: string, clientId: string, data: Record<string, unknown>): DocumentItem {
  return {
    id,
    clientId,
    name: typeof data.name === 'string' ? data.name : 'Document',
    storagePath: typeof data.storagePath === 'string' ? data.storagePath : '',
    downloadURL: typeof data.downloadURL === 'string' ? data.downloadURL : undefined,
    mimeType: typeof data.mimeType === 'string' ? data.mimeType : 'application/octet-stream',
    size: typeof data.size === 'number' || typeof data.size === 'string' ? data.size : 0,
    uploadedAt: toIsoDate(data.uploadedAt),
    uploadedByUid: typeof data.uploadedByUid === 'string' ? data.uploadedByUid : typeof data.uploadedBy === 'string' ? data.uploadedBy : undefined,
    uploadedByName: typeof data.uploadedByName === 'string' ? data.uploadedByName : undefined,
    uploadedBy: typeof data.uploadedBy === 'string' ? data.uploadedBy : undefined,
    archived: data.archived === true,
    archivedAt: optionalIsoDate(data.archivedAt),
    archivedBy: typeof data.archivedBy === 'string' ? data.archivedBy : undefined,
  } satisfies DocumentItem;
}

export async function listClientDocumentsPage(user: AppUser | null, organizationId: string, clientId: string, cursor: FirestoreCursor = null, pageSize = 25): Promise<PageResult<DocumentItem>> {
  await requireActiveUser(user, organizationId);
  const documentsCollection = organizationSubcollection<Record<string, unknown>>(db, organizationId, 'clients', clientId, 'documents');
  const pageLimit = Math.max(1, Math.floor(pageSize));
  const matches: DocumentItem[] = [];
  const matchingCursors: FirestoreCursor[] = [];
  let scanCursor = cursor;
  let lastRawCursor: FirestoreCursor = null;
  let exhausted = false;
  for (let page = 0; page < 20 && matches.length <= pageLimit; page += 1) {
    const documentsQuery = query(documentsCollection, orderBy('uploadedAt', 'desc'), ...(scanCursor ? [startAfter(scanCursor)] : []), limit(pageLimit));
    const snapshot = await getDocs(documentsQuery);
    if (snapshot.empty) { exhausted = true; break; }
    lastRawCursor = snapshot.docs.at(-1) || null;
    for (const documentDoc of snapshot.docs) {
      if (documentDoc.data().archived === true) continue;
      matches.push(mapClientDocument(documentDoc.id, clientId, documentDoc.data()));
      matchingCursors.push(documentDoc);
      if (matches.length > pageLimit) break;
    }
    if (matches.length > pageLimit) break;
    if (snapshot.docs.length < pageLimit) { exhausted = true; break; }
    scanCursor = lastRawCursor;
  }
  const items = matches.slice(0, pageLimit);
  if (matches.length > pageLimit) return { items, nextCursor: matchingCursors[pageLimit - 1] || null, hasMore: true };
  if (exhausted) return { items, nextCursor: null, hasMore: false };
  return { items, nextCursor: matchingCursors[items.length - 1] || lastRawCursor, hasMore: true };
}

export async function listClientDocuments(user: AppUser | null, organizationId: string, clientId: string) {
  return (await listClientDocumentsPage(user, organizationId, clientId)).items;
}

export async function uploadClientDocument(user: AppUser | null, organizationId: string, clientId: string, file: File) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to upload a client document.');
  if (!file || file.size === 0) throw new Error('Please select a file to upload.');
  const sizeError = getClientDocumentSizeError(file.size);
  if (sizeError) throw new Error(sizeError);
  if (!isSupportedClientDocument(file)) throw new Error('That file type is not supported. Use PDF, DOC, DOCX, XLS, XLSX, JPG, JPEG, or PNG.');

  const clientSnapshot = await getDoc(organizationDocumentInCollection(db, organizationId, 'clients', clientId));
  if (!clientSnapshot.exists()) throw new Error('The selected client was not found.');
  if (clientSnapshot.data().archived === true || clientSnapshot.data().status === 'ARCHIVED') throw new Error('Documents cannot be uploaded to an archived client.');

  const documentRef = doc(organizationSubcollection<Record<string, unknown>>(db, organizationId, 'clients', clientId, 'documents'));
  const storagePath = `organizations/${organizationId}/clients/${clientId}/documents/${documentRef.id}/${safeStorageFilename(file.name)}`;
  const storageRef = ref(storage, storagePath);
  const mimeType = clientDocumentMimeType(file);
  let uploaded = false;

  try {
    await uploadBytes(storageRef, file, { contentType: mimeType });
    uploaded = true;
    const downloadURL = await getDownloadURL(storageRef);
    await setDoc(documentRef, {
      name: file.name,
      storagePath,
      downloadURL,
      mimeType,
      size: file.size,
      uploadedAt: serverTimestamp(),
      uploadedByUid: user.uid,
      uploadedByName: user.name,
      archived: false,
      archivedAt: null,
      archivedBy: null,
    });

    return {
      id: documentRef.id,
      clientId,
      name: file.name,
      storagePath,
      downloadURL,
      mimeType,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      uploadedByUid: user.uid,
      uploadedByName: user.name,
      archived: false,
    } satisfies DocumentItem;
  } catch (error) {
    if (uploaded) {
      await (async () => {
        await authenticatedFetch(`/api/organizations/${encodeURIComponent(organizationId)}/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(documentRef.id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storagePath }),
        });
      })().catch(() => undefined);
    }
    console.error('Unable to upload client document', error);
    if (error && typeof error === 'object' && 'code' in error && error.code === 'storage/unauthorized') {
      throw new Error('Upload failed. You do not have permission to upload documents for this client.');
    }
    throw new Error('Unable to upload the document. Please try again.');
  }
}

export async function listArchivedClientDocuments(user: AppUser | null, organizationId: string, clientId: string) {
  await requireActiveUser(user, organizationId);
  const snapshot = await getDocs(query(organizationSubcollection<Record<string, unknown>>(db, organizationId, 'clients', clientId, 'documents'), orderBy('uploadedAt', 'desc'), limit(100)));
  return snapshot.docs.filter((documentDoc) => documentDoc.data().archived === true).map((documentDoc) => {
    const data = documentDoc.data();
    return {
      id: documentDoc.id,
      clientId,
      name: typeof data.name === 'string' ? data.name : 'Document',
      storagePath: typeof data.storagePath === 'string' ? data.storagePath : '',
      downloadURL: typeof data.downloadURL === 'string' ? data.downloadURL : undefined,
      mimeType: typeof data.mimeType === 'string' ? data.mimeType : 'application/octet-stream',
      size: typeof data.size === 'number' || typeof data.size === 'string' ? data.size : 0,
      uploadedAt: toIsoDate(data.uploadedAt),
      uploadedByUid: typeof data.uploadedByUid === 'string' ? data.uploadedByUid : typeof data.uploadedBy === 'string' ? data.uploadedBy : undefined,
      uploadedByName: typeof data.uploadedByName === 'string' ? data.uploadedByName : undefined,
      uploadedBy: typeof data.uploadedBy === 'string' ? data.uploadedBy : undefined,
      archived: true,
      archivedAt: optionalIsoDate(data.archivedAt),
      archivedBy: typeof data.archivedBy === 'string' ? data.archivedBy : undefined,
    } satisfies DocumentItem;
  });
}

export async function archiveClientDocument(user: AppUser | null, organizationId: string, clientId: string, documentId: string) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to archive a client document.');
  await updateDoc(organizationSubcollectionDocument(db, organizationId, 'clients', clientId, 'documents', documentId), { archived: true, archivedAt: serverTimestamp(), archivedBy: user.uid });
}

export async function restoreClientDocument(user: AppUser | null, organizationId: string, clientId: string, documentId: string) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to restore a client document.');
  await updateDoc(organizationSubcollectionDocument(db, organizationId, 'clients', clientId, 'documents', documentId), { archived: false, archivedAt: null, archivedBy: null });
}

export async function permanentlyDeleteClientDocument(user: AppUser | null, organizationId: string, clientId: string, documentId: string) {
  await requireClientManager(user, organizationId);
  const endpoint = `/api/organizations/${encodeURIComponent(organizationId)}/clients/${encodeURIComponent(clientId)}/documents/${encodeURIComponent(documentId)}`;
  const response = await authenticatedFetch(endpoint, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || 'Unable to permanently delete the document. Please try again.');
  }
}
