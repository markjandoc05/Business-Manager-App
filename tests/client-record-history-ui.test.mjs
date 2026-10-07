// Synthetic integration regressions execute the real hook and completion callbacks.
// The React shim checks render/effect boundaries; browser acceptance remains separate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const ts = require('typescript');
const { createPagedRecordFeed } = await import(pathToFileURL(path.join(root, 'lib/paged-record-feed.ts')));
const { repositoryFixture } = await import(pathToFileURL(path.join(root, 'tests/helpers/repository-fixture.mjs')));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const block = (source, start, end) => `export ${source.slice(source.indexOf(start), source.indexOf(end)).trim()}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
function hookHarness(loader) {
  let cache; let memoDeps; let ref; let effectIndex = 0;
  const effects = []; const pending = [];
  const changed = (a, b) => !a || b.some((v, i) => !Object.is(v, a[i]));
  const react = {
    useMemo(fn, deps) { if (changed(memoDeps, deps)) { cache = fn(); memoDeps = deps; } return cache; },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); },
    useRef(initial) { return ref ||= { current: initial }; },
    useEffect(fn, deps) { const i = effectIndex++; if (changed(effects[i]?.deps, deps)) pending.push(() => { effects[i]?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  const hookModule = { exports: {} };
  vm.runInNewContext(compile(read('hooks/use-client-record-history.ts')), { module: hookModule, exports: hookModule.exports, require: name => name === 'react' ? react : { createPagedRecordFeed } });
  const args = [{ uid: 'fixture-user' }, 'fixture-org', 'client', 'ADMIN', true, false, true, 0, loader];
  return {
    args,
    render() { effectIndex = 0; return hookModule.exports.useClientRecordHistory(...args); },
    commit() { pending.splice(0).forEach(fn => fn()); },
    dispose() { effects.forEach(effect => effect.cleanup?.()); },
    feed() { return cache; },
  };
}
function completionHarness(f, tasks, refreshClientActivity) {
  const appModule = { exports: {} };
  vm.runInNewContext(compile(block(read('context/AppContext.tsx'), '  const completeTask = async', '  const archiveTask = async')), {
    module: appModule, exports: appModule.exports, user: f.user, tasks: [], tasksOrganizationId: f.org,
    currentOrganizationId: f.org, currentOrganizationRef: { current: f.org }, requireWritableLicense: () => {},
    getTaskByIdRepository: tasks.getTaskById, completeTaskRepository: tasks.completeTask,
    invalidateDashboardMetrics: () => {}, setTasks: () => {}, setLeadTasks: () => {}, Date, Error,
  });
  const pageModule = { exports: {} }; let writes = 0;
  const globals = {
    module: pageModule, exports: pageModule.exports, busyTaskId: null, clientTasksHistory: { loading: false, error: null },
    setBusyTaskId: id => { globals.busyTaskId = id; }, setActionError: () => {},
    completeTask: async id => { writes++; await appModule.exports.completeTask(id); },
    refreshClientActivity, userFacingErrorMessage: (_error, message) => message, console,
  };
  vm.runInNewContext(compile(block(read('app/clients/page.tsx'), '  const handleCompleteTask = async', '  const openAddTask =')), globals);
  return { globals, complete: pageModule.exports.handleCompleteTask, writes: () => writes };
}
function taskFixture() {
  const f = repositoryFixture(); const tasks = f.load('lib/repositories/tasks.ts');
  f.records.set(`${f.prefix}/clients/client`, { archived: false });
  f.records.set(`${f.prefix}/tasks/older`, { title: 'Older Task', status: 'Pending', assignedToUid: f.user.uid, archived: false, createdAt: '2025-01-01T00:00:00.000Z', relatedTo: { type: 'Client', id: 'client' } });
  return { f, tasks, status: () => f.records.get(`${f.prefix}/tasks/older`).status };
}

test('actual hook blocks token-change render before refresh effects, retaining older rows', async () => {
  let refreshing = false; let resolveRefresh;
  const h = hookHarness(async (_user, _org, _client, cursor) => {
    if (refreshing && cursor === null) await new Promise(resolve => { resolveRefresh = resolve; });
    return cursor === null ? { items: [{ id: 'first' }], nextCursor: 'first', hasMore: true } : { items: [{ id: 'older-selected' }], nextCursor: null, hasMore: false };
  });
  h.render(); h.commit(); await tick(); let state = h.render(); await state.loadMore(); state = h.render();
  assert.equal(state.loading, false); const feed = h.feed(); refreshing = true; h.args[7]++;
  state = h.render(); assert.equal(h.feed(), feed); assert.equal(feed.snapshot().loading, false);
  assert.equal(state.loading, true, 'render boundary must report loading before effect starts');
  assert.ok(state.items.find(row => row.id === 'older-selected'));
  h.commit(); state = h.render(); assert.equal(state.loading, true); assert.ok(state.items.find(row => row.id === 'older-selected'));
  resolveRefresh(); await tick(); state = h.render(); assert.equal(state.loading, false); assert.ok(state.items.find(row => row.id === 'older-selected'));
  h.dispose();
});

test('actual direct completion guard blocks stale row before effects, during refresh, and after failure; retry unblocks', async () => {
  const { f, tasks, status } = taskFixture(); let refreshing = false; let rejectRefresh;
  const h = hookHarness(async (_user, _org, _client, cursor) => {
    if (refreshing) await new Promise((_resolve, reject) => { rejectRefresh = reject; });
    return tasks.listClientTasksPage(f.user, f.org, 'client', cursor);
  });
  h.args[0] = f.user; h.render(); h.commit(); await tick();
  const c = completionHarness(f, tasks, () => { h.args[7]++; }); c.globals.clientTasksHistory = h.render();
  await c.complete('older'); assert.equal(status(), 'Completed'); assert.equal(c.writes(), 1); assert.equal(c.globals.busyTaskId, null);
  c.globals.clientTasksHistory = h.render(); assert.equal(c.globals.clientTasksHistory.loading, true); assert.equal(h.feed().snapshot().loading, false);
  await c.complete('older'); assert.equal(status(), 'Completed'); assert.equal(c.writes(), 1);
  refreshing = true; h.commit(); c.globals.clientTasksHistory = h.render(); await c.complete('older'); assert.equal(c.writes(), 1);
  rejectRefresh(new Error('Synthetic refresh failure')); await tick(); c.globals.clientTasksHistory = h.render();
  assert.equal(c.globals.clientTasksHistory.loading, false); assert.ok(c.globals.clientTasksHistory.error);
  assert.equal(c.globals.clientTasksHistory.items[0].status, 'Pending'); await c.complete('older'); assert.equal(c.writes(), 1); assert.equal(status(), 'Completed');
  refreshing = false; assert.equal(await c.globals.clientTasksHistory.reload(), true); c.globals.clientTasksHistory = h.render();
  assert.equal(c.globals.clientTasksHistory.items[0].status, 'Completed'); assert.equal(c.globals.clientTasksHistory.error, null);
  await c.complete('older'); assert.equal(c.writes(), 2); assert.equal(status(), 'Pending'); h.dispose();
});

test('Load More cannot reenable a stale completed Task after refresh failure', async () => {
  const { f, tasks, status } = taskFixture();
  for (let i = 0; i < 24; i++) f.records.set(`${f.prefix}/tasks/newer-${i}`, { title: `Newer ${i}`, status: 'Pending', archived: false, assignedToUid: f.user.uid, createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString(), relatedTo: { type: 'Client', id: 'client' } });
  f.records.set(`${f.prefix}/tasks/tail`, { title: 'Tail', status: 'Pending', archived: false, assignedToUid: f.user.uid, createdAt: '2024-01-01T00:00:00.000Z', relatedTo: { type: 'Client', id: 'client' } });
  let refreshing = false; let rejectRefresh;
  const h = hookHarness(async (_user, _org, _client, cursor) => {
    if (refreshing) await new Promise((_resolve, reject) => { rejectRefresh = reject; });
    return tasks.listClientTasksPage(f.user, f.org, 'client', cursor);
  });
  h.args[0] = f.user; h.render(); h.commit(); await tick();
  const c = completionHarness(f, tasks, () => { h.args[7]++; }); c.globals.clientTasksHistory = h.render();
  assert.equal(c.globals.clientTasksHistory.hasMore, true);
  await c.complete('older'); assert.equal(status(), 'Completed');
  refreshing = true; c.globals.clientTasksHistory = h.render(); h.commit();
  rejectRefresh(new Error('Synthetic refresh failure')); await tick(); c.globals.clientTasksHistory = h.render();
  assert.ok(c.globals.clientTasksHistory.error); assert.equal(c.globals.clientTasksHistory.items.find(row => row.id === 'older').status, 'Pending');
  refreshing = false; await c.globals.clientTasksHistory.loadMore(); c.globals.clientTasksHistory = h.render();
  await c.complete('older');
  try { assert.equal(status(), 'Completed', 'a successful later-page read must not clear the refresh failure and enable the stale Pending action'); }
  finally { h.dispose(); }
});
