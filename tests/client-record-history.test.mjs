import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { test } from 'node:test';
import { repositoryFixture } from './helpers/repository-fixture.mjs';
import { createPagedRecordFeed } from '../lib/paged-record-feed.ts';

test('Client Deals and Tasks traverse past global limits, with independent archive and assignment cursors', async () => {
  for (const role of ['ADMIN', 'MANAGER', 'USER']) {
    const f = repositoryFixture(role); const deals = f.load('lib/repositories/deals.ts'); const tasks = f.load('lib/repositories/tasks.ts');
    for (let i = 0; i < 200; i++) {
      const common = { archived: false, assignedToUid: f.user.uid, createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString() };
      f.records.set(`${f.prefix}/deals/other-${i}`, { ...common, clientId: 'other-client' });
      f.records.set(`${f.prefix}/tasks/other-${i}`, { ...common, relatedTo: { type: 'Client', id: 'other-client' } });
    }
    for (let i = 0; i < 70; i++) {
      const common = { archived: false, assignedToUid: i % 2 ? 'another-user' : f.user.uid, createdAt: new Date(2025, 0, 1, 0, 0, i).toISOString() };
      f.records.set(`${f.prefix}/deals/history-${i}`, { ...common, clientId: 'client', stage: 'New', status: 'Active' });
      f.records.set(`${f.prefix}/tasks/history-${i}`, { ...common, status: i % 3 ? 'Pending' : 'Completed', relatedTo: { type: 'Client', id: 'client' } });
    }
    const oldDeals = await deals.listDealsPage(f.user, f.org, null, 100);
    const oldTasks = await tasks.listTasksPage(f.user, f.org);
    assert.equal(oldDeals.items.filter((item) => item.clientId === 'client').length, 0);
    assert.equal(oldTasks.items.filter((item) => item.relatedTo?.id === 'client').length, 0);
    for (const [name, repository, loader] of [['deals', deals, deals.listClientDealsPage], ['tasks', tasks, tasks.listClientTasksPage]]) {
      let cursor = null; const ids = [];
      do { const page = await loader(f.user, f.org, 'client', cursor); ids.push(...Array.from(page.items, (item) => item.id)); cursor = page.nextCursor; assert.equal(page.hasMore, Boolean(cursor)); } while (cursor);
      assert.equal(ids.length, role === 'USER' ? 35 : 70); assert.equal(new Set(ids).size, ids.length);
      const archived = { archived: true, createdAt: '2024-01-01T00:00:00.000Z', assignedToUid: f.user.uid, clientId: 'client', relatedTo: { type: 'Client', id: 'client' } };
      f.records.set(`${f.prefix}/${name}/archived`, archived);
      const page = await loader(f.user, f.org, 'client', null, true); assert.equal(page.items.length, 1); assert.equal(page.items[0].id, 'archived');
      assert.ok(repository);
    }
    const queries = f.reads.filter((read) => typeof read === 'object' && read.constraints?.some((c) => c.name === 'clientId' || c.name === 'relatedTo.id'));
    assert.equal(queries.every((q) => q.constraints.some((c) => c.name === 'assignedToUid') === (role === 'USER')), true);
    await assert.rejects(deals.listClientDealsPage(f.user, 'other-org', 'client'));
  }
});

