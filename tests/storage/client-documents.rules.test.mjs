import fs from 'node:fs';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { deleteObject, getBytes, getDownloadURL, ref, uploadBytes } from 'firebase/storage';

const PROJECT_ID = 'demo-bsm-client-app';
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[name] || '')) throw new Error(`Storage tests require loopback ${name}.`);
}
const ORG_A = 'storage-org-a';
const ORG_B = 'storage-org-b';
const ADMIN = 'storage-admin';
const MANAGER = 'storage-manager';
const USER_A = 'storage-user-a';
const USER_B = 'storage-user-b';
const INACTIVE_USER = 'storage-inactive-user';
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
      ...[ADMIN, MANAGER, USER_A, INACTIVE_USER, USER_B].map((uid) => setDoc(doc(db, `users/${uid}`), { uid, status: 'active', active: true })),
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

test('all browser Storage reads, writes, token URL requests and deletes are denied after server transition',async()=>{
  const path=objectPath(ORG_A);
  await testEnv.withSecurityRulesDisabled(async context=>{await uploadBytes(ref(context.storage(),path),new Uint8Array([1]),{contentType:'application/pdf'});});
  for(const uid of [ADMIN,MANAGER,USER_A,USER_B,INACTIVE_USER]) {
    await assertFails(upload(uid,path));await assertFails(getBytes(ref(storageFor(uid),path)));await assertFails(getDownloadURL(ref(storageFor(uid),path)));await assertFails(deleteObject(ref(storageFor(uid),path)));
  }
  const anonymous=testEnv.unauthenticatedContext().storage();await assertFails(getBytes(ref(anonymous,path)));await assertFails(uploadBytes(ref(anonymous,path),new Uint8Array([1]),{contentType:'application/pdf'}));
});

test('document metadata and private operation records cannot bypass the authenticated server',async()=>{
  for(const uid of [ADMIN,MANAGER,USER_A]) {
    const db=testEnv.authenticatedContext(uid).firestore();
    await assertFails(setDoc(doc(db,`organizations/${ORG_A}/clients/client-a/documents/new`),{name:'new.pdf',storagePath:objectPath(ORG_A)}));
    for(const path of [`organizations/${ORG_A}/clients/client-a/documentOperations/doc-1`,`organizations/${ORG_A}/clients/client-a/documentUploadKeys/key`,`organizations/${ORG_A}/clientDocumentGuards/client-a`]){
      await assertFails(setDoc(doc(db,path),{state:'REGISTERED'}));await assertFails(getDoc(doc(db,path)));
    }
  }
});

test('legacy root and unmatched Storage paths remain denied',async()=>{
  for(const path of ['clients/client-a/documents/doc-1/file.pdf','organizations/other/clients/client-a/documents/doc-1/file.pdf','arbitrary/file.pdf']){
    await assertFails(upload(ADMIN,path));await assertFails(getBytes(ref(storageFor(ADMIN),path)));await assertFails(deleteObject(ref(storageFor(ADMIN),path)));
  }
});
