import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadPaginationModule() {
  const source = readFileSync(new URL('../lib/repositories/pagination.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiled = { exports: {} };
  new Function('exports', 'module', output)(compiled.exports, compiled);
  return compiled.exports;
}

const { appendUniqueById } = loadPaginationModule();

test('cursor page append preserves order and removes duplicate record ids', () => {
  assert.deepEqual(
    appendUniqueById(
      [{ id: 'a', value: 1 }, { id: 'b', value: 2 }],
      [{ id: 'b', value: 20 }, { id: 'c', value: 3 }, { id: 'c', value: 30 }],
    ),
    [{ id: 'a', value: 1 }, { id: 'b', value: 2 }, { id: 'c', value: 3 }],
  );
});

test('cursor-backed CRM lists do not combine numbered pagination with Load More', () => {
  for (const path of ['../app/leads/page.tsx', '../app/clients/page.tsx', '../app/sales/page.tsx', '../app/catalog/page.tsx']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /TablePagination/);
    assert.match(source, /LoadedListStatus/);
    assert.match(source, /Load More/);
  }
});

test('load-more requests are gated and mutation refreshes preserve active query context', () => {
  const context = readFileSync(new URL('../context/AppContext.tsx', import.meta.url), 'utf8');
  const sales = readFileSync(new URL('../app/sales/page.tsx', import.meta.url), 'utf8');
  const leads = readFileSync(new URL('../app/leads/page.tsx', import.meta.url), 'utf8');
  const clients = readFileSync(new URL('../app/clients/page.tsx', import.meta.url), 'utf8');

  assert.match(context, /clientsLoadMoreRef\.current/);
  assert.match(context, /leadsLoadMoreRef\.current/);
  assert.match(context, /tasksLoadMoreRef\.current/);
  assert.match(sales, /loadMoreRequestRef\.current/);
  assert.match(leads, /refreshLeads\(\{ view: leadView, status: statusFilter, source: sourceFilter, search: searchTerm \}/);
  assert.match(clients, /refreshClients\(undefined, searchTerm, CLIENT_PAGE_SIZE\)/);
});
