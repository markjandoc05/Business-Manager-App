import { addDoc, collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import type { Client, DocumentItem, Note } from '@/types';
import { requireOrganizationAccess } from '@/lib/permissions';
import { resolveAssignment } from '@/lib/ownership';
import { organizationCollection, organizationDocumentInCollection, organizationSubcollection, organizationSubcollectionDocument } from '@/lib/organizations/paths';

export type ClientInput = Pick<Client, 'name' | 'company' | 'email' | 'phone' | 'assignedToUid' | 'assignedToName'>;

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
    assignedToUid: typeof data.assignedToUid === 'string' ? data.assignedToUid : '',
    assignedToName: typeof data.assignedToName === 'string' ? data.assignedToName : typeof data.assignedTo === 'string' ? data.assignedTo : '',
    assignedTo: typeof data.assignedTo === 'string' ? data.assignedTo : undefined,
    status: data.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
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

export async function listClients(user: AppUser | null, organizationId: string) {
  await requireActiveUser(user, organizationId);
  const snapshot = await getDocs(organizationCollection<Record<string, unknown>>(db, organizationId, 'clients'));
  return snapshot.docs
    .map((clientDoc) => mapClient(clientDoc.id, clientDoc.data()))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createClient(user: AppUser | null, organizationId: string, input: ClientInput) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to create a client.');

  const assignment = await resolveAssignment(user, organizationId, input.assignedToUid, input.assignedToName);
  const clientRef = await addDoc(organizationCollection<Record<string, unknown>>(db, organizationId, 'clients'), {
    ...input,
    company: input.company || '',
    ...assignment,
    status: 'ACTIVE',
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });

  return mapClient(clientRef.id, { ...input, ...assignment, status: 'ACTIVE', createdAt: new Date().toISOString(), createdBy: user.uid, updatedAt: new Date().toISOString(), updatedBy: user.uid });
}

export async function updateClient(user: AppUser | null, organizationId: string, clientId: string, input: ClientInput) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to update a client.');

  await updateDoc(organizationDocumentInCollection(db, organizationId, 'clients', clientId), {
    ...input,
    company: input.company || '',
    assignedToUid: input.assignedToUid || '',
    assignedToName: input.assignedToName || '',
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
}

export async function archiveClient(user: AppUser | null, organizationId: string, clientId: string) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to archive a client.');

  await updateDoc(organizationDocumentInCollection(db, organizationId, 'clients', clientId), {
    status: 'ARCHIVED',
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  });
}

export async function addClientNote(user: AppUser | null, organizationId: string, clientId: string, content: string) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to create a client note.');

  const noteRef = await addDoc(organizationSubcollection(db, organizationId, 'clients', clientId, 'notes'), {
    content,
    createdAt: serverTimestamp(),
    createdByUid: user.uid,
    createdByName: user.name,
  });

  return {
    id: noteRef.id,
    clientId,
    content,
    author: user.name,
    createdByUid: user.uid,
    createdByName: user.name,
    createdAt: new Date().toISOString(),
  } satisfies Note;
}

export async function listClientNotes(user: AppUser | null, organizationId: string, clientId: string) {
  await requireActiveUser(user, organizationId);
  const snapshot = await getDocs(organizationSubcollection<Record<string, unknown>>(db, organizationId, 'clients', clientId, 'notes'));
  return snapshot.docs.map((noteDoc) => {
    const data = noteDoc.data();
    return {
      id: noteDoc.id,
      clientId,
      content: typeof data.content === 'string' ? data.content : '',
      author: typeof data.createdByName === 'string' ? data.createdByName : typeof data.authorName === 'string' ? data.authorName : '',
      createdByUid: typeof data.createdByUid === 'string' ? data.createdByUid : typeof data.createdBy === 'string' ? data.createdBy : undefined,
      createdByName: typeof data.createdByName === 'string' ? data.createdByName : typeof data.authorName === 'string' ? data.authorName : undefined,
      createdAt: toIsoDate(data.createdAt),
    } satisfies Note;
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function safeStorageFilename(filename: string) {
  const trimmed = filename.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return trimmed || 'document';
}

export async function listClientDocuments(user: AppUser | null, organizationId: string, clientId: string) {
  await requireActiveUser(user, organizationId);
  const snapshot = await getDocs(organizationSubcollection<Record<string, unknown>>(db, organizationId, 'clients', clientId, 'documents'));
  return snapshot.docs.map((documentDoc) => {
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
      uploadedBy: typeof data.uploadedBy === 'string' ? data.uploadedBy : undefined,
    } satisfies DocumentItem;
  }).sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
}

export async function uploadClientDocument(user: AppUser | null, organizationId: string, clientId: string, file: File) {
  await requireClientManager(user, organizationId);
  if (!user) throw new Error('You must be signed in to upload a client document.');
  if (!file || file.size === 0) throw new Error('Please select a file to upload.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Files must be 10 MB or smaller.');

  const clientSnapshot = await getDoc(organizationDocumentInCollection(db, organizationId, 'clients', clientId));
  if (!clientSnapshot.exists()) throw new Error('The selected client was not found.');

  const documentRef = doc(organizationSubcollection<Record<string, unknown>>(db, organizationId, 'clients', clientId, 'documents'));
  const storagePath = `organizations/${organizationId}/clients/${clientId}/documents/${documentRef.id}/${safeStorageFilename(file.name)}`;
  const storageRef = ref(storage, storagePath);
  let uploaded = false;

  try {
    await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' });
    uploaded = true;
    const downloadURL = await getDownloadURL(storageRef);
    await setDoc(documentRef, {
      name: file.name,
      storagePath,
      downloadURL,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      uploadedAt: serverTimestamp(),
      uploadedBy: user.uid,
    });

    return {
      id: documentRef.id,
      clientId,
      name: file.name,
      storagePath,
      downloadURL,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user.uid,
    } satisfies DocumentItem;
  } catch (error) {
    if (uploaded) await deleteObject(storageRef).catch(() => undefined);
    console.error('Unable to upload client document', error);
    throw new Error('Unable to upload the document. Please try again.');
  }
}
