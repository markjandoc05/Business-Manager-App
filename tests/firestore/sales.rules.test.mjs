import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app'; const ORG = 'sales-org'; const OTHER_ORG = 'sales-other-org'; const ADMIN = 'sales-admin'; const MANAGER = 'sales-manager'; const USER = 'sales-user'; const OTHER_ADMIN = 'sales-other-admin'; let testEnv;
const salePath = (organizationId = ORG) => `organizations/${organizationId}/sales`;
function saleData(uid = ADMIN, overrides = {}) { const now = Timestamp.fromMillis(Date.now()); return { saleNumber: 'S-ABC123', saleDate: '2026-09-03', customerType: 'WALK_IN', customerName: 'Ana', clientId: null, items: [{ source: 'OTHER', catalogItemId: null, type: null, name: 'Walk-in service', code: '', categoryId: null, category: '', unit: '', regularPrice: 500, salePrice: null, quantity: 1, unitPrice: 500, subtotal: 500 }], subtotal: 500, total: 500, paymentStatus: 'PAID', paymentMethod: 'CASH', amountPaid: 500, balance: 0, notes: null, status: 'ACTIVE', archived: false, archivedAt: null, archivedBy: null, trashed: false, trashedAt: null, trashedBy: null, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid, ...overrides }; }
async function seed() { await testEnv.withSecurityRulesDisabled(async (context) => { const db = context.firestore(); const now = Timestamp.fromMillis(Date.now()); const expiry = Timestamp.fromMillis(Date.now() + 86_400_000); for (const org of [ORG, OTHER_ORG]) { await db.doc(`organizations/${org}`).set({ status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: expiry }); await db.doc(`organizations/${org}/license/current`).set({ plan: 'TEAM', status: 'ACTIVE', maxUsers: 3, subscriptionStartedAt: now, subscriptionEndsAt: expiry }); } for (const [org, uid, role] of [[ORG, ADMIN, 'ADMIN'], [ORG, MANAGER, 'MANAGER'], [ORG, USER, 'USER'], [OTHER_ORG, OTHER_ADMIN, 'ADMIN']]) await db.doc(`organizations/${org}/members/${uid}`).set({ userId: uid, role, status: 'active' }); for (const uid of [ADMIN, MANAGER, USER, OTHER_ADMIN]) await db.doc(`users/${uid}`).set({ uid, status: 'active', active: true }); }); }
before(async () => { testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } }); }); beforeEach(async () => { await testEnv.clearFirestore(); await seed(); }); after(async () => testEnv.cleanup());

test('managers can record valid standalone Sales and all active members can read them', async () => { const adminDb = testEnv.authenticatedContext(ADMIN).firestore(); await assertSucceeds(setDoc(doc(adminDb, `${salePath()}/sale-1`), saleData())); const managerDb = testEnv.authenticatedContext(MANAGER).firestore(); await assertSucceeds(setDoc(doc(managerDb, `${salePath()}/sale-2`), saleData(MANAGER, { saleNumber: 'S-DEF456', createdBy: MANAGER, updatedBy: MANAGER }))); const userDb = testEnv.authenticatedContext(USER).firestore(); await assertSucceeds(getDoc(doc(userDb, `${salePath()}/sale-1`))); });

test('Sales list query matches the application date/filter order shape and is tenant-scoped', async () => { const adminDb = testEnv.authenticatedContext(ADMIN).firestore(); await setDoc(doc(adminDb, `${salePath()}/sale-1`), saleData()); const listQuery = (db, org = ORG) => query(collection(db, salePath(org)), where('customerType', '==', 'WALK_IN'), where('paymentStatus', '==', 'PAID'), where('saleDate', '>=', '2026-09-01'), where('saleDate', '<=', '2026-09-30'), orderBy('saleDate', 'desc'), orderBy('createdAt', 'desc'), limit(25)); const result = await assertSucceeds(getDocs(listQuery(testEnv.authenticatedContext(USER).firestore()))); assert.equal(result.size, 1); await assertFails(getDocs(listQuery(testEnv.authenticatedContext(OTHER_ADMIN).firestore()))); await assertFails(getDocs(listQuery(testEnv.unauthenticatedContext().firestore()))); });

test('Sales rules reject non-managers, cross-org writes, malformed payment data, and hard delete', async () => { const userDb = testEnv.authenticatedContext(USER).firestore(); await assertFails(setDoc(doc(userDb, `${salePath()}/user-sale`), saleData(USER, { createdBy: USER, updatedBy: USER }))); const otherDb = testEnv.authenticatedContext(OTHER_ADMIN).firestore(); await assertFails(setDoc(doc(otherDb, `${salePath()}/cross-sale`), saleData(OTHER_ADMIN, { createdBy: OTHER_ADMIN, updatedBy: OTHER_ADMIN }))); const adminDb = testEnv.authenticatedContext(ADMIN).firestore(); await assertFails(setDoc(doc(adminDb, `${salePath()}/bad-payment`), saleData(ADMIN, { paymentStatus: 'PARTIAL', amountPaid: 0, balance: 500 }))); await assertFails(setDoc(doc(adminDb, `${salePath()}/empty`), saleData(ADMIN, { items: [] }))); const ref = doc(adminDb, `${salePath()}/sale-1`); await setDoc(ref, saleData()); await assertFails(deleteDoc(ref)); });

