import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG = 'deal-catalog-org';
const OTHER_ORG = 'deal-catalog-other-org';
const ADMIN = 'deal-catalog-admin';
const USER = 'deal-catalog-user';
let testEnv;

const path = (organizationId = ORG) => `organizations/${organizationId}`;
const now = () => Timestamp.fromMillis(1_700_000_000_000);

function lineItem(overrides = {}) {
  return {
    source: 'CATALOG', catalogItemId: 'website-development', type: 'SERVICE', name: 'Website Development', code: 'WEB-001', categoryId: 'website-services', category: 'Website Services', unit: 'project', regularPrice: 40000, salePrice: 35000, quantity: 1, unitPrice: 35000, subtotal: 35000,
    ...overrides,
  };
}

function otherLineItem(overrides = {}) {
  return {
    source: 'OTHER', catalogItemId: null, type: null, name: 'Rush installation', code: '', categoryId: null, category: '', unit: '', regularPrice: 2500, salePrice: null, quantity: 1, unitPrice: 2500, subtotal: 2500,
    ...overrides,
  };
}

function dealData(overrides = {}) {
  return {
    title: 'New website', clientId: 'client-1', leadId: null, value: 35000, stage: 'New', status: 'Active', expectedCloseDate: '', productServiceName: 'Website Development', items: [lineItem()], assignedToUid: ADMIN, assignedToName: 'Admin', lossReason: null, wonAt: null, lostAt: null, archived: false, createdBy: ADMIN, createdAt: now(), updatedBy: ADMIN, updatedAt: now(),
    ...overrides,
  };
}

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const organizationId of [ORG, OTHER_ORG]) {
      await setDoc(doc(db, path(organizationId)), { status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: null });
    }
    await Promise.all([
      setDoc(doc(db, `${path()}/members/${ADMIN}`), { userId: ADMIN, role: 'ADMIN', status: 'active' }),
      setDoc(doc(db, `${path()}/members/${USER}`), { userId: USER, role: 'USER', status: 'active' }),
      setDoc(doc(db, `users/${ADMIN}`), { uid: ADMIN, status: 'active', active: true }),
      setDoc(doc(db, `users/${USER}`), { uid: USER, status: 'active', active: true }),
      setDoc(doc(db, `${path()}/clients/client-1`), { status: 'ACTIVE' }),
      setDoc(doc(db, `${path()}/catalogItems/website-development`), { archived: false, status: 'ACTIVE', createdAt: now() }),
      setDoc(doc(db, `${path()}/catalogItems/inactive-service`), { archived: false, status: 'INACTIVE', createdAt: Timestamp.fromMillis(1_699_999_000_000) }),
      setDoc(doc(db, `${path()}/catalogItems/archived-product`), { archived: true, status: 'ACTIVE', createdAt: Timestamp.fromMillis(1_699_998_000_000) }),
    ]);
  });
}

before(async () => { testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } }); });
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => testEnv.cleanup());

test('the Deal selector query is tenant-scoped and available to active organization members', async () => {
  const selectorQuery = (db, organizationId = ORG) => query(collection(db, path(organizationId), 'catalogItems'), where('archived', '==', false), orderBy('createdAt', 'desc'));
  const ownOrganization = await assertSucceeds(getDocs(selectorQuery(testEnv.authenticatedContext(USER).firestore())));
  assert.deepEqual(ownOrganization.docs.map((snapshot) => snapshot.id), ['website-development', 'inactive-service']);
  await assertFails(getDocs(selectorQuery(testEnv.authenticatedContext(USER).firestore(), OTHER_ORG)));
  await assertFails(getDocs(selectorQuery(testEnv.unauthenticatedContext().firestore())));
});

test('authorized Deal writers can create and update optional Catalog item snapshots', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const dealRef = doc(db, `${path()}/deals/catalog-deal`);
  await assertSucceeds(setDoc(dealRef, dealData()));
  await assertSucceeds(updateDoc(dealRef, { items: [lineItem({ quantity: 2, subtotal: 70000 })], value: 70000, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
});

test('authorized Deal writers can store a mixed Catalog and Other line-item list', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertSucceeds(setDoc(doc(db, `${path()}/deals/mixed-deal`), dealData({ value: 37500, items: [lineItem(), otherLineItem()] })));
});

test('the production Deal creation batch can write its Deal, timeline, and audit activity together', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const dealRef = doc(db, `${path()}/deals/atomic-deal`);
  const batch = writeBatch(db);
  batch.set(dealRef, { ...dealData(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(doc(db, `${path()}/deals/atomic-deal/timeline/system-system-created`), {
    entryType: 'SYSTEM', content: 'Deal created.', occurredAt: serverTimestamp(), createdAt: serverTimestamp(), createdByUid: ADMIN, createdByName: 'Admin',
  });
  batch.set(doc(db, `${path()}/activities/atomic-activity`), {
    type: 'deal_creation', description: 'New deal created: New website', entityType: 'Deal', entityId: 'atomic-deal', metadata: { clientId: 'client-1', dealId: 'atomic-deal' }, createdAt: serverTimestamp(), createdBy: ADMIN,
  });
  await assertSucceeds(batch.commit());
});

test('manual Deals remain valid and snapshot lists are bounded', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertSucceeds(setDoc(doc(db, `${path()}/deals/manual-deal`), dealData({ title: 'Manual Deal', value: 500, items: [] })));
  await assertFails(setDoc(doc(db, `${path()}/deals/too-many-items`), dealData({ items: Array.from({ length: 51 }, () => lineItem()) })));
});
