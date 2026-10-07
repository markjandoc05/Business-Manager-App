import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repositoryFixture } from './helpers/repository-fixture.mjs';
for (const action of ['prefix invalidation', 'identity clear']) test(`${action} prevents older in-flight data from serving or repopulating a newer cache`, async () => {
  const {cachedRequest, clearCachedRequests, invalidateCachedRequest} = repositoryFixture().load('lib/repositories/requestCache.ts');
  clearCachedRequests(); let resolveOld; let calls = 0;
  const old = cachedRequest('metric:org', 60000, () => { calls++; return new Promise(resolve => { resolveOld = resolve; }); });
  if (action === 'prefix invalidation') invalidateCachedRequest('metric:'); else clearCachedRequests();
  const fresh = cachedRequest('metric:org', 60000, async () => { calls++; return 'fresh'; });
  resolveOld('stale'); assert.equal(await fresh, 'fresh'); assert.equal(await old, 'stale');
  assert.equal(await cachedRequest('metric:org', 60000, async () => { throw new Error('Unexpected refetch'); }), 'fresh'); assert.equal(calls, 2);
});
