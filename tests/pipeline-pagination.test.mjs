import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { DEAL_STAGES, getDealStatusForStage } from '../lib/deal-workflow.ts';

function loadPaginationModule() {
  const source = readFileSync(new URL('../lib/repositories/pagination.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  new Function('exports', 'module', output)(compiled.exports, compiled);
  return compiled.exports;
}

const { appendUniqueById, splitLookaheadPage } = loadPaginationModule();

test('Pipeline lookahead pagination handles fewer than, exactly, and more than 100 Deals', () => {
  const deals = Array.from({ length: 101 }, (_, index) => ({ id: `deal-${index + 1}` }));
  assert.deepEqual(splitLookaheadPage(deals.slice(0, 50), 100), { items: deals.slice(0, 50), hasMore: false });
  assert.deepEqual(splitLookaheadPage(deals.slice(0, 100), 100), { items: deals.slice(0, 100), hasMore: false });

  const firstPage = splitLookaheadPage(deals, 100);
  assert.equal(firstPage.items.length, 100);
  assert.equal(firstPage.hasMore, true);
  const secondPage = splitLookaheadPage(deals.slice(100), 100);
  assert.deepEqual(appendUniqueById(firstPage.items, secondPage.items).map((deal) => deal.id), deals.map((deal) => deal.id));
});

test('additional Deal pages preserve order and cannot duplicate moving-boundary records', () => {
  const loaded = [{ id: 'newest' }, { id: 'boundary' }];
  const next = [{ id: 'boundary' }, { id: 'older' }];
  assert.deepEqual(appendUniqueById(loaded, next), [{ id: 'newest' }, { id: 'boundary' }, { id: 'older' }]);
});

test('Deal paging remains organization scoped, role scoped, and uses the existing createdAt cursor query', () => {
  const repository = readFileSync(new URL('../lib/repositories/deals.ts', import.meta.url), 'utf8');
  assert.match(repository, /export async function listDealsPage/);
  assert.match(repository, /organizationCollection<Record<string, unknown>>\(db, organizationId, 'deals'\)/);
  assert.match(repository, /where\('archived', '==', false\)/);
  assert.match(repository, /membership\.role === 'USER'.*where\('assignedToUid', '==', user\?\.uid\)/s);
  assert.match(repository, /orderBy\('createdAt', 'desc'\)/);
  assert.match(repository, /cursor \? \[startAfter\(cursor\)\]/);
  assert.match(repository, /limit\(normalizedPageSize \+ 1\)/);
});

test('Pipeline load-more requests fail closed across organization changes and reject duplicates', () => {
  const context = readFileSync(new URL('../context/AppContext.tsx', import.meta.url), 'utf8');
  assert.match(context, /dealsLoadMoreRef\.current/);
  assert.match(context, /requestId !== dealsRequestRef\.current \|\| organizationId !== currentOrganizationRef\.current/);
  assert.match(context, /appendUniqueById\(current, page\.items\)/);
  assert.match(context, /dealsOrganizationId === currentOrganizationId \? deals : \[\]/);
});

test('desktop Kanban and mobile stage tabs share the same filtered Deal state', () => {
  const pipeline = readFileSync(new URL('../app/pipeline/page.tsx', import.meta.url), 'utf8');
  assert.match(pipeline, /const dealsByStage = useMemo/);
  assert.match(pipeline, /const mobileStageDeals = dealsByStage\[mobileStage\]/);
  assert.match(pipeline, /const stageDeals = dealsByStage\[stage\]/);
  assert.match(pipeline, /role="tablist"/);
  assert.match(pipeline, /isMobile \? <div>/);
  assert.match(pipeline, /dragContextRef\.current === pipelineContextRef\.current/);
});

test('Pipeline copy discloses loaded-only search and filters and resets all supported filters', () => {
  const pipeline = readFileSync(new URL('../app/pipeline/page.tsx', import.meta.url), 'utf8');
  assert.match(pipeline, /Search loaded deals/);
  assert.match(pipeline, /loadedScope="Search and filters"/);
  assert.match(pipeline, /setStatusFilter\('All'\); setAssignedFilter\('All'\); setSearchTerm\(''\);/);
  assert.match(pipeline, /Load More Deals/);
});

test('canonical stages and Deal-to-Sale separation remain unchanged', () => {
  assert.deepEqual(DEAL_STAGES, ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost']);
  assert.equal(getDealStatusForStage('Won'), 'Won');
  assert.equal(getDealStatusForStage('Lost'), 'Lost');
  const pipeline = readFileSync(new URL('../app/pipeline/page.tsx', import.meta.url), 'utf8');
  const details = readFileSync(new URL('../components/DealDetailsModal.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(pipeline, /createSale|addSale/);
  assert.match(details, /Record as Sale/);
});
