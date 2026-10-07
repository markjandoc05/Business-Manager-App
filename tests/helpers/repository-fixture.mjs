import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import * as nodeCrypto from 'node:crypto';

// Real repository calls with a synthetic SDK adapter. This deliberately does
// not claim emulator authorization, indexes or transaction concurrency coverage.
export function repositoryFixture(role = 'ADMIN', overrides = {}) {
  const org = 'fixture-org'; const user = { uid: 'fixture-user', name: 'Fixture User', active: true };
  const records = new Map(); const reads = []; let serial = 0;
  const removed = Symbol('deleteField'); const database = { path: '' };
  const reference = (base, ...segments) => {
    const value = [base.path, ...segments].filter(Boolean).join('/');
    return { path: value, id: value.split('/').at(-1) };
  };
  const snapshot = (ref) => ({ id: ref.id, ref, exists: () => records.has(ref.path), data: () => records.get(ref.path) });
  const field = (data, name) => name.split('.').reduce((value, key) => value?.[key], data);
  const firestore = {
    collection: reference, doc: (base, ...segments) => reference(base, ...(segments.length ? segments : [`auto-${++serial}`])),
    serverTimestamp: () => new Date().toISOString(), deleteField: () => removed,
    getDoc: async (ref) => { reads.push(ref.path); return snapshot(ref); },
    query: (ref, ...constraints) => ({ ...ref, constraints }),
    where: (name, operator, value) => ({ kind: 'where', name, operator, value }),
    orderBy: (name, direction = 'asc') => ({ kind: 'order', name, direction }),
    limit: (count) => ({ kind: 'limit', count }), startAfter: (cursor) => ({ kind: 'cursor', cursor }),
    startAt: (value) => ({ kind: 'start', value }), endAt: (value) => ({ kind: 'end', value }),
    getDocs: async (query) => {
      reads.push(query);
      let docs = [...records.keys()].filter((key) => key.startsWith(`${query.path}/`) && !key.slice(query.path.length + 1).includes('/')).map((key) => snapshot(reference(database, key)));
      for (const c of query.constraints || []) if (c.kind === 'where') docs = docs.filter((item) => c.operator === '==' ? field(item.data(), c.name) === c.value : c.operator === 'in' ? c.value.includes(field(item.data(), c.name)) : c.operator === '<' ? field(item.data(), c.name) < c.value : c.operator === '<=' ? field(item.data(), c.name) <= c.value : c.operator === '>=' ? field(item.data(), c.name) >= c.value : false);
      const orders = (query.constraints || []).filter((c) => c.kind === 'order');
      docs.sort((a, b) => { for (const c of orders) { const av = field(a.data(), c.name); const bv = field(b.data(), c.name); if (av !== bv) return (av < bv ? -1 : 1) * (c.direction === 'desc' ? -1 : 1); } return a.id.localeCompare(b.id); });
      const cursor = query.constraints?.find((c) => c.kind === 'cursor'); if (cursor) docs = docs.slice(docs.findIndex((item) => item.id === cursor.cursor.id) + 1);
      const count = query.constraints?.find((c) => c.kind === 'limit')?.count; if (count !== undefined) docs = docs.slice(0, count);
      return { docs, size: docs.length, empty: docs.length === 0 };
    },
    writeBatch: () => {
      const writes = [];
      return { set: (ref, value) => writes.push({ ref, value }), update: (ref, value) => writes.push({ ref, value, update: true }), delete: (ref) => writes.push({ ref, remove: true }), commit: async () => {
        for (const write of writes) {
          if (write.update) assert.ok(records.has(write.ref.path), 'Updating missing document');
          if (write.ref.path.includes('/timeline/') && records.get(write.ref.path)?.entryType === 'SYSTEM') throw new Error('Immutable SYSTEM timeline event cannot be overwritten.');
        }
        for (const write of writes) {
          if (write.remove) { records.delete(write.ref.path); continue; }
          const next = write.update ? { ...records.get(write.ref.path), ...write.value } : { ...write.value };
          for (const [key, value] of Object.entries(next)) if (value === removed) delete next[key];
          records.set(write.ref.path, next);
        }
      } };
    },
  };
  const cache = new Map();
  const dependencies = {
    'node:crypto': nodeCrypto,
    'firebase/firestore': firestore, 'firebase/storage': {}, '@/lib/firebase/client': { db: database, storage: {} },
    '@/lib/permissions': { requireOrganizationAccess: async (actor, organizationId, roles) => { assert.equal(organizationId, org); assert.equal(actor?.uid, user.uid); if (roles && !roles.includes(role)) throw new Error('Forbidden role'); return { membership: { userId: user.uid, role, status: 'active' } }; } },
    '@/lib/repositories/authenticatedRequest': { authenticatedFetch: async () => { throw new Error('Unexpected HTTP call'); } },
    ...overrides,
  };
  function load(filename) {
    filename = path.resolve(filename);
    if (cache.has(filename)) return cache.get(filename).exports;
    const fixtureModule = { exports: {} }; cache.set(filename, fixtureModule);
    let source = fs.readFileSync(filename, 'utf8');
    const baseline = process.env.VENTALE_REPOSITORY_BASELINE;
    if (baseline) {
      assert.match(baseline, /^[a-f0-9]{7,40}$/);
      source = execFileSync('git', ['show', `${baseline}:${path.relative(process.cwd(), filename)}`], { encoding: 'utf8' });
    }
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const require = (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      assert.ok(name.startsWith('@/') || name.startsWith('.'), `Unexpected dependency ${name}`);
      const target = name.startsWith('@/') ? path.resolve(name.slice(2)) : path.resolve(path.dirname(filename), name);
      return load(target.endsWith('.ts') ? target : `${target}.ts`);
    };
    vm.runInNewContext(compiled, { module: fixtureModule, exports: fixtureModule.exports, require, URL, Date, console, Error, Promise, Number, String, Object, Set, Map, Math, Buffer, crypto, Headers, Response, File, FormData, Blob, Uint8Array, TextEncoder, performance, process: { env: {} } }, { filename });
    return fixtureModule.exports;
  }
  const prefix = `organizations/${org}`;
  records.set(`${prefix}/members/${user.uid}`, { status: 'active', role, displayName: user.name });
  return { org, user, prefix, records, reads, load, firestore, database };
}
