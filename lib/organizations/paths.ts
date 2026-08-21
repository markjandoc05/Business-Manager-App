import { collection, doc, type CollectionReference, type DocumentReference, type Firestore } from 'firebase/firestore';

export function organizationDocument(db: Firestore, organizationId: string) {
  return doc(db, 'organizations', organizationId);
}

export function organizationCollection<T = unknown>(db: Firestore, organizationId: string, collectionName: string) {
  return collection(db, 'organizations', organizationId, collectionName) as CollectionReference<T>;
}

export function organizationSubcollection<T = unknown>(db: Firestore, organizationId: string, collectionName: string, documentId: string, subcollectionName: string) {
  return collection(db, 'organizations', organizationId, collectionName, documentId, subcollectionName) as CollectionReference<T>;
}

export function organizationDocumentInCollection(db: Firestore, organizationId: string, collectionName: string, documentId: string) {
  return doc(db, 'organizations', organizationId, collectionName, documentId);
}

export function organizationSubcollectionDocument(db: Firestore, organizationId: string, collectionName: string, documentId: string, subcollectionName: string, subdocumentId: string) {
  return doc(db, 'organizations', organizationId, collectionName, documentId, subcollectionName, subdocumentId);
}

export function organizationMemberDocument(db: Firestore, organizationId: string, userId: string) {
  return doc(db, 'organizations', organizationId, 'members', userId) as DocumentReference;
}