test('only the void lifecycle transition is permitted after recording a Sale', async () => { const adminDb = testEnv.authenticatedContext(ADMIN).firestore(); const ref = doc(adminDb, `${salePath()}/sale-1`); await setDoc(ref, saleData()); await assertFails(updateDoc(ref, { total: 1, updatedAt: serverTimestamp(), updatedBy: ADMIN })); await assertSucceeds(updateDoc(ref, { status: 'VOIDED', voidedAt: serverTimestamp(), voidedBy: ADMIN, voidReason: null, updatedAt: serverTimestamp(), updatedBy: ADMIN })); await assertFails(updateDoc(ref, { status: 'ACTIVE', updatedAt: serverTimestamp(), updatedBy: ADMIN })); });

test('Sales archive and Trash transitions preserve immutable financial data', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore(); const ref = doc(adminDb, `${salePath()}/sale-lifecycle`);
  await setDoc(ref, saleData());
  await assertSucceeds(updateDoc(ref, { archived: true, archivedAt: serverTimestamp(), archivedBy: ADMIN, trashed: false, trashedAt: null, trashedBy: null, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
  await assertFails(updateDoc(ref, { archived: true, archivedAt: serverTimestamp(), archivedBy: ADMIN, total: 1, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
  await assertSucceeds(updateDoc(ref, { archived: false, archivedAt: null, archivedBy: null, trashed: false, trashedAt: null, trashedBy: null, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
  await assertFails(updateDoc(ref, { trashed: true, trashedAt: serverTimestamp(), trashedBy: ADMIN, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
  await assertSucceeds(updateDoc(ref, { status: 'VOIDED', voidedAt: serverTimestamp(), voidedBy: ADMIN, voidReason: null, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
  await assertSucceeds(updateDoc(ref, { trashed: true, trashedAt: serverTimestamp(), trashedBy: ADMIN, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
  await assertFails(updateDoc(ref, { trashed: true, trashedAt: serverTimestamp(), trashedBy: ADMIN, total: 1, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
  await assertFails(updateDoc(ref, { status: 'ACTIVE', trashed: false, trashedAt: null, trashedBy: null, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
  await assertSucceeds(updateDoc(ref, { trashed: false, trashedAt: null, trashedBy: null, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
  const restored = await getDoc(ref); assert.equal(restored.data().status, 'VOIDED'); assert.equal(restored.data().trashed, false);
  const userDb = testEnv.authenticatedContext(USER).firestore(); await assertFails(updateDoc(doc(userDb, `${salePath()}/sale-lifecycle`), { archived: true, archivedAt: serverTimestamp(), archivedBy: USER, updatedAt: serverTimestamp(), updatedBy: USER }));
});

test('legacy Sales without record-management metadata can be archived safely', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore(); const ref = doc(adminDb, `${salePath()}/legacy-sale`);
  const legacy = saleData(); delete legacy.archived; delete legacy.archivedAt; delete legacy.archivedBy; delete legacy.trashed; delete legacy.trashedAt; delete legacy.trashedBy;
  await testEnv.withSecurityRulesDisabled(async (context) => { await setDoc(doc(context.firestore(), `${salePath()}/legacy-sale`), legacy); });
  await assertSucceeds(updateDoc(ref, { archived: true, archivedAt: serverTimestamp(), archivedBy: ADMIN, trashed: false, trashedAt: null, trashedBy: null, updatedAt: serverTimestamp(), updatedBy: ADMIN }));
});

test('a Deal-linked Sale requires a Won same-organization Deal and a matching Client', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  await testEnv.withSecurityRulesDisabled(async (context) => { const seedDb = context.firestore(); await seedDb.doc(`organizations/${ORG}/clients/client-1`).set({ status: 'ACTIVE', archived: false, trashed: false, name: 'Client One' }); await seedDb.doc(`organizations/${ORG}/deals/deal-1`).set({ status: 'Won', stage: 'Won', clientId: 'client-1' }); });
  const saleRef = doc(adminDb, `${salePath()}/deal-sale`); const lockRef = doc(adminDb, `organizations/${ORG}/dealSaleLocks/deal-1`); const now = Timestamp.fromMillis(Date.now());
  const payload = saleData(ADMIN, { source: 'DEAL', dealId: 'deal-1', customerType: 'CLIENT', customerName: 'Client One', clientId: 'client-1', createdAt: now, updatedAt: now });
  await assertSucceeds(runTransaction(adminDb, async (transaction) => { transaction.set(saleRef, payload); transaction.set(lockRef, { dealId: 'deal-1', saleId: saleRef.id, status: 'ACTIVE', updatedAt: serverTimestamp(), updatedBy: ADMIN }); }));
  await assertFails(setDoc(doc(adminDb, `${salePath()}/bad-deal`), saleData(ADMIN, { source: 'DEAL', dealId: 'deal-1', customerType: 'CLIENT', clientId: 'other-client' })));
});

test('the Deal lock permits one active Sale, supports void-and-rerecord, and blocks a concurrent duplicate', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  await testEnv.withSecurityRulesDisabled(async (context) => { const seedDb = context.firestore(); await seedDb.doc(`organizations/${ORG}/clients/client-1`).set({ status: 'ACTIVE', archived: false, trashed: false, name: 'Client One' }); await seedDb.doc(`organizations/${ORG}/deals/deal-1`).set({ status: 'Won', stage: 'Won', clientId: 'client-1' }); });
  const makeAttempt = async (id) => { const saleRef = doc(adminDb, `${salePath()}/${id}`); const lockRef = doc(adminDb, `organizations/${ORG}/dealSaleLocks/deal-1`); const now = Timestamp.fromMillis(Date.now()); return runTransaction(adminDb, async (transaction) => { const lock = await transaction.get(lockRef); if (lock.exists() && lock.data().status === 'ACTIVE') throw new Error('already recorded'); transaction.set(saleRef, saleData(ADMIN, { source: 'DEAL', dealId: 'deal-1', customerType: 'CLIENT', customerName: 'Client One', clientId: 'client-1', createdAt: now, updatedAt: now })); transaction.set(lockRef, { dealId: 'deal-1', saleId: id, status: 'ACTIVE', updatedAt: serverTimestamp(), updatedBy: ADMIN }); }); };
  const results = await Promise.allSettled([makeAttempt('sale-a'), makeAttempt('sale-b')]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const sales = await getDocs(query(collection(adminDb, salePath()), where('dealId', '==', 'deal-1'), where('status', '==', 'ACTIVE'))); assert.equal(sales.size, 1);
  const activeSale = sales.docs[0]; const lockRef = doc(adminDb, `organizations/${ORG}/dealSaleLocks/deal-1`);
  const batch = writeBatch(adminDb); batch.update(activeSale.ref, { status: 'VOIDED', voidedAt: serverTimestamp(), voidedBy: ADMIN, voidReason: null, updatedAt: serverTimestamp(), updatedBy: ADMIN }); batch.update(lockRef, { status: 'AVAILABLE', updatedAt: serverTimestamp(), updatedBy: ADMIN }); await assertSucceeds(batch.commit());
  await assertSucceeds(makeAttempt('sale-c'));
  const deal = await getDoc(doc(adminDb, `organizations/${ORG}/deals/deal-1`)); assert.equal(deal.data().status, 'Won');
});

test('a legacy Deal-linked Sale without a lock can be voided while creating an AVAILABLE marker', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const seedDb = context.firestore();
    await seedDb.doc(`organizations/${ORG}/clients/client-legacy`).set({ status: 'ACTIVE', archived: false, trashed: false, name: 'Legacy Client' });
    await seedDb.doc(`organizations/${ORG}/deals/deal-legacy`).set({ status: 'Won', stage: 'Won', clientId: 'client-legacy' });
    await seedDb.doc(`${salePath()}/legacy-deal-sale`).set(saleData(ADMIN, { source: 'DEAL', dealId: 'deal-legacy', customerType: 'CLIENT', customerName: 'Legacy Client', clientId: 'client-legacy' }));
  });
  const saleRef = doc(adminDb, `${salePath()}/legacy-deal-sale`);
  const lockRef = doc(adminDb, `organizations/${ORG}/dealSaleLocks/deal-legacy`);
  await assertSucceeds(runTransaction(adminDb, async (transaction) => {
    const sale = await transaction.get(saleRef);
    const lock = await transaction.get(lockRef);
    assert.equal(sale.data().status, 'ACTIVE');
    assert.equal(lock.exists(), false);
    transaction.set(lockRef, { dealId: 'deal-legacy', saleId: saleRef.id, status: 'AVAILABLE', updatedAt: serverTimestamp(), updatedBy: ADMIN });
    transaction.update(saleRef, { status: 'VOIDED', voidedAt: serverTimestamp(), voidedBy: ADMIN, voidReason: null, updatedAt: serverTimestamp(), updatedBy: ADMIN });
  }));
  const lock = await getDoc(lockRef);
  assert.equal(lock.data().status, 'AVAILABLE');
  assert.equal((await getDoc(saleRef)).data().status, 'VOIDED');
});
