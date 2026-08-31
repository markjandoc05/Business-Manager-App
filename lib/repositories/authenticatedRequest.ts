import { signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { clearCachedRequests } from '@/lib/repositories/requestCache';

async function requestWithToken(input: RequestInfo | URL, init: RequestInit | undefined, forceRefresh: boolean) {
  await auth.authStateReady();
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error('Authentication is required.');
  const token = await firebaseUser.getIdToken(forceRefresh);
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}

/**
 * Send a protected API request with one token refresh retry. A persistent 401
 * means the Firebase session is no longer usable; clear local authorization
 * state and let AuthContext's listener complete the sign-out transition.
 */
export async function authenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  let response: Response;
  try {
    response = await requestWithToken(input, init, false);
    if (response.status === 401) response = await requestWithToken(input, init, true);
  } catch (error) {
    clearCachedRequests();
    void firebaseSignOut(auth).catch(() => undefined);
    throw error;
  }

  if (response.status === 401) {
    clearCachedRequests();
    void firebaseSignOut(auth).catch(() => undefined);
  } else if (response.status === 403) {
    clearCachedRequests();
  }
  return response;
}
