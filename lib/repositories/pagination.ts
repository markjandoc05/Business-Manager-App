import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';

export type FirestoreCursor = QueryDocumentSnapshot<DocumentData> | null;

export type PageResult<T> = {
  items: T[];
  nextCursor: FirestoreCursor;
  hasMore: boolean;
};

export function isFirestoreIndexError(error: unknown) {
  const candidate = error as { code?: string; message?: string };
  return candidate.code === 'failed-precondition'
    && /requires an index|index is currently building/i.test(candidate.message || '');
}

export function firestoreQueryErrorMessage(error: unknown, fallback: string) {
  const message = (error as { message?: string } | null)?.message || '';
  return /database index is being prepared/i.test(message) || isFirestoreIndexError(error)
    ? 'Data is temporarily unavailable while the database index is being prepared. Please try again shortly.'
    : fallback;
}
