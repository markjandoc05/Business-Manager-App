type FirebaseTokenUser = { getIdToken: (forceRefresh?: boolean) => Promise<string> };

export async function requestBootstrapWithToken(
  firebaseUser: FirebaseTokenUser,
  forceRefresh: boolean,
  fetchImpl: typeof fetch = fetch,
) {
  const token = await firebaseUser.getIdToken(forceRefresh);
  if (!token) throw new Error('Unable to obtain a Firebase session token.');
  return fetchImpl('/api/auth/bootstrap', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function requestBootstrapWithOneRefresh(
  firebaseUser: FirebaseTokenUser,
  fetchImpl: typeof fetch = fetch,
) {
  let response = await requestBootstrapWithToken(firebaseUser, false, fetchImpl);
  if (response.status === 401) response = await requestBootstrapWithToken(firebaseUser, true, fetchImpl);
  return response;
}
