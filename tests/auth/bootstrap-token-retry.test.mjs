import assert from 'node:assert/strict';
import test from 'node:test';
import { requestBootstrapWithOneRefresh } from '../../lib/auth/bootstrap-request.ts';

test('bootstrap retry sends the freshly forced-refreshed Firebase ID token', async () => {
  const tokens = ['TOKEN_A', 'TOKEN_B'];
  const refreshArguments = [];
  const authorizationHeaders = [];
  const triggerHeaders = [];
  const authEventHeaders = [];
  const firebaseUser = {
    getIdToken: async (forceRefresh) => {
      refreshArguments.push(forceRefresh);
      return tokens.shift();
    },
  };
  let requestNumber = 0;
  const fetchImpl = async (_input, init) => {
    const headers = new Headers(init.headers);
    authorizationHeaders.push(headers.get('Authorization'));
    triggerHeaders.push(headers.get('x-bootstrap-trigger'));
    authEventHeaders.push(headers.get('x-bootstrap-auth-event'));
    requestNumber += 1;
    return new Response(null, { status: requestNumber === 1 ? 401 : 200 });
  };

  const response = await requestBootstrapWithOneRefresh(firebaseUser, fetchImpl, {
    trigger: 'auth-state-repeat',
    authEvent: 2,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(refreshArguments, [false, true]);
  assert.deepEqual(authorizationHeaders, ['Bearer TOKEN_A', 'Bearer TOKEN_B']);
  assert.deepEqual(triggerHeaders, ['auth-state-repeat', 'auth-state-repeat']);
  assert.deepEqual(authEventHeaders, ['2', '2']);
  assert.notEqual(authorizationHeaders[0], authorizationHeaders[1]);
});
