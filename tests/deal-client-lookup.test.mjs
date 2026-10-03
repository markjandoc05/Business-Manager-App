import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadLookupModule() {
  const source = readFileSync(new URL('../lib/client-lookup.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  new Function('exports', 'module', output)(compiled.exports, compiled);
  return compiled.exports;
}

const { createOrganizationClientLookupCache, matchesDealLookupSearch, uniqueRelatedClientIds } = loadLookupModule();

test('a Deal whose Client is already loaded does not issue a targeted read', async () => {
  const cache = createOrganizationClientLookupCache();
  cache.prime('org-a', 'client-1', { id: 'client-1', name: 'Acme' });
  let reads = 0;
  assert.deepEqual(await cache.resolve('org-a', 'client-1', async () => { reads += 1; return null; }), { id: 'client-1', name: 'Acme' });
  assert.equal(reads, 0);
});

test('a Deal whose Client is outside the current page is resolved by id', async () => {
  const cache = createOrganizationClientLookupCache();
  const client = await cache.resolve('org-a', 'client-older', async () => ({ id: 'client-older', name: 'Older Client' }));
  assert.equal(client?.name, 'Older Client');
  assert.equal(cache.read('org-a', 'client-older').value?.name, 'Older Client');
});

test('multiple Deals sharing a Client produce one unique lookup id', () => {
  assert.deepEqual(uniqueRelatedClientIds([{ clientId: 'client-1' }, { clientId: 'client-1' }, { clientId: 'client-2' }]), ['client-1', 'client-2']);
});

test('concurrent duplicate lookups share one request', async () => {
  const cache = createOrganizationClientLookupCache();
  let reads = 0;
  let release;
  const deferred = new Promise((resolve) => { release = resolve; });
  const loader = async () => { reads += 1; await deferred; return { id: 'client-1', name: 'Acme' }; };
  const first = cache.resolve('org-a', 'client-1', loader);
  const second = cache.resolve('org-a', 'client-1', loader);
  release();
  assert.deepEqual(await Promise.all([first, second]), [{ id: 'client-1', name: 'Acme' }, { id: 'client-1', name: 'Acme' }]);
  assert.equal(reads, 1);
});

test('archived Clients remain available for historical Deal display', async () => {
  const cache = createOrganizationClientLookupCache();
  const client = await cache.resolve('org-a', 'client-archived', async () => ({ id: 'client-archived', name: 'Archived Client', archived: true, status: 'ARCHIVED' }));
  assert.equal(client?.name, 'Archived Client');
  assert.equal(client?.archived, true);
});

test('missing or trashed Clients use a cached unavailable result', async () => {
  const cache = createOrganizationClientLookupCache();
  let reads = 0;
  const loader = async () => { reads += 1; return null; };
  assert.equal(await cache.resolve('org-a', 'client-missing', loader), null);
  assert.equal(await cache.resolve('org-a', 'client-missing', loader), null);
  assert.equal(reads, 1);
});

test('workspace switching clears Client display values immediately', () => {
  const cache = createOrganizationClientLookupCache();
  cache.prime('org-a', 'client-1', { id: 'client-1', name: 'Organization A Client' });
  cache.clear();
  assert.deepEqual(cache.read('org-a', 'client-1'), { found: false });
});

test('a stale lookup cannot repopulate the cache after a workspace switch', async () => {
  const cache = createOrganizationClientLookupCache();
  let release;
  const deferred = new Promise((resolve) => { release = resolve; });
  const request = cache.resolve('org-a', 'client-1', async () => { await deferred; return { id: 'client-1', name: 'Old Tenant Client' }; });
  await Promise.resolve();
  cache.clear();
  release();
  await request;
  assert.deepEqual(cache.read('org-a', 'client-1'), { found: false });
});

test('the same Client id in two organizations never shares a cached value', async () => {
  const cache = createOrganizationClientLookupCache();
  cache.prime('org-a', 'client-1', { id: 'client-1', name: 'Organization A Client' });
  const client = await cache.resolve('org-b', 'client-1', async () => ({ id: 'client-1', name: 'Organization B Client' }));
  assert.equal(client?.name, 'Organization B Client');
  assert.equal(cache.read('org-a', 'client-1').value?.name, 'Organization A Client');
});

test('Pipeline Client-name search uses the resolved Client display', () => {
  assert.equal(matchesDealLookupSearch({ dealTitle: 'Renewal', clientName: 'Northstar Studio', productServiceName: 'Support' }, 'northstar'), true);
  assert.equal(matchesDealLookupSearch({ dealTitle: 'Renewal', clientName: 'Northstar Studio', productServiceName: 'Support' }, 'unrelated'), false);
});

test('Pipeline Client resolution uses direct organization-scoped document reads, not a Client collection load', () => {
  const repository = readFileSync(new URL('../lib/repositories/clients.ts', import.meta.url), 'utf8');
  const directLookup = repository.match(/export async function getClientDisplayById[\s\S]*?\n\}/)?.[0] || '';
  const hook = readFileSync(new URL('../hooks/use-deal-client-lookup.ts', import.meta.url), 'utf8');
  assert.match(directLookup, /getAccessibleClientById\(user, organizationId, clientId\)/);
  assert.doesNotMatch(directLookup, /getDocs|listClients/);
  assert.match(hook, /LOOKUP_CONCURRENCY = 6/);
  assert.match(hook, /getClientDisplayById\(user, organizationId, clientId\)/);
});

test('Client lookup does not alter Deal-to-Sale separation', () => {
  const pipeline = readFileSync(new URL('../app/pipeline/page.tsx', import.meta.url), 'utf8');
  const lookup = readFileSync(new URL('../lib/client-lookup.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(lookup, /createSale|addSale|payment/i);
  assert.doesNotMatch(pipeline, /createSale|addSale/);
});