test('cursor failures retain loaded history and retry the same position without duplicates', async () => {
  let calls = 0;
  const feed = createPagedRecordFeed(async (cursor) => {
    calls++;
    if (cursor === null) return { items: [{ id: 'first' }], nextCursor: 'first', hasMore: true };
    if (calls === 2) throw new Error('Synthetic network failure');
    assert.equal(cursor, 'first'); return { items: [{ id: 'first' }, { id: 'second' }], nextCursor: null, hasMore: false };
  });
  await feed.start(); assert.equal(await feed.loadMore(), false); assert.equal(feed.snapshot().items.length, 1);
  assert.equal(feed.snapshot().cursor, 'first'); assert.ok(feed.snapshot().error);
  assert.equal(await feed.retry(), true); assert.deepEqual(feed.snapshot().items.map((item) => item.id), ['first', 'second']);
});
test('refresh retains older selected records and reloads every previously loaded page', async () => {
  let resolveRefresh; let refreshing = false; const cursors = [];
  const feed = createPagedRecordFeed(async (cursor) => {
    cursors.push(cursor);
    if (refreshing && cursor === null) await new Promise((resolve) => { resolveRefresh = resolve; });
    return cursor === null ? { items: [{ id: 'first' }], nextCursor: 'first', hasMore: true } : { items: [{ id: 'older-selected' }], nextCursor: 'older-selected', hasMore: true };
  });
  await feed.start(); await feed.loadMore(); refreshing = true;
  const refresh = feed.refresh(); assert.equal(feed.snapshot().loading, true);
  assert.ok(feed.snapshot().items.find((row) => row.id === 'older-selected'));
  resolveRefresh(); await refresh;
  assert.deepEqual(cursors, [null, 'first', null, 'first']);
  assert.ok(feed.snapshot().items.find((row) => row.id === 'older-selected'));
  assert.equal(feed.snapshot().cursor, 'older-selected');
});
test('refresh failure retains history and supersedes an older in-flight request', async () => {
  let rejectRefresh; let resolveMore; let refreshMode = false;
  const feed = createPagedRecordFeed(async (cursor) => {
    if (refreshMode) return new Promise((_, reject) => { rejectRefresh = reject; });
    return cursor === null ? { items: [{ id: 'first' }], nextCursor: 'first', hasMore: true } : new Promise((resolve) => { resolveMore = resolve; });
  });
  await feed.start(); const more = feed.loadMore(); refreshMode = true; const refresh = feed.refresh();
  rejectRefresh(new Error('Synthetic refresh failure')); assert.equal(await refresh, false);
  resolveMore({ items: [{ id: 'obsolete' }], nextCursor: null, hasMore: false }); assert.equal(await more, false);
  assert.deepEqual(feed.snapshot().items.map((row) => row.id), ['first']); assert.equal(feed.snapshot().cursor, 'first'); assert.ok(feed.snapshot().error);
});
test('disposed identity/Client requests and Strict Mode replay cannot install late history', async () => {
  let resolveOld; let calls = 0;
  const feed = createPagedRecordFeed(() => ++calls === 1 ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve({ items: [{ id: 'new-scope' }], nextCursor: null, hasMore: false }));
  const old = feed.start(); feed.dispose(); await feed.start();
  resolveOld({ items: [{ id: 'old-scope' }], nextCursor: null, hasMore: false }); await old;
  assert.deepEqual(feed.snapshot().items.map((item) => item.id), ['new-scope']);
  const freshIdentity = createPagedRecordFeed(async () => ({ items: [], nextCursor: null, hasMore: false }));
  assert.deepEqual(freshIdentity.snapshot().items, []);
});
test('concurrent Load More requests share the busy boundary and do not skip pages', async () => {
  let resolveNext; let calls = 0;
  const feed = createPagedRecordFeed(async (cursor) => { calls++; return cursor === null ? { items: [{ id: 'first' }], nextCursor: 'first', hasMore: true } : new Promise((resolve) => { resolveNext = resolve; }); });
  await feed.start(); const first = feed.loadMore(); assert.equal(await feed.loadMore(), false);
  resolveNext({ items: [{ id: 'second' }], nextCursor: null, hasMore: false }); await first;
  assert.equal(calls, 2); assert.equal(feed.snapshot().items.length, 2);
});
test('actual AppContext completion callback resolves a Task outside its global first page', async () => {
  const f = repositoryFixture(); const tasks = f.load('lib/repositories/tasks.ts');
  f.records.set(`${f.prefix}/tasks/older`, { title: 'Older Task', status: 'Pending', assignedToUid: f.user.uid });
  const baseline = process.env.VENTALE_REPOSITORY_BASELINE;
  if (baseline) assert.match(baseline, /^[a-f0-9]{7,40}$/);
  const source = baseline ? execFileSync('git', ['show', `${baseline}:context/AppContext.tsx`], { encoding: 'utf8' }) : fs.readFileSync('context/AppContext.tsx', 'utf8');
  const block = source.slice(source.indexOf('  const completeTask = async'), source.indexOf('  const archiveTask = async'));
  const compiled = ts.transpileModule(`export ${block.trim()}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const fixtureModule = { exports: {} };
  vm.runInNewContext(compiled, { module: fixtureModule, exports: fixtureModule.exports, user: f.user, tasks: [], tasksOrganizationId: f.org, currentOrganizationId: f.org, currentOrganizationRef: { current: f.org }, requireWritableLicense: () => {}, getTaskByIdRepository: tasks.getTaskById, completeTaskRepository: tasks.completeTask, invalidateDashboardMetrics: () => {}, setTasks: () => {}, setLeadTasks: () => {}, Date, Error });
  await fixtureModule.exports.completeTask('older'); assert.equal(f.records.get(`${f.prefix}/tasks/older`).status, 'Completed');
});
test('Client completion controls cannot toggle stale retained rows during refresh or after refresh failure', async () => {
  const source = fs.readFileSync('app/clients/page.tsx', 'utf8');
  const block = source.slice(source.indexOf('  const handleCompleteTask = async'), source.indexOf('  const openAddTask ='));
  const compiled = ts.transpileModule(`export ${block.trim()}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const fixtureModule = { exports: {} }; const history = { loading: false, error: null }; let writes = 0;
  vm.runInNewContext(compiled, { module: fixtureModule, exports: fixtureModule.exports, busyTaskId: null, clientTasksHistory: history, setBusyTaskId: () => {}, setActionError: () => {}, completeTask: async () => { writes++; }, refreshClientActivity: () => { history.loading = true; }, console, userFacingErrorMessage: () => 'Synthetic error' });
  await fixtureModule.exports.handleCompleteTask('older'); assert.equal(writes, 1);
  await fixtureModule.exports.handleCompleteTask('older'); assert.equal(writes, 1);
  history.loading = false; history.error = 'Synthetic refresh failure';
  await fixtureModule.exports.handleCompleteTask('older'); assert.equal(writes, 1);
  history.error = null; await fixtureModule.exports.handleCompleteTask('older'); assert.equal(writes, 2);
});
