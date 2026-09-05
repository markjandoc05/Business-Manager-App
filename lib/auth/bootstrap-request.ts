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
  const token = await firebaseUser.getIdToken(forceRefresh);
  if (!token) throw new Error('Unable to obtain a Firebase session token.');
  return fetchImpl('/api/auth/bootstrap', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(diagnostics ? {
        'x-bootstrap-trigger': diagnostics.trigger,
        'x-bootstrap-auth-event': String(diagnostics.authEvent),
      } : {}),
    },
  });
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
