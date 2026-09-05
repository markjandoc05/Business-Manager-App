import { markStartupEvent, recordStartupServerTiming } from '@/lib/startupTiming';

type FirebaseTokenUser = { getIdToken: (forceRefresh?: boolean) => Promise<string> };
export type BootstrapRequestDiagnostics = {
  trigger: 'auth-state-initial' | 'auth-state-user-change' | 'auth-state-repeat' | 'manual-retry';
  authEvent: number;
};

export async function requestBootstrapWithToken(
  firebaseUser: FirebaseTokenUser,
  forceRefresh: boolean,
  fetchImpl: typeof fetch = fetch,
  diagnostics?: BootstrapRequestDiagnostics,
) {
  markStartupEvent('TOKEN_REQUEST_START');
  const token = await firebaseUser.getIdToken(forceRefresh);
  if (!token) throw new Error('Unable to obtain a Firebase session token.');
  markStartupEvent('TOKEN_READY');
  markStartupEvent('BOOTSTRAP_REQUEST_START');
  const response = await fetchImpl('/api/auth/bootstrap', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(diagnostics ? {
        'x-bootstrap-trigger': diagnostics.trigger,
        'x-bootstrap-auth-event': String(diagnostics.authEvent),
      } : {}),
    },
  });
  markStartupEvent('BOOTSTRAP_RESPONSE_RECEIVED');
  recordStartupServerTiming(response.headers.get('server-timing'));
  return response;
}

export async function requestBootstrapWithOneRefresh(
  firebaseUser: FirebaseTokenUser,
  fetchImpl: typeof fetch = fetch,
  diagnostics?: BootstrapRequestDiagnostics,
) {
  let response = await requestBootstrapWithToken(firebaseUser, false, fetchImpl, diagnostics);
  if (response.status === 401) response = await requestBootstrapWithToken(firebaseUser, true, fetchImpl, diagnostics);
  return response;
}
