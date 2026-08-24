import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG = 'client-child-lifecycle-org';
const OTHER_ORG = 'client-child-lifecycle-other-org';
const ADMIN = 'client-child-lifecycle-admin';
const MANAGER = 'client-child-lifecycle-manager';
const USER = 'client-child-lifecycle-user';
const INACTIVE = 'client-child-lifecycle-inactive';
const OTHER_ORG_ADMIN = 'client-child-lifecycle-other-org-admin';
let testEnv;

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Timestamp.fromMillis(Date.now());
    await db.doc(`organizations/${ORG}`).set({ status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: null });
    await db.doc(`organizations/${OTHER_ORG}`).set({ status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: null });
    await db.doc(`organizations/${ORG}/license/current`).set({ plan: 'TEAM', status: 'ACTIVE', maxUsers: 3, createdAt: now, updatedAt: now, updatedBy: ADMIN });
    await db.doc(`organizations/${OTHER_ORG}/license/current`).set({ plan: 'TEAM', status: 'ACTIVE', maxUsers: 3, createdAt: now, updatedAt: now, updatedBy: OTHER_ORG_ADMIN });
    await db.doc(`organizations/${ORG}/members/${ADMIN}`).set({ userId: ADMIN, role: 'ADMIN', status: 'active' });
    await db.doc(`organizations/${ORG}/members/${MANAGER}`).set({ userId: MANAGER, role: 'MANAGER', status: 'active' });
    await db.doc(`organizations/${ORG}/members/${USER}`).set({ userId: USER, role: 'USER', status: 'active' });
    await db.doc(`organizations/${ORG}/members/${INACTIVE}`).set({ userId: INACTIVE, role: 'ADMIN', status: 'inactive' });
    await db.doc(`organizations/${OTHER_ORG}/members/${OTHER_ORG_ADMIN}`).set({ userId: OTHER_ORG_ADMIN, role: 'ADMIN', status: 'active' });
    await db.doc(`organizations/${ORG}/clients/client-a`).set({ status: 'ACTIVE' });
    await db.doc(`organizations/${ORG}/clients/client-a/notes/note-a`).set({ content: 'Keep this note', createdAt: now, createdByUid: ADMIN, createdByName: 'Admin', archived: false, archivedAt: null, archivedBy: null });
    await db.doc(`organizations/${ORG}/clients/client-a/documents/document-a`).set({ name: 'file.pdf', storagePath: `organizations/${ORG}/clients/client-a/documents/document-a/file.pdf`, downloadURL: 'https://example.test/file.pdf', mimeType: 'application/pdf', size: 10, uploadedAt: now, uploadedByUid: ADMIN, uploadedByName: 'Admin', archived: false, archivedAt: null, archivedBy: null });
  });
}

const archivePayload = (actor) => ({ archived: true, archivedAt: serverTimestamp(), archivedBy: actor });
const restorePayload = { archived: false, archivedAt: null, archivedBy: null };

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => testEnv.cleanup());

test('ADMIN can archive and restore Client notes, but cannot bypass the server permanent-delete policy', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const noteRef = doc(db, `organizations/${ORG}/clients/client-a/notes/note-a`);
  await assertFails(deleteDoc(noteRef));
  await assertSucceeds(updateDoc(noteRef, archivePayload(ADMIN)));
  await assertSucceeds(updateDoc(noteRef, restorePayload));
  await assertSucceeds(updateDoc(noteRef, archivePayload(ADMIN)));
  await assertFails(deleteDoc(noteRef));
  assert.equal((await getDoc(noteRef)).exists(), true);
});

test('ADMIN can archive and restore Client document metadata, but cannot bypass the server permanent-delete endpoint', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const documentRef = doc(db, `organizations/${ORG}/clients/client-a/documents/document-a`);
  await assertFails(deleteDoc(documentRef));
  await assertSucceeds(updateDoc(documentRef, archivePayload(ADMIN)));
  await assertSucceeds(updateDoc(documentRef, restorePayload));
  await assertSucceeds(updateDoc(documentRef, archivePayload(ADMIN)));
  await assertFails(deleteDoc(documentRef));
  assert.equal((await getDoc(documentRef)).exists(), true);
});

test('USER cannot archive or delete Client notes or document metadata', async () => {
  const db = testEnv.authenticatedContext(USER).firestore();
  await assertFails(updateDoc(doc(db, `organizations/${ORG}/clients/client-a/notes/note-a`), archivePayload(USER)));
  await assertFails(updateDoc(doc(db, `organizations/${ORG}/clients/client-a/documents/document-a`), archivePayload(USER)));
});

test('MANAGER can archive and restore Client document metadata, but cannot bypass the server permanent-delete endpoint', async () => {
  const db = testEnv.authenticatedContext(MANAGER).firestore();
  const documentRef = doc(db, `organizations/${ORG}/clients/client-a/documents/document-a`);
  await assertSucceeds(updateDoc(documentRef, archivePayload(MANAGER)));
  await assertSucceeds(updateDoc(documentRef, restorePayload));
  await assertSucceeds(updateDoc(documentRef, archivePayload(MANAGER)));
  await assertFails(deleteDoc(documentRef));
});

test('document lifecycle remains denied for inactive, cross-tenant, blocked-license, and protected-field writes', async () => {
  const inactiveDb = testEnv.authenticatedContext(INACTIVE).firestore();
  const otherOrganizationDb = testEnv.authenticatedContext(OTHER_ORG_ADMIN).firestore();
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  const documentPath = `organizations/${ORG}/clients/client-a/documents/document-a`;

  await assertFails(updateDoc(doc(inactiveDb, documentPath), archivePayload(INACTIVE)));
  await assertFails(updateDoc(doc(otherOrganizationDb, documentPath), archivePayload(OTHER_ORG_ADMIN)));
  await assertFails(updateDoc(doc(adminDb, documentPath), { ...archivePayload(ADMIN), name: 'tampered.pdf' }));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`organizations/${ORG}`).update({ licenseStatus: 'EXPIRED', licenseWriteEnabled: false });
  });
  await assertFails(updateDoc(doc(adminDb, documentPath), archivePayload(ADMIN)));
});
