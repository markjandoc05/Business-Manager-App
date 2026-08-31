import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG = 'feedback-rules-org';
const USER = 'feedback-rules-user';
let testEnv;

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc(`organizations/${ORG}`).set({ status: 'active' });
    await db.doc(`users/${USER}`).set({ uid: USER, status: 'active', active: true });
    await db.doc(`organizations/${ORG}/members/${USER}`).set({ userId: USER, role: 'USER', status: 'active' });
    await db.doc(`organizations/${ORG}/feedback/existing`).set({ type: 'Feedback', message: 'Existing', status: 'NEW' });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => testEnv.cleanup());

test('browser clients cannot directly read or write feedback records', async () => {
  const feedbackRef = doc(testEnv.authenticatedContext(USER).firestore(), `organizations/${ORG}/feedback/new`);
  await assertFails(getDoc(feedbackRef));
  await assertFails(setDoc(feedbackRef, { type: 'Feedback', message: 'No direct writes' }));
  await assertFails(updateDoc(doc(testEnv.authenticatedContext(USER).firestore(), `organizations/${ORG}/feedback/existing`), { message: 'No direct updates' }));
  await assertFails(deleteDoc(doc(testEnv.authenticatedContext(USER).firestore(), `organizations/${ORG}/feedback/existing`)));
});

test('unauthenticated clients cannot access feedback records', async () => {
  const feedbackRef = doc(testEnv.unauthenticatedContext().firestore(), `organizations/${ORG}/feedback/existing`);
  await assertFails(getDoc(feedbackRef));
  await assertFails(setDoc(feedbackRef, { type: 'Feedback', message: 'No direct writes' }));
});
