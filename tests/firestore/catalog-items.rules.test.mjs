import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG = 'catalog-items-org';
const OTHER_ORG = 'catalog-items-other-org';
const ADMIN = 'catalog-items-admin';
const MANAGER = 'catalog-items-manager';
const USER = 'catalog-items-user';
const OTHER_ADMIN = 'catalog-items-other-admin';
let testEnv;

function itemData(uid, overrides = {}) {
  const now = Timestamp.fromMillis(Date.now());
  return {
    type: 'PRODUCT', name: 'Frozen Bagnet 450g', code: 'BAG-450', categoryId: null, category: 'Food', unit: 'pack', description: '', regularPrice: 599, salePrice: null,
    status: 'ACTIVE', archived: false, archivedAt: null, archivedBy: null, createdBy: uid, createdAt: now, updatedBy: uid, updatedAt: now,
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

test('ADMIN and MANAGER can create Product and Service items with valid fields', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertSucceeds(setDoc(doc(db, `organizations/${ORG}/catalogItems/product-1`), itemData(ADMIN)));
  await assertSucceeds(setDoc(doc(db, `organizations/${ORG}/catalogItems/service-1`), itemData(ADMIN, { type: 'SERVICE', name: 'Consultation', code: '', unit: 'session', regularPrice: 1500, salePrice: 1200 })));
  const managerDb = testEnv.authenticatedContext(MANAGER).firestore();
  await assertSucceeds(setDoc(doc(managerDb, `organizations/${ORG}/catalogItems/manager-item`), itemData(MANAGER, { name: 'Website Development', type: 'SERVICE' })));
});

test('required fields and valid regular and sale prices are enforced', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertFails(setDoc(doc(db, `organizations/${ORG}/catalogItems/missing-name`), itemData(ADMIN, { name: '' })));
  await assertFails(setDoc(doc(db, `organizations/${ORG}/catalogItems/negative-price`), itemData(ADMIN, { regularPrice: -1 })));
  await assertFails(setDoc(doc(db, `organizations/${ORG}/catalogItems/sale-above-regular`), itemData(ADMIN, { regularPrice: 500, salePrice: 501 })));
  await assertFails(setDoc(doc(db, `organizations/${ORG}/catalogItems/bad-type`), itemData(ADMIN, { type: 'BUNDLE' })));
});

test('a selected category must exist in the organization and match the item type', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Timestamp.fromMillis(Date.now());
    await db.doc(`organizations/${ORG}/catalogCategories/food`).set({ name: 'Food', normalizedName: 'food', type: 'PRODUCT', status: 'ACTIVE', createdBy: ADMIN, createdAt: now, updatedBy: ADMIN, updatedAt: now });
    await db.doc(`organizations/${ORG}/catalogCategories/consulting`).set({ name: 'Consulting', normalizedName: 'consulting', type: 'SERVICE', status: 'ACTIVE', createdBy: ADMIN, createdAt: now, updatedBy: ADMIN, updatedAt: now });
  });
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertSucceeds(setDoc(doc(db, `organizations/${ORG}/catalogItems/with-category`), itemData(ADMIN, { categoryId: 'food', category: 'Food' })));
  await assertFails(setDoc(doc(db, `organizations/${ORG}/catalogItems/missing-category`), itemData(ADMIN, { categoryId: 'missing', category: 'Missing' })));
  await assertFails(setDoc(doc(db, `organizations/${ORG}/catalogItems/wrong-category-type`), itemData(ADMIN, { categoryId: 'consulting', category: 'Consulting' })));
});

test('catalog items can be edited without changing their stable document identity', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const itemRef = doc(db, `organizations/${ORG}/catalogItems/item-1`);
  await setDoc(itemRef, itemData(ADMIN));
  await assertSucceeds(updateDoc(itemRef, {
    type: 'SERVICE', name: 'Website Development', code: 'WEB-001', category: 'Digital', unit: 'project', description: 'Build and launch.', regularPrice: 2500, salePrice: 2200, status: 'INACTIVE', updatedBy: ADMIN, updatedAt: serverTimestamp(),
  }));
  const saved = await getDoc(itemRef);
  assert.equal(saved.id, 'item-1');
  assert.equal(saved.data()?.type, 'SERVICE');
  assert.equal(saved.data()?.status, 'INACTIVE');
  assert.equal(saved.data()?.regularPrice, 2500);
  assert.equal(saved.data()?.salePrice, 2200);
});

