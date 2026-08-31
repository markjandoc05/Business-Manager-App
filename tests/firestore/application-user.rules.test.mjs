import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG = 'application-user-rules-org';
const ACTIVE_UID = 'application-user-active';
const INACTIVE_UID = 'application-user-inactive';
const DISABLED_UID = 'application-user-disabled';
const MISSING_UID = 'application-user-missing';
let testEnv;

function profile(uid, status = 'active', active = true) {
  return { uid, name: uid, email: `${uid}@example.com`, displayName: uid, status, role: 'USER', active };
}

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      db.doc(`organizations/${ORG}`).set({ status: 'active' }),
      db.doc(`organizations/${ORG}/members/${ACTIVE_UID}`).set({ userId: ACTIVE_UID, role: 'USER', status: 'active' }),
      db.doc(`organizations/${ORG}/members/${INACTIVE_UID}`).set({ userId: INACTIVE_UID, role: 'USER', status: 'active' }),
      db.doc(`organizations/${ORG}/members/${DISABLED_UID}`).set({ userId: DISABLED_UID, role: 'USER', status: 'active' }),
      db.doc(`organizations/${ORG}/members/${MISSING_UID}`).set({ userId: MISSING_UID, role: 'USER', status: 'active' }),
      db.doc(`users/${ACTIVE_UID}`).set(profile(ACTIVE_UID)),
      db.doc(`users/${INACTIVE_UID}`).set(profile(INACTIVE_UID, 'inactive', false)),
      db.doc(`users/${DISABLED_UID}`).set(profile(DISABLED_UID, 'disabled', false)),
    ]);
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => testEnv.cleanup());

test('only an active application profile plus active membership grants tenant access', async () => {
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext(ACTIVE_UID).firestore(), `organizations/${ORG}`)));
  await assertFails(getDoc(doc(testEnv.authenticatedContext(INACTIVE_UID).firestore(), `organizations/${ORG}`)));
  await assertFails(getDoc(doc(testEnv.authenticatedContext(DISABLED_UID).firestore(), `organizations/${ORG}`)));
  await assertFails(getDoc(doc(testEnv.authenticatedContext(MISSING_UID).firestore(), `organizations/${ORG}`)));
});

test('a signed-in user cannot tamper with its application status or active flag', async () => {
  const db = testEnv.authenticatedContext(ACTIVE_UID).firestore();
  const userRef = doc(db, `users/${ACTIVE_UID}`);
  await assertFails(updateDoc(userRef, { status: 'disabled' }));
  await assertFails(updateDoc(userRef, { active: false }));
  await assertSucceeds(updateDoc(userRef, { displayName: 'Updated display name' }));
});

test('a new signed-in user can create only a pending inactive profile', async () => {
  const db = testEnv.authenticatedContext('new-profile-user').firestore();
  await assertSucceeds(setDoc(doc(db, 'users/new-profile-user'), profile('new-profile-user', 'pending', false)));
  await assertFails(setDoc(doc(db, 'users/new-active-profile'), profile('new-active-profile')));
});
