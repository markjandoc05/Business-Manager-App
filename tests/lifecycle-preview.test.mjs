import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextResponse } from 'next/server.js';
import { Timestamp } from 'firebase-admin/firestore';
import { repositoryFixture } from './helpers/repository-fixture.mjs';

function fixture(role, assignedToUid = 'fixture-user') {
  let f;
  const ref = (path) => ({ path, id: path.split('/').at(-1), collection: (name) => collection(`${path}/${name}`), get: async () => { f.reads.push(path); const value = f.records.get(path); return { ref: ref(path), exists: value !== undefined, data: () => value }; } });
  const collection = (path, constraints = []) => ({ path, doc: (id) => ref(`${path}/${id}`), where: (field, operator, value) => collection(path, [...constraints, f.firestore.where(field, operator, value)]), get: () => f.firestore.getDocs({ path, constraints }) });
  f = repositoryFixture(role, {
    'next/server': { NextResponse }, 'firebase-admin/firestore': { Timestamp },
    '@/lib/server/firebase-admin': { adminDb: { doc: ref }, adminStorageBucket: () => { throw new Error('Unexpected Storage operation'); } },
    '@/lib/server/auth': { getAuthenticatedUser: async () => ({ uid: 'fixture-user' }), isApplicationUserActive: async () => true },
  });
  f.records.set(f.prefix, { status: 'active' });
  f.records.set(`${f.prefix}/members/${f.user.uid}`, { userId: f.user.uid, role, status: 'active' });
  f.records.set(`${f.prefix}/leads/lead`, { status: 'Client', assignedToUid, convertedClientId: 'converted-client' });
  f.records.set(`${f.prefix}/clients/converted-client`, { name: 'Private converted Client' });
  return { ...f, route: f.load('app/api/organizations/[orgId]/records/[entity]/[recordId]/route.ts') };
}
const preview = (f) => f.route.GET({ url: `http://localhost/api/organizations/${f.org}/records/lead/lead?action=archive` }, { params: Promise.resolve({ orgId: f.org, entity: 'lead', recordId: 'lead' }) });

test('USER preview of an unassigned converted Lead returns 403 before reading dependency names or counts', async () => {
  const f = fixture('USER', 'other-user'); const response = await preview(f);
  assert.equal(response.status, 403);
  assert.equal(JSON.stringify(await response.json()).includes('Private converted Client'), false);
  assert.equal(f.reads.some((item) => typeof item === 'string' && item.includes('/clients/')), false);
  assert.equal(f.reads.some((item) => typeof item === 'object'), false);
});
test('assigned USER and existing ADMIN/MANAGER roles can inspect their authorized lifecycle', async () => {
  for (const role of ['USER', 'ADMIN', 'MANAGER']) {
    const f = fixture(role, role === 'USER' ? 'fixture-user' : 'other-user'); const response = await preview(f);
    assert.equal(response.status, 200); assert.equal((await response.json()).decision.preservedRecords['Converted Client'], 'Private converted Client');
  }
});
test('unknown membership role is denied before parent dependency reads', async () => {
  const f = fixture('UNKNOWN'); assert.equal((await preview(f)).status, 403);
  assert.equal(f.reads.some((item) => typeof item === 'object'), false);
});
