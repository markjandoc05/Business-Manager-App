import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { getBytes, ref, uploadBytes } from 'firebase/storage';

const PROJECT_ID = 'bsm-client-app-web';
const ORG_A = 'storage-org-a';
const ORG_B = 'storage-org-b';
const ADMIN = 'storage-admin';
const USER_A = 'storage-user-a';
const USER_B = 'storage-user-b';
let testEnv;

const objectPath = (organizationId, clientId = 'client-a', name = 'file.pdf') => `organizations/${organizationId}/clients/${clientId}/documents/doc-1/${name}`;
const organization = (licenseStatus = 'ACTIVE', licenseWriteEnabled = true) => ({ status: 'active', licenseStatus, licenseWriteEnabled, licenseExpiresAt: null });
const member = (userId, role) => ({ userId, role, status: 'active' });

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, `organizations/${ORG_A}`), organization()),
      setDoc(doc(db, `organizations/${ORG_B}`), organization()),
      setDoc(doc(db, `organizations/${ORG_A}/members/${ADMIN}`), member(ADMIN, 'ADMIN')),
      setDoc(doc(db, `organizations/${ORG_A}/members/${USER_A}`), member(USER_A, 'USER')),
      setDoc(doc(db, `organizations/${ORG_B}/members/${USER_B}`), member(USER_B, 'USER')),
      setDoc(doc(db, `organizations/${ORG_A}/clients/client-a`), { status: 'ACTIVE' }),
      setDoc(doc(db, `organizations/${ORG_B}/clients/client-b`), { status: 'ACTIVE' }),
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

test('cross-organization document access is denied', async () => {
  await assertFails(upload(ADMIN, objectPath(ORG_B, 'client-b')));
});

test('expired license and archived client block uploads', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `organizations/${ORG_A}`), organization('EXPIRED', false));
  });
  await assertFails(upload(ADMIN, objectPath(ORG_A)));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `organizations/${ORG_A}`), organization());
    await setDoc(doc(context.firestore(), `organizations/${ORG_A}/clients/client-a`), { status: 'ARCHIVED' });
  });
  await assertFails(upload(ADMIN, objectPath(ORG_A)));
});

test('oversized and unsupported files are denied', async () => {
  await assertFails(upload(ADMIN, objectPath(ORG_A, 'file.txt'), new Uint8Array([1]), 'text/plain'));
  await assertFails(upload(ADMIN, objectPath(ORG_A), new Uint8Array(10 * 1024 * 1024 + 1)));
});

test('legacy unscoped client document paths are denied', async () => {
  await assertFails(upload(ADMIN, 'clients/client-a/documents/doc-1/file.pdf'));
  await assertFails(getBytes(ref(storageFor(ADMIN), 'clients/client-a/documents/doc-1/file.pdf')));
});
