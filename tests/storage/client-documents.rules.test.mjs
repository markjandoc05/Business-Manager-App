import fs from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG_A = 'storage-org-a';
const ORG_B = 'storage-org-b';
const ADMIN = 'storage-admin';
const MANAGER = 'storage-manager';
const USER_A = 'storage-user-a';
const USER_B = 'storage-user-b';
const INACTIVE_USER = 'storage-inactive-user';
const MAX_UPLOAD_SIZE = 1_048_576;
let testEnv;

const objectPath = (organizationId, clientId = 'client-a', name = 'file.pdf') => `organizations/${organizationId}/clients/${clientId}/documents/doc-1/${name}`;
const organization = (licenseStatus = 'ACTIVE', licenseWriteEnabled = true) => ({ status: 'active', licenseStatus, licenseWriteEnabled, licenseExpiresAt: null });
const member = (userId, role, status = 'active') => ({ userId, role, status });

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, `organizations/${ORG_A}`), organization()),
      setDoc(doc(db, `organizations/${ORG_B}`), organization()),
      setDoc(doc(db, `organizations/${ORG_A}/members/${ADMIN}`), member(ADMIN, 'ADMIN')),
      setDoc(doc(db, `organizations/${ORG_A}/members/${MANAGER}`), member(MANAGER, 'MANAGER')),
      setDoc(doc(db, `organizations/${ORG_A}/members/${USER_A}`), member(USER_A, 'USER')),
      setDoc(doc(db, `organizations/${ORG_A}/members/${INACTIVE_USER}`), member(INACTIVE_USER, 'ADMIN', 'inactive')),
      setDoc(doc(db, `organizations/${ORG_B}/members/${USER_B}`), member(USER_B, 'USER')),
      setDoc(doc(db, `organizations/${ORG_A}/clients/client-a`), { status: 'ACTIVE' }),
      setDoc(doc(db, `organizations/${ORG_B}/clients/client-b`), { status: 'ACTIVE' }),
      setDoc(doc(db, `organizations/${ORG_A}/clients/client-a/documents/doc-1`), { archived: false, storagePath: objectPath(ORG_A) }),
    ]);
  });
}

function storageFor(uid) {
  return testEnv.authenticatedContext(uid).storage();
}

function upload(uid, path, bytes = new Uint8Array([1]), contentType = 'application/pdf') {
  return uploadBytes(ref(storageFor(uid), path), bytes, { contentType });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
    storage: { rules: fs.readFileSync('storage.rules', 'utf8') },
  });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => testEnv.cleanup());

test('active ADMIN can upload an allowed organization-scoped client document', async () => {
  await assertSucceeds(upload(ADMIN, objectPath(ORG_A)));
});

test('USER cannot upload client documents', async () => {
  await assertFails(upload(USER_A, objectPath(ORG_A)));
});

test('inactive organization members cannot upload client documents', async () => {
  await assertFails(upload(INACTIVE_USER, objectPath(ORG_A)));
});

test('cross-organization document access is denied', async () => {
  await assertFails(upload(ADMIN, objectPath(ORG_B, 'client-b')));
});

test('expired license blocks Storage uploads and archived Clients block metadata creation', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `organizations/${ORG_A}`), organization('EXPIRED', false));
  });
  await assertFails(upload(ADMIN, objectPath(ORG_A)));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `organizations/${ORG_A}`), organization());
    await setDoc(doc(context.firestore(), `organizations/${ORG_A}/clients/client-a`), { status: 'ARCHIVED' });
  });
  await assertSucceeds(upload(ADMIN, objectPath(ORG_A, 'client-a', 'archived-client.pdf')));
  const metadata = doc(testEnv.authenticatedContext(ADMIN).firestore(), `organizations/${ORG_A}/clients/client-a/documents/archived-document`);
  await assertFails(setDoc(metadata, {
    name: 'archived-client.pdf',
    storagePath: objectPath(ORG_A, 'client-a', 'archived-client.pdf'),
    downloadURL: 'https://example.test/archived-client.pdf',
    mimeType: 'application/pdf',
    size: 1,
    uploadedAt: serverTimestamp(),
    uploadedByUid: ADMIN,
    uploadedByName: 'Admin',
    archived: false,
    archivedAt: null,
    archivedBy: null,
  }));
});

test('files below and exactly 1 MB are allowed, while one byte over is denied', async () => {
  await assertSucceeds(upload(ADMIN, objectPath(ORG_A, 'client-a', 'small.pdf'), new Uint8Array(MAX_UPLOAD_SIZE - 1)));
  await assertSucceeds(upload(ADMIN, objectPath(ORG_A, 'client-a', 'exact.pdf'), new Uint8Array(MAX_UPLOAD_SIZE)));
  await assertFails(upload(ADMIN, objectPath(ORG_A, 'client-a', 'over.pdf'), new Uint8Array(MAX_UPLOAD_SIZE + 1)));
});

test('unsupported files are denied', async () => {
  await assertFails(upload(ADMIN, objectPath(ORG_A, 'file.txt'), new Uint8Array([1]), 'text/plain'));
});

test('legacy unscoped client document paths are denied', async () => {
  await assertFails(upload(ADMIN, 'clients/client-a/documents/doc-1/file.pdf'));
  await assertFails(getBytes(ref(storageFor(ADMIN), 'clients/client-a/documents/doc-1/file.pdf')));
});

test('browser clients cannot delete organization document objects, including archived objects', async () => {
  const path = objectPath(ORG_A);
  await assertSucceeds(upload(ADMIN, path));
  await assertFails(deleteObject(ref(storageFor(ADMIN), path)));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`organizations/${ORG_A}/clients/client-a/documents/doc-1`).update({ archived: true });
  });
  await assertFails(deleteObject(ref(storageFor(ADMIN), path)));
  await assertSucceeds(getBytes(ref(storageFor(ADMIN), path)));
});

test('archiving and restoring document metadata leave the stored object readable', async () => {
  const path = objectPath(ORG_A);
  const adminStorage = storageFor(ADMIN);
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  const metadata = doc(adminDb, `organizations/${ORG_A}/clients/client-a/documents/doc-1`);

  await assertSucceeds(upload(ADMIN, path));
  await assertSucceeds(updateDoc(metadata, { archived: true, archivedAt: serverTimestamp(), archivedBy: ADMIN }));
  await assertSucceeds(getBytes(ref(adminStorage, path)));
  await assertSucceeds(updateDoc(metadata, { archived: false, archivedAt: null, archivedBy: null }));
  await assertSucceeds(getBytes(ref(adminStorage, path)));
});

test('a denied Storage delete leaves archived metadata intact', async () => {
  const path = objectPath(ORG_A);
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  const metadata = doc(adminDb, `organizations/${ORG_A}/clients/client-a/documents/doc-1`);

  await assertSucceeds(upload(ADMIN, path));
  await assertSucceeds(updateDoc(metadata, { archived: true, archivedAt: serverTimestamp(), archivedBy: ADMIN }));
  await assertFails(deleteObject(ref(storageFor(USER_A), path)));
  assert.equal((await getDoc(metadata)).exists(), true);
});
