import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';

export type FirestoreCursor = QueryDocumentSnapshot<DocumentData> | null;

export type PageResult<T> = {
  items: T[];
  nextCursor: FirestoreCursor;
  hasMore: boolean;
};

export const FIRESTORE_WORKSPACE_INDEX_ERROR = 'Workspace data is temporarily unavailable while the database index is being prepared. Please try again shortly.';

export function isFirestoreIndexError(error: unknown) {
  const candidate = error as { code?: string; message?: string };
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
  return code === 'failed-precondition'
    && /requires an index|index is (?:currently )?(?:being )?(?:built|building|prepared|used)|database index is being prepared/i.test(candidate.message || '');
}

export function firestoreQueryErrorMessage(error: unknown, fallback: string) {
  return isFirestoreIndexError(error)
    ? 'Data is temporarily unavailable while the database index is being prepared. Please try again shortly.'
    : fallback;
}

export function firestoreWorkspaceErrorMessage(error: unknown, fallback = 'Workspace information is not available yet.') {
  return isFirestoreIndexError(error) ? FIRESTORE_WORKSPACE_INDEX_ERROR : fallback;
}
