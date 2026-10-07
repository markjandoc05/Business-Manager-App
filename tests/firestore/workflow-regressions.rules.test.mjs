import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import { repositoryFixture } from '../helpers/repository-fixture.mjs';

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('A loopback Firestore emulator is required.');
const org = 'fixture-org'; const uid = 'fixture-user'; let environment;
before(async () => { environment = await initializeTestEnvironment({ projectId: 'demo-bsm-client-app', firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } }); });
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore(); const now = sdk.Timestamp.now(); const expiry = sdk.Timestamp.fromMillis(Date.now() + 86400000);
    const audit = { createdBy: uid, updatedBy: uid, createdAt: now, updatedAt: now, assignedToUid: uid, assignedToName: 'Fixture User', archived: false };
    await db.doc(`users/${uid}`).set({ uid, status: 'active', active: true });
    await db.doc(`organizations/${org}`).set({ status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: expiry });
    await db.doc(`organizations/${org}/members/${uid}`).set({ userId: uid, role: 'ADMIN', status: 'active' });
    await db.doc(`organizations/${org}/clients/client`).set({ name: 'Fixture Client', status: 'ACTIVE', ...audit });
    await db.doc(`organizations/${org}/leads/lead`).set({ name: 'Fixture Lead', company: '', email: 'fixture@example.test', phone: '', source: 'Website', status: 'New', trashed: false, ...audit });
    await db.doc(`organizations/${org}/deals/deal`).set({ title: 'Fixture Deal', clientId: 'client', leadId: null, value: 100, stage: 'New', status: 'Active', expectedCloseDate: '', wonAt: null, lostAt: null, lossReason: null, ...audit });
  });
});
after(async () => environment?.cleanup());
function repositories() {
  const db = environment.authenticatedContext(uid).firestore();
  const f = repositoryFixture('ADMIN', { 'firebase/firestore': sdk, '@/lib/firebase/client': { db } });
  return { ...f, db };
}
test('real repository stage and archive/restore cycles commit through immutable timeline rules', async () => {
  const f = repositories(); const repository = f.load('lib/repositories/deals.ts');
  for (const stage of ['Qualified', 'New', 'Qualified']) await repository.updateDealStage(f.user, org, await repository.getDealById(f.user, org, 'deal'), stage);
  for (let i = 0; i < 2; i++) { await repository.archiveDeal(f.user, org, 'deal'); await repository.restoreDeal(f.user, org, 'deal'); }
  const entries = await sdk.getDocs(sdk.collection(f.db, `organizations/${org}/deals/deal/timeline`));
  assert.equal(entries.size, 7);
});
test('real repository Lost/reopen/Lost commits without overwriting the first event', async () => {
  const f = repositories(); const repository = f.load('lib/repositories/leads.ts');
  let previous = 'New';
  for (const status of ['Lost', 'New', 'Lost']) { await repository.updateLeadStatus(f.user, org, { id: 'lead', status: previous, assignedToUid: uid }, status); previous = status; }
  assert.equal((await sdk.getDocs(sdk.collection(f.db, `organizations/${org}/leads/lead/timeline`))).size, 2);
});
test('Task UTC schedule and General relation persist after reload and former parent archive', async () => {
  const f = repositories(); const repository = f.load('lib/repositories/tasks.ts');
  const input = { title: 'Fixture Task', type: 'Task', dueDate: '2026-10-07T09:00+08:00', priority: 'Medium', relatedTo: { type: 'Client', id: 'client' }, assignedToUid: uid, assignedToName: 'Fixture User' };
  const task = await repository.createTask(f.user, org, input);
  assert.equal((await sdk.getDoc(sdk.doc(f.db, `organizations/${org}/tasks/${task.id}`))).data().dueDate, '2026-10-07T01:00:00.000Z');
  await repository.updateTask(f.user, org, task.id, { ...input, relatedTo: undefined });
  await environment.withSecurityRulesDisabled((context) => context.firestore().doc(`organizations/${org}/clients/client`).update({ status: 'ARCHIVED', archived: true }));
  await repository.updateTask(f.user, org, task.id, { ...input, relatedTo: undefined });
  assert.equal((await repository.getTaskById(f.user, org, task.id)).relatedTo, undefined);
});

test('real Client history queries reach older active and archived rows with USER assignment boundaries', async () => {
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore(); const writes = [];
    for (const archived of [false, true]) for (let i = 0; i < (archived ? 20 : 70); i++) {
      const name = `history-${archived}-${i}`;
      const common = { archived, assignedToUid: i % 2 ? 'another-user' : uid, createdAt: sdk.Timestamp.fromMillis(1000000 + i) };
      writes.push(db.doc(`organizations/${org}/deals/${name}`).set({ ...common, clientId: 'client', title: name, status: 'Active', stage: 'New' }));
      writes.push(db.doc(`organizations/${org}/tasks/${name}`).set({ ...common, relatedTo: { type: 'Client', id: 'client' }, title: name, status: 'Pending' }));
    }
    // The setup Deal belongs to the same Client, so remove it from this count fixture.
    writes.push(db.doc(`organizations/${org}/deals/deal`).delete()); await Promise.all(writes);
  });
  for (const role of ['ADMIN', 'USER']) {
    await environment.withSecurityRulesDisabled((context) => context.firestore().doc(`organizations/${org}/members/${uid}`).update({ role }));
    const db = environment.authenticatedContext(uid).firestore();
    const f = repositoryFixture(role, { 'firebase/firestore': sdk, '@/lib/firebase/client': { db } });
    const deals = f.load('lib/repositories/deals.ts'); const tasks = f.load('lib/repositories/tasks.ts');
    for (const loader of [deals.listClientDealsPage, tasks.listClientTasksPage]) for (const archived of [false, true]) {
      let cursor = null; const ids = [];
      do { const page = await loader(f.user, org, 'client', cursor, archived); ids.push(...Array.from(page.items, (item) => item.id)); cursor = page.nextCursor; } while (cursor);
      assert.equal(ids.length, (archived ? 20 : 70) / (role === 'USER' ? 2 : 1));
      assert.equal(new Set(ids).size, ids.length);
    }
  }
});
