import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

function session({ transport, token = async () => 'synthetic-emulator-token' }) {
  const refreshes = []; let signOuts = 0; let cacheClears = 0;
  const auth = { authStateReady: async () => {}, currentUser: { getIdToken: async (refresh) => { refreshes.push(refresh); return token(refresh); } } };
  const dependencies = {
    'firebase/auth': { signOut: async () => { signOuts++; } },
    '@/lib/firebase/client': { auth },
    '@/lib/repositories/requestCache': { clearCachedRequests: () => { cacheClears++; } },
  };
  const fixtureModule = { exports: {} };
  const source = ts.transpileModule(readFileSync('lib/repositories/authenticatedRequest.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(source, { module: fixtureModule, exports: fixtureModule.exports, Headers, fetch: transport, require: (name) => { assert.ok(Object.hasOwn(dependencies, name)); return dependencies[name]; } });
  return { request: fixtureModule.exports.authenticatedFetch, refreshes, state: () => ({ signOuts, cacheClears }) };
}

test('lost HTTP response preserves the authenticated session and lets the caller retry', async () => {
  let requests = 0;
  const failure = new TypeError('Failed to fetch');
  const s = session({ transport: async () => { if (++requests === 1) throw failure; return new Response('{}'); } });
  await assert.rejects(s.request('/synthetic'), (error) => error === failure);
  assert.deepEqual(s.state(), { signOuts: 0, cacheClears: 0 });
  assert.equal((await s.request('/synthetic')).status, 200);
  assert.deepEqual(s.refreshes, [false, false]);
});

test('temporary token service failure preserves the session', async () => {
  const failure = Object.assign(new Error('Token service unavailable'), { code: 'auth/network-request-failed' });
  const s = session({ token: async () => { throw failure; }, transport: async () => { throw new Error('Unexpected HTTP request'); } });
  await assert.rejects(s.request('/synthetic'), (error) => error === failure);
  assert.deepEqual(s.state(), { signOuts: 0, cacheClears: 0 });
});

test('401 refresh succeeds without signing out; repeated 401 signs out and clears authorization cache', async () => {
  for (const secondStatus of [200, 401]) {
    let requests = 0;
    const s = session({ transport: async () => new Response('{}', { status: ++requests === 1 ? 401 : secondStatus }) });
    assert.equal((await s.request('/synthetic')).status, secondStatus);
    assert.deepEqual(s.refreshes, [false, true]);
    assert.deepEqual(s.state(), secondStatus === 401 ? { signOuts: 1, cacheClears: 1 } : { signOuts: 0, cacheClears: 0 });
  }
});

test('403 clears cached authorization without signing out; server failure preserves retry state', async () => {
  for (const status of [403, 500]) {
    const s = session({ transport: async () => new Response('{}', { status }) });
    assert.equal((await s.request('/synthetic')).status, status);
    assert.deepEqual(s.state(), { signOuts: 0, cacheClears: status === 403 ? 1 : 0 });
  }
});

for (const code of ['auth/user-disabled', 'auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-not-found']) {
  test(`${code} still clears authorization and signs out`, async () => {
    const failure = Object.assign(new Error(code), { code });
    const s = session({ token: async () => { throw failure; }, transport: async () => { throw new Error('Unexpected HTTP request'); } });
    await assert.rejects(s.request('/synthetic'), (error) => error === failure);
    assert.deepEqual(s.state(), { signOuts: 1, cacheClears: 1 });
  });
}
