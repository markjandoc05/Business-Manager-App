import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG = 'catalog-categories-org';
const OTHER_ORG = 'catalog-categories-other-org';
const ADMIN = 'catalog-categories-admin';
const MANAGER = 'catalog-categories-manager';
const USER = 'catalog-categories-user';
const OTHER_ADMIN = 'catalog-categories-other-admin';
let testEnv;

function categoryData(uid, overrides = {}) {
  const now = Timestamp.fromMillis(Date.now());
  return {
    name: 'Food', normalizedName: 'food', type: 'PRODUCT', status: 'ACTIVE',
    createdBy: uid, createdAt: now, updatedBy: uid, updatedAt: now,
    ...overrides,
  };
}

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Timestamp.fromMillis(Date.now());
    const expiry = Timestamp.fromMillis(Date.now() + 86_400_000);
    for (const organizationId of [ORG, OTHER_ORG]) {
      await db.doc(`organizations/${organizationId}`).set({ status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: expiry });
      await db.doc(`organizations/${organizationId}/license/current`).set({ plan: 'TEAM', status: 'ACTIVE', maxUsers: 3, subscriptionStartedAt: now, subscriptionEndsAt: expiry });
    }
    await db.doc(`organizations/${ORG}/members/${ADMIN}`).set({ userId: ADMIN, role: 'ADMIN', status: 'active' });
    await db.doc(`organizations/${ORG}/members/${MANAGER}`).set({ userId: MANAGER, role: 'MANAGER', status: 'active' });
    await db.doc(`organizations/${ORG}/members/${USER}`).set({ userId: USER, role: 'USER', status: 'active' });
    await db.doc(`organizations/${OTHER_ORG}/members/${OTHER_ADMIN}`).set({ userId: OTHER_ADMIN, role: 'ADMIN', status: 'active' });
    for (const uid of [ADMIN, MANAGER, USER, OTHER_ADMIN]) await db.doc(`users/${uid}`).set({ uid, status: 'active', active: true });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => testEnv.cleanup());

test('ADMIN and MANAGER can create and update reusable categories', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  const foodRef = doc(adminDb, `organizations/${ORG}/catalogCategories/food`);
  await assertSucceeds(setDoc(foodRef, categoryData(ADMIN)));
  await assertSucceeds(updateDoc(foodRef, { name: 'Food & Beverage', normalizedName: 'food & beverage', status: 'INACTIVE', updatedBy: ADMIN, updatedAt: serverTimestamp() }));
  const managerDb = testEnv.authenticatedContext(MANAGER).firestore();
  await assertSucceeds(setDoc(doc(managerDb, `organizations/${ORG}/catalogCategories/consulting`), categoryData(MANAGER, { name: 'Consulting', normalizedName: 'consulting', type: 'SERVICE' })));
  const saved = await getDoc(foodRef);
  assert.equal(saved.data()?.status, 'INACTIVE');
});

test('the Catalog category query can list categories for all organization roles', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  const path = `organizations/${ORG}/catalogCategories`;
  await setDoc(doc(adminDb, `${path}/food`), categoryData(ADMIN));
  await setDoc(doc(adminDb, `${path}/consulting`), categoryData(ADMIN, { name: 'Consulting', normalizedName: 'consulting', type: 'SERVICE' }));
  const categoryQuery = (db) => query(collection(db, 'organizations', ORG, 'catalogCategories'), orderBy('name', 'asc'));
  const adminResult = await getDocs(categoryQuery(adminDb));
  assert.deepEqual(adminResult.docs.map((category) => category.id), ['consulting', 'food']);
  assert.equal((await getDocs(categoryQuery(testEnv.authenticatedContext(MANAGER).firestore()))).size, 2);
  assert.equal((await getDocs(categoryQuery(testEnv.authenticatedContext(USER).firestore()))).size, 2);
  await assertFails(getDocs(categoryQuery(testEnv.authenticatedContext(OTHER_ADMIN).firestore())));
  await assertFails(getDocs(categoryQuery(testEnv.unauthenticatedContext().firestore())));
});

test('USER cannot manage categories and malformed, cross-tenant, or destructive writes fail', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  const foodRef = doc(adminDb, `organizations/${ORG}/catalogCategories/food`);
  await setDoc(foodRef, categoryData(ADMIN));
  const userDb = testEnv.authenticatedContext(USER).firestore();
  await assertSucceeds(getDoc(doc(userDb, `organizations/${ORG}/catalogCategories/food`)));
  await assertFails(setDoc(doc(userDb, `organizations/${ORG}/catalogCategories/user-category`), categoryData(USER)));
  await assertFails(updateDoc(doc(userDb, `organizations/${ORG}/catalogCategories/food`), { status: 'INACTIVE', updatedBy: USER, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(adminDb, `organizations/${ORG}/catalogCategories/bad`), categoryData(ADMIN, { normalizedName: '' })));
  await assertFails(updateDoc(foodRef, { type: 'SERVICE', updatedBy: ADMIN, updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(foodRef));
  const otherDb = testEnv.authenticatedContext(OTHER_ADMIN).firestore();
  await assertFails(getDoc(doc(otherDb, `organizations/${ORG}/catalogCategories/food`)));
  await assertFails(setDoc(doc(otherDb, `organizations/${ORG}/catalogCategories/cross-tenant`), categoryData(OTHER_ADMIN)));
});
