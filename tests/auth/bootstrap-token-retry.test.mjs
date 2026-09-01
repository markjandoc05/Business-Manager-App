import assert from 'node:assert/strict';
import test from 'node:test';
import { requestBootstrapWithOneRefresh } from '../../lib/auth/bootstrap-request.ts';

test('bootstrap retry sends the freshly forced-refreshed Firebase ID token', async () => {
  const tokens = ['TOKEN_A', 'TOKEN_B'];
  const refreshArguments = [];
  const authorizationHeaders = [];
  const firebaseUser = {
    getIdToken: async (forceRefresh) => {
      refreshArguments.push(forceRefresh);
      return tokens.shift();
    },
  };
  let requestNumber = 0;
  const fetchImpl = async (_input, init) => {
    authorizationHeaders.push(new Headers(init.headers).get('Authorization'));
    requestNumber += 1;
    return new Response(null, { status: requestNumber === 1 ? 401 : 200 });
  };

  const response = await requestBootstrapWithOneRefresh(firebaseUser, fetchImpl);

  assert.equal(response.status, 200);
  assert.deepEqual(refreshArguments, [false, true]);
  assert.deepEqual(authorizationHeaders, ['Bearer TOKEN_A', 'Bearer TOKEN_B']);
  assert.notEqual(authorizationHeaders[0], authorizationHeaders[1]);
});
