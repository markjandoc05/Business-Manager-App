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

const FIREBASE_ERROR_CODES = new Set(['permission-denied', 'unauthenticated', 'not-found', 'failed-precondition', 'unavailable', 'deadline-exceeded', 'resource-exhausted', 'aborted', 'internal', 'cancelled']);

/** Convert Firebase/Firestore failures to safe UI copy while preserving our own validation errors. */
export function userFacingErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.') {
  const candidate = error as { code?: unknown; message?: unknown; name?: unknown } | null;
  const code = typeof candidate?.code === 'string' ? candidate.code.toLowerCase().replace(/^firebase\//, '').replace(/^auth\//, '') : '';
  const rawMessage = typeof candidate?.message === 'string' ? candidate.message : '';
  const normalized = rawMessage.toLowerCase();
  const firebaseLike = candidate?.name === 'FirebaseError'
    || FIREBASE_ERROR_CODES.has(code)
    || /missing or insufficient permissions|requires an index|failed-precondition|permission[-_ ]denied|unauthenticated|unavailable|firebase|firestore|databases\/|organizations\//i.test(rawMessage);
  if (!firebaseLike) return rawMessage || fallback;
  if (code === 'permission-denied' || /missing or insufficient permissions|permission[-_ ]denied/.test(normalized)) return "You don't have permission to perform this action.";
  if (code === 'unauthenticated' || /unauthenticated|login required|sign[ -]?in/.test(normalized)) return 'Your session has expired. Please sign in again.';
  if (code === 'not-found' || /not found|does not exist/.test(normalized)) return 'The requested record could not be found.';
  if (code === 'failed-precondition' || isFirestoreIndexError(error)) return 'This information is temporarily unavailable. Please try again.';
  if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'aborted' || /network|offline|temporarily unavailable/.test(normalized)) return 'Unable to connect. Please check your connection and try again.';
  return 'Something went wrong. Please try again.';
}
