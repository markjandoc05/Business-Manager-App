import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG = 'record-lifecycle-org';
const OTHER_ORG = 'record-lifecycle-other-org';
const ADMIN = 'record-lifecycle-admin';
const OTHER_ADMIN = 'record-lifecycle-other-admin';
let testEnv;

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Timestamp.fromMillis(Date.now());
    const expiry = Timestamp.fromMillis(Date.now() + 86_400_000);
    for (const organizationId of [ORG, OTHER_ORG]) {
      await db.doc(`organizations/${organizationId}`).set({
        status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: expiry,
      });
      await db.doc(`organizations/${organizationId}/license/current`).set({
        plan: 'TEAM', status: 'ACTIVE', maxUsers: 3, subscriptionStartedAt: now, subscriptionEndsAt: expiry,
      });
    }
    await db.doc(`organizations/${ORG}/members/${ADMIN}`).set({ userId: ADMIN, role: 'ADMIN', status: 'active' });
    await db.doc(`organizations/${OTHER_ORG}/members/${OTHER_ADMIN}`).set({ userId: OTHER_ADMIN, role: 'ADMIN', status: 'active' });
    await db.doc(`users/${ADMIN}`).set({ uid: ADMIN, status: 'active', active: true });
    await db.doc(`users/${OTHER_ADMIN}`).set({ uid: OTHER_ADMIN, status: 'active', active: true });
    await db.doc(`organizations/${ORG}/clients/client-a`).set({
      name: 'Client A', email: '', phone: '', assignedToUid: ADMIN, assignedToName: 'Admin', status: 'ACTIVE', archived: false,
      createdAt: now, createdBy: ADMIN, updatedAt: now, updatedBy: ADMIN,
    });
    await db.doc(`organizations/${ORG}/leads/lead-a`).set({
      name: 'Lead A', email: '', phone: '', assignedToUid: ADMIN, assignedToName: 'Admin', status: 'New', archived: false,
      createdAt: now, createdBy: ADMIN, updatedAt: now, updatedBy: ADMIN,
    });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => testEnv.cleanup());

test('parent permanent deletion is server-only, even for trashed records', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const clientRef = doc(db, `organizations/${ORG}/clients/client-a`);
  const leadRef = doc(db, `organizations/${ORG}/leads/lead-a`);
  await assertSucceeds(updateDoc(clientRef, {
    status: 'ARCHIVED', archived: true, archivedAt: serverTimestamp(), archivedBy: ADMIN,
    trashed: true, trashedAt: serverTimestamp(), trashedBy: ADMIN, updatedAt: serverTimestamp(), updatedBy: ADMIN,
  }));
  await assertSucceeds(updateDoc(leadRef, {
    archived: true, archivedAt: serverTimestamp(), archivedBy: ADMIN,
    trashed: true, trashedAt: serverTimestamp(), trashedBy: ADMIN, updatedAt: serverTimestamp(), updatedBy: ADMIN,
  }));
  await assertFails(deleteDoc(clientRef));
  await assertFails(deleteDoc(leadRef));
});

test('trash updates remain organization-scoped and require valid trash metadata', async () => {
  const ownDb = testEnv.authenticatedContext(ADMIN).firestore();
  const otherDb = testEnv.authenticatedContext(OTHER_ADMIN).firestore();
  const clientPath = `organizations/${ORG}/clients/client-a`;
  await assertFails(updateDoc(doc(otherDb, clientPath), { trashed: true, trashedAt: serverTimestamp(), trashedBy: OTHER_ADMIN }));
  await assertFails(updateDoc(doc(ownDb, clientPath), { trashed: true, archived: true, status: 'ARCHIVED', trashedAt: serverTimestamp(), trashedBy: OTHER_ADMIN }));
});
