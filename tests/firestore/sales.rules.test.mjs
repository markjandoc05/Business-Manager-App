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

async function trustedSale(id, data = saleData()) { await testEnv.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), `${salePath()}/${id}`), data)); }

test('browser Sale creation is denied even for managers; active members can read server records', async () => { for (const uid of [ADMIN, MANAGER]) await assertFails(setDoc(doc(testEnv.authenticatedContext(uid).firestore(), `${salePath()}/browser-${uid}`), saleData(uid))); await trustedSale('sale-1'); await assertSucceeds(getDoc(doc(testEnv.authenticatedContext(USER).firestore(), `${salePath()}/sale-1`))); });

test('Sales list query matches the application date/filter order shape and is tenant-scoped', async () => { const adminDb = testEnv.authenticatedContext(ADMIN).firestore(); await trustedSale('sale-1'); const listQuery = (db, org = ORG) => query(collection(db, salePath(org)), where('customerType', '==', 'WALK_IN'), where('paymentStatus', '==', 'PAID'), where('saleDate', '>=', '2026-09-01'), where('saleDate', '<=', '2026-09-30'), orderBy('saleDate', 'desc'), orderBy('createdAt', 'desc'), limit(25)); const result = await assertSucceeds(getDocs(listQuery(testEnv.authenticatedContext(USER).firestore()))); assert.equal(result.size, 1); await assertFails(getDocs(listQuery(testEnv.authenticatedContext(OTHER_ADMIN).firestore()))); await assertFails(getDocs(listQuery(testEnv.unauthenticatedContext().firestore()))); });

test('Sales rules reject non-managers, cross-org writes, malformed payment data, and hard delete', async () => { const userDb = testEnv.authenticatedContext(USER).firestore(); await assertFails(setDoc(doc(userDb, `${salePath()}/user-sale`), saleData(USER, { createdBy: USER, updatedBy: USER }))); const otherDb = testEnv.authenticatedContext(OTHER_ADMIN).firestore(); await assertFails(setDoc(doc(otherDb, `${salePath()}/cross-sale`), saleData(OTHER_ADMIN, { createdBy: OTHER_ADMIN, updatedBy: OTHER_ADMIN }))); const adminDb = testEnv.authenticatedContext(ADMIN).firestore(); await assertFails(setDoc(doc(adminDb, `${salePath()}/bad-payment`), saleData(ADMIN, { paymentStatus: 'PARTIAL', amountPaid: 0, balance: 500 }))); await assertFails(setDoc(doc(adminDb, `${salePath()}/empty`), saleData(ADMIN, { items: [] }))); const ref = doc(adminDb, `${salePath()}/sale-1`); await trustedSale(ref.id); await assertFails(deleteDoc(ref)); });

test('only the void lifecycle transition is permitted after recording a Sale', async () => { const adminDb = testEnv.authenticatedContext(ADMIN).firestore(); const ref = doc(adminDb, `${salePath()}/sale-1`); await trustedSale(ref.id); await assertFails(updateDoc(ref, { total: 1, updatedAt: serverTimestamp(), updatedBy: ADMIN })); await assertSucceeds(updateDoc(ref, { status: 'VOIDED', voidedAt: serverTimestamp(), voidedBy: ADMIN, voidReason: null, updatedAt: serverTimestamp(), updatedBy: ADMIN })); await assertFails(updateDoc(ref, { status: 'ACTIVE', updatedAt: serverTimestamp(), updatedBy: ADMIN })); });

