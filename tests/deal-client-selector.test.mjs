import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadSelectorModule() {
  const source = readFileSync(new URL('../lib/deal-client-selector.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  new Function('exports', 'module', output)(compiled.exports, compiled);
  return compiled.exports;
}

const {
  createDealClientSearchCache,
  DEAL_CLIENT_SEARCH_DEBOUNCE_MS,
  DEAL_CLIENT_SEARCH_LIMIT,
  DEAL_CLIENT_SEARCH_MIN_LENGTH,
  getInitialDealClientOptions,
} = loadSelectorModule();
const component = readFileSync(new URL('../components/DealClientSelector.tsx', import.meta.url), 'utf8');
const pipeline = readFileSync(new URL('../app/pipeline/page.tsx', import.meta.url), 'utf8');
const clientRepository = readFileSync(new URL('../lib/repositories/clients.ts', import.meta.url), 'utf8');
const dealRepository = readFileSync(new URL('../lib/repositories/deals.ts', import.meta.url), 'utf8');

test('loaded active Clients appear immediately while unavailable Clients are excluded', () => {
  const clients = [
    { id: 'active', status: 'ACTIVE' },
    { id: 'archived', status: 'ARCHIVED', archived: true },
    { id: 'trashed', status: 'ARCHIVED', archived: true, trashed: true },
  ];
  assert.deepEqual(getInitialDealClientOptions(clients).map((client) => client.id), ['active']);
});

test('Clients outside the first page use the existing server-backed search', () => {
  assert.match(component, /searchActiveClients\(user, organizationId, term, DEAL_CLIENT_SEARCH_LIMIT\)/);
  assert.match(clientRepository, /organizationCollection<Record<string, unknown>>\(db, organizationId, 'clients'\)/);
});

test('Client search and rendered results are bounded', () => {
  assert.equal(DEAL_CLIENT_SEARCH_LIMIT, 8);
  assert.match(clientRepository, /limit\(pageSize\)/);
  assert.match(component, /slice\(0, DEAL_CLIENT_SEARCH_LIMIT\)/);
});

test('typed Client search is debounced', () => {
  assert.equal(DEAL_CLIENT_SEARCH_DEBOUNCE_MS, 220);
  assert.equal(DEAL_CLIENT_SEARCH_MIN_LENGTH, 2);
  assert.match(component, /window\.setTimeout/);
});

test('duplicate concurrent searches share one request', async () => {
  const cache = createDealClientSearchCache();
  let reads = 0;
  let release;
  const deferred = new Promise((resolve) => { release = resolve; });
  const loader = async () => { reads += 1; await deferred; return [{ id: 'client-1' }]; };
  const first = cache.resolve('org-a', 'acme', loader);
  const second = cache.resolve('org-a', 'acme', loader);
  release();
  assert.deepEqual(await Promise.all([first, second]), [[{ id: 'client-1' }], [{ id: 'client-1' }]]);
  assert.equal(reads, 1);
});

test('stale requests cannot overwrite a newer search or repopulate a cleared cache', async () => {
  assert.match(component, /requestId !== requestRef\.current/);
  const cache = createDealClientSearchCache();
  let release;
  const deferred = new Promise((resolve) => { release = resolve; });
  const oldRequest = cache.resolve('org-a', 'old', async () => { await deferred; return [{ id: 'old-client' }]; });
  await Promise.resolve();
  cache.clear();
  release();
  await oldRequest;
  let reads = 0;
  await cache.resolve('org-a', 'old', async () => { reads += 1; return []; });
  assert.equal(reads, 1);
});

test('the selector provides an explicit no-result state', () => {
  assert.match(component, /No matching active Clients found/);
  assert.match(component, /No active Clients available/);
});

test('the selected Client is held separately from changing search results', () => {
  assert.match(component, /selectedClient\.name/);
  assert.match(component, /const selectClient/);
  assert.match(component, /onSelect\(client\)/);
  assert.match(pipeline, /dealClientSelection/);
});

test('the rendered selector exposes listbox semantics and keyboard selection controls', () => {
  assert.match(component, /role="combobox"/);
  assert.match(component, /role="listbox"/);
  assert.match(component, /role="option"/);
  assert.match(component, /aria-activedescendant/);
  assert.match(component, /event\.key === 'ArrowDown'/);
  assert.match(component, /event\.key === 'ArrowUp'/);
  assert.match(component, /event\.key === 'Enter'/);
  assert.match(component, /event\.key === 'Escape'/);
});

test('missing, archived, or trashed Clients fail repository validation safely', () => {
  assert.match(dealRepository, /!clientSnapshot\.exists\(\)/);
  assert.match(dealRepository, /client\?\.status === 'ARCHIVED'/);
  assert.match(dealRepository, /client\?\.archived === true/);
  assert.match(dealRepository, /client\?\.trashed === true/);
});

test('search cache entries are isolated by organization', async () => {
  const cache = createDealClientSearchCache();
  await cache.resolve('org-a', 'acme', async () => [{ id: 'org-a-client' }]);
  const result = await cache.resolve('org-b', 'acme', async () => [{ id: 'org-b-client' }]);
  assert.deepEqual(result, [{ id: 'org-b-client' }]);
});

test('workspace switching clears prior selection and remounts scoped search state', () => {
  assert.match(pipeline, /setDealClientSelection\(null\)/);
  assert.match(pipeline, /clientId: ''/);
  assert.match(pipeline, /<DealClientSelector key=\{currentOrganizationId\}/);
});

test('Deal creation requires a selected Client whose id matches the submitted clientId', () => {
  assert.match(pipeline, /!selectedDealClient \|\| selectedDealClient\.id !== dealForm\.clientId/);
  assert.match(pipeline, /disabled=\{saving \|\| !selectedDealClient\}/);
  assert.match(dealRepository, /await requireExistingClient\(organizationId, input\.clientId\)/);
});

test('the existing Deal creation repository path remains in use', () => {
  assert.match(pipeline, /await addDeal\(dealForm\)/);
  assert.match(dealRepository, /export async function createDeal/);
});

test('Deal-to-Sale separation remains unchanged', () => {
  assert.doesNotMatch(component, /createSale|addSale|payment/i);
  assert.doesNotMatch(pipeline, /createSale|addSale/);
});