test('the Catalog page query can list catalog items by organization and role', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  const catalogPath = `organizations/${ORG}/catalogItems`;
  await setDoc(doc(adminDb, `${catalogPath}/active-item`), itemData(ADMIN, { createdAt: Timestamp.fromMillis(Date.now() - 1000) }));
  const archivedRef = doc(adminDb, `${catalogPath}/archived-item`);
  await setDoc(archivedRef, itemData(ADMIN, { createdAt: Timestamp.fromMillis(Date.now() - 2000) }));
  await updateDoc(archivedRef, { archived: true, archivedAt: serverTimestamp(), archivedBy: ADMIN, updatedBy: ADMIN, updatedAt: serverTimestamp() });

  const pageQuery = (db) => query(
    collection(db, 'organizations', ORG, 'catalogItems'),
    where('archived', '==', false),
    orderBy('createdAt', 'desc'),
    limit(25),
  );
  const adminResult = await getDocs(pageQuery(adminDb));
  assert.deepEqual(adminResult.docs.map((item) => item.id), ['active-item']);

  const managerResult = await getDocs(pageQuery(testEnv.authenticatedContext(MANAGER).firestore()));
  assert.equal(managerResult.size, 1);
  const userResult = await getDocs(pageQuery(testEnv.authenticatedContext(USER).firestore()));
  assert.equal(userResult.size, 1);
  await assertFails(getDocs(pageQuery(testEnv.authenticatedContext(OTHER_ADMIN).firestore())));
  await assertFails(getDocs(pageQuery(testEnv.unauthenticatedContext().firestore())));
});

test('archive and restore retain the item and its Active or Inactive status', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const itemRef = doc(db, `organizations/${ORG}/catalogItems/item-1`);
  await setDoc(itemRef, itemData(ADMIN, { status: 'INACTIVE' }));
  await assertSucceeds(updateDoc(itemRef, { archived: true, archivedAt: serverTimestamp(), archivedBy: ADMIN, updatedBy: ADMIN, updatedAt: serverTimestamp() }));
  let saved = await getDoc(itemRef);
  assert.equal(saved.data()?.archived, true);
  assert.equal(saved.data()?.status, 'INACTIVE');
  await assertSucceeds(updateDoc(itemRef, { archived: false, archivedAt: null, archivedBy: null, updatedBy: ADMIN, updatedAt: serverTimestamp() }));
  saved = await getDoc(itemRef);
  assert.equal(saved.data()?.archived, false);
  assert.equal(saved.data()?.status, 'INACTIVE');
});

test('USER cannot manage catalog items, and cross-organization reads and writes fail', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  await setDoc(doc(adminDb, `organizations/${ORG}/catalogItems/item-1`), itemData(ADMIN));
  const userDb = testEnv.authenticatedContext(USER).firestore();
  await assertSucceeds(getDoc(doc(userDb, `organizations/${ORG}/catalogItems/item-1`)));
  await assertFails(setDoc(doc(userDb, `organizations/${ORG}/catalogItems/user-item`), itemData(USER)));
  await assertFails(updateDoc(doc(userDb, `organizations/${ORG}/catalogItems/item-1`), { name: 'Unauthorized', updatedBy: USER, updatedAt: serverTimestamp() }));
  const otherDb = testEnv.authenticatedContext(OTHER_ADMIN).firestore();
  await assertFails(getDoc(doc(otherDb, `organizations/${ORG}/catalogItems/item-1`)));
  await assertFails(getDoc(doc(otherDb, `organizations/${ORG}/catalogItems/other-id`)));
  await assertFails(updateDoc(doc(otherDb, `organizations/${ORG}/catalogItems/item-1`), { name: 'Cross tenant', updatedBy: OTHER_ADMIN, updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), `organizations/${ORG}/catalogItems/item-1`)));
});

test('unknown fields and invalid updates are denied', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const itemRef = doc(db, `organizations/${ORG}/catalogItems/item-1`);
  await setDoc(itemRef, itemData(ADMIN));
  await assertFails(updateDoc(itemRef, { unknownField: true, updatedBy: ADMIN, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(itemRef, { regularPrice: -1, updatedBy: ADMIN, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(itemRef, { salePrice: 999, updatedBy: ADMIN, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(itemRef, { standardPrice: 599, updatedBy: ADMIN, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(itemRef, { status: 'ARCHIVED', updatedBy: ADMIN, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db, `organizations/${ORG}/catalogItems/item-1`), itemData(ADMIN, { name: 'Overwrite' })));
});