test('browser payment batches are denied; server receipts remain tenant-scoped and immutable', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  const saleRef = doc(adminDb, `${salePath()}/sale-payment`);
  await trustedSale(saleRef.id, saleData(ADMIN, { paymentStatus: 'PARTIAL', amountPaid: 100, balance: 400 }));
  const paymentRef = doc(collection(adminDb, `${salePath()}/sale-payment/payments`));
  const batch = writeBatch(adminDb);
  batch.set(paymentRef, { saleId: 'sale-payment', amount: 200, method: 'GCASH', paymentDate: '2026-09-04', notes: null, createdAt: serverTimestamp(), createdBy: ADMIN });
  batch.update(saleRef, { paymentStatus: 'PARTIAL', paymentMethod: 'GCASH', amountPaid: 300, balance: 200, lastPaymentId: paymentRef.id, updatedAt: serverTimestamp(), updatedBy: ADMIN });
  await assertFails(batch.commit());
  assert.equal((await getDoc(saleRef)).data().amountPaid, 100);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), paymentRef.path), { saleId: saleRef.id, amount: 200, method: 'GCASH', paymentDate: '2026-09-04', notes: null, createdAt: Timestamp.now(), createdBy: ADMIN });
    await updateDoc(doc(context.firestore(), saleRef.path), { amountPaid: 300, balance: 200 });
  });
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext(USER).firestore(), paymentRef.path)));
  await assertFails(getDoc(doc(testEnv.authenticatedContext(OTHER_ADMIN).firestore(), paymentRef.path)));
  await assertFails(updateDoc(paymentRef, { amount: 1 }));

  const orphanRef = doc(collection(adminDb, `${salePath()}/sale-payment/payments`));
  await assertFails(setDoc(orphanRef, { saleId: 'sale-payment', amount: 1, method: 'CASH', paymentDate: '2026-09-04', notes: null, createdAt: serverTimestamp(), createdBy: ADMIN }));
  const overpayRef = doc(collection(adminDb, `${salePath()}/sale-payment/payments`));
  const overpay = writeBatch(adminDb);
  overpay.set(overpayRef, { saleId: 'sale-payment', amount: 201, method: 'CASH', paymentDate: '2026-09-04', notes: null, createdAt: serverTimestamp(), createdBy: ADMIN });
  overpay.update(saleRef, { paymentStatus: 'PAID', paymentMethod: 'CASH', amountPaid: 501, balance: -1, lastPaymentId: overpayRef.id, updatedAt: serverTimestamp(), updatedBy: ADMIN });
  await assertFails(overpay.commit());

  const userDb = testEnv.authenticatedContext(USER).firestore();
  const userPaymentRef = doc(collection(userDb, `${salePath()}/sale-payment/payments`));
  const unauthorized = writeBatch(userDb);
  unauthorized.set(userPaymentRef, { saleId: 'sale-payment', amount: 200, method: 'CASH', paymentDate: '2026-09-04', notes: null, createdAt: serverTimestamp(), createdBy: USER });
  unauthorized.update(doc(userDb, `${salePath()}/sale-payment`), { paymentStatus: 'PAID', paymentMethod: 'CASH', amountPaid: 500, balance: 0, lastPaymentId: userPaymentRef.id, updatedAt: serverTimestamp(), updatedBy: USER });
  await assertFails(unauthorized.commit());
});

test('Sales archive and Trash transitions preserve immutable financial data', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore(); const ref = doc(adminDb, `${salePath()}/sale-lifecycle`);
  await trustedSale(ref.id);
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

test('browser cannot create Deal-linked Sales even with a valid Won Deal and matching Client', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  await testEnv.withSecurityRulesDisabled(async (context) => { const seedDb = context.firestore(); await seedDb.doc(`organizations/${ORG}/clients/client-1`).set({ status: 'ACTIVE', archived: false, trashed: false, name: 'Client One' }); await seedDb.doc(`organizations/${ORG}/deals/deal-1`).set({ status: 'Won', stage: 'Won', clientId: 'client-1' }); });
  const saleRef = doc(adminDb, `${salePath()}/deal-sale`); const lockRef = doc(adminDb, `organizations/${ORG}/dealSaleLocks/deal-1`); const now = Timestamp.fromMillis(Date.now());
  const payload = saleData(ADMIN, { source: 'DEAL', dealId: 'deal-1', customerType: 'CLIENT', customerName: 'Client One', clientId: 'client-1', createdAt: now, updatedAt: now });
  await assertFails(runTransaction(adminDb, async (transaction) => { transaction.set(saleRef, payload); transaction.set(lockRef, { dealId: 'deal-1', saleId: saleRef.id, status: 'ACTIVE', updatedAt: serverTimestamp(), updatedBy: ADMIN }); }));
  await assertFails(setDoc(doc(adminDb, `${salePath()}/bad-deal`), saleData(ADMIN, { source: 'DEAL', dealId: 'deal-1', customerType: 'CLIENT', clientId: 'other-client' })));
});

test('voiding a server-recorded Deal Sale releases its lock without changing the Deal', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN).firestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc(`organizations/${ORG}/clients/client-1`).set({ status: 'ACTIVE', name: 'Client One' });
    await db.doc(`organizations/${ORG}/deals/deal-1`).set({ status: 'Won', stage: 'Won', clientId: 'client-1' });
    await db.doc(`${salePath()}/sale-a`).set(saleData(ADMIN, { source: 'DEAL', dealId: 'deal-1', customerType: 'CLIENT', clientId: 'client-1' }));
    await db.doc(`organizations/${ORG}/dealSaleLocks/deal-1`).set({ dealId: 'deal-1', saleId: 'sale-a', status: 'ACTIVE', updatedBy: ADMIN, updatedAt: Timestamp.now() });
  });
  const batch = writeBatch(adminDb);
  batch.update(doc(adminDb, `${salePath()}/sale-a`), { status: 'VOIDED', voidedAt: serverTimestamp(), voidedBy: ADMIN, voidReason: null, updatedAt: serverTimestamp(), updatedBy: ADMIN });
  batch.update(doc(adminDb, `organizations/${ORG}/dealSaleLocks/deal-1`), { status: 'AVAILABLE', updatedAt: serverTimestamp(), updatedBy: ADMIN });
  await assertSucceeds(batch.commit());
  await assertFails(setDoc(doc(adminDb, `${salePath()}/sale-b`), saleData(ADMIN, { source: 'DEAL', dealId: 'deal-1', customerType: 'CLIENT', clientId: 'client-1' })));
  assert.equal((await getDoc(doc(adminDb, `organizations/${ORG}/deals/deal-1`))).data().status, 'Won');
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
