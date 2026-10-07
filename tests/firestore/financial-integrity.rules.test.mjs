import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const projectId = 'demo-bsm-client-app';
const org = 'finance-regression';
const uid = 'finance-admin';
let environment;
const salePath = `organizations/${org}/sales/sale`;
const sampleSale = () => ({ saleNumber: 'S-REGRESSION', saleDate: '2026-10-07', customerType: 'WALK_IN', customerName: 'Synthetic customer', clientId: null, items: [{ source: 'OTHER', catalogItemId: null, type: null, name: 'Service', code: '', categoryId: null, category: '', unit: '', regularPrice: 500, salePrice: null, quantity: 1, unitPrice: 500, subtotal: 500 }], subtotal: 500, total: 500, paymentStatus: 'PARTIAL', paymentMethod: 'CASH', amountPaid: 100, balance: 400, notes: null, status: 'ACTIVE', archived: false, archivedAt: null, archivedBy: null, trashed: false, trashedAt: null, trashedBy: null, createdAt: Timestamp.now(), createdBy: uid, updatedAt: Timestamp.now(), updatedBy: uid });
before(async () => { environment = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } }); });
beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const expiry = Timestamp.fromMillis(Date.now() + 86400000);
    await db.doc(`users/${uid}`).set({ uid, status: 'active', active: true });
    await db.doc(`organizations/${org}`).set({ status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: expiry });
    await db.doc(`organizations/${org}/license/current`).set({ status: 'ACTIVE', plan: 'TEAM', maxUsers: 3, subscriptionStartedAt: Timestamp.now(), subscriptionEndsAt: expiry });
    await db.doc(`organizations/${org}/members/${uid}`).set({ userId: uid, status: 'active', role: 'ADMIN' });
    await db.doc(salePath).set(sampleSale());
    await db.doc(`${salePath}/payments/previous`).set({ saleId: 'sale', amount: 100, method: 'CASH', paymentDate: '2026-10-07', notes: null, createdAt: Timestamp.now(), createdBy: uid });
    await db.doc(`organizations/${org}/clients/client`).set({ name: 'Historical Client' });
    await db.doc(`${salePath}-historical`).set({ ...sampleSale(), source: 'DEAL', dealId: 'deal', clientId: 'client', customerType: 'CLIENT', status: 'VOIDED' });
    await db.doc(`organizations/${org}/deals/deal`).set({ title: 'Reopened historical Deal', status: 'Active', stage: 'New', clientId: 'client', archived: true });
    await db.doc(`organizations/${org}/dealSaleLocks/deal`).set({ dealId: 'deal', saleId: 'sale-historical', status: 'AVAILABLE' });
  });
});
after(async () => environment.cleanup());

test('an immutable previous payment cannot be replayed as another aggregate increase', async () => {
  const db = environment.authenticatedContext(uid).firestore();
  await assertFails(updateDoc(doc(db, salePath), { paymentStatus: 'PARTIAL', paymentMethod: 'CASH', amountPaid: 200, balance: 300, lastPaymentId: 'previous', updatedAt: serverTimestamp(), updatedBy: uid }));
  assert.equal((await getDoc(doc(db, salePath))).data().amountPaid, 100);
});

test('direct manager creation cannot bypass authoritative item validation', async () => {
  const db = environment.authenticatedContext(uid).firestore();
  const payload = sampleSale();
  payload.items[0].quantity = -3;
  payload.items[0].subtotal = -3;
  await assertFails(setDoc(doc(db, `organizations/${org}/sales/malformed`), payload));
});

test('direct deletion cannot orphan a Deal financial reference', async () => {
  const db = environment.authenticatedContext(uid).firestore();
  await assertFails(deleteDoc(doc(db, `organizations/${org}/deals/deal`)));
});
