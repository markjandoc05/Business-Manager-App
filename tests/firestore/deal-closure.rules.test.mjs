import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp, updateDoc, serverTimestamp } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG_ID = 'closure-rules-org';
const ADMIN_UID = 'closure-rules-admin';
const DEAL_ID = 'closure-deal';
const baseTimestamp = Timestamp.fromMillis(1_700_000_000_000);
let testEnv;

function dealPath() { return `organizations/${ORG_ID}/deals/${DEAL_ID}`; }

function activeDeal() {
  return {
    title: 'Closure test', clientId: 'client-1', leadId: null, value: 100, stage: 'New', status: 'Active', expectedCloseDate: '',
    assignedToUid: ADMIN_UID, assignedToName: 'Admin', archived: false,
    createdBy: ADMIN_UID, updatedBy: ADMIN_UID, createdAt: baseTimestamp, updatedAt: baseTimestamp,
    wonAt: null, lostAt: null, lossReason: null,
  };
}

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, `organizations/${ORG_ID}`), { status: 'trial', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: null }),
      setDoc(doc(db, `organizations/${ORG_ID}/members/${ADMIN_UID}`), { userId: ADMIN_UID, role: 'ADMIN', status: 'active' }),
      setDoc(doc(db, `users/${ADMIN_UID}`), { uid: ADMIN_UID, status: 'active', active: true }),
      setDoc(doc(db, `organizations/${ORG_ID}/clients/client-1`), { status: 'ACTIVE' }),
      setDoc(doc(db, dealPath()), activeDeal()),
    ]);
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => testEnv.cleanup());

test('ACTIVE to WON requires a server timestamp and clears lostAt', async () => {
  const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
  await assertSucceeds(updateDoc(doc(db, dealPath()), { stage: 'Won', status: 'Won', wonAt: serverTimestamp(), lostAt: null, lossReason: null }));
  const saved = (await getDoc(doc(db, dealPath()))).data();
  if (!saved.wonAt || saved.lostAt !== null) throw new Error('Won closure fields were not persisted correctly.');
});

test('client cannot provide a fake Won date', async () => {
  const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
  await assertFails(updateDoc(doc(db, dealPath()), { stage: 'Won', status: 'Won', wonAt: Timestamp.fromMillis(1), lostAt: null, lossReason: null }));
});

test('ordinary Won edit preserves wonAt and reopening clears closure fields', async () => {
  const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
  const wonAt = Timestamp.fromMillis(1_710_000_000_000);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), dealPath()), { stage: 'Won', status: 'Won', wonAt, lostAt: null });
  });
  await assertSucceeds(updateDoc(doc(db, dealPath()), { title: 'Edited closure test', status: 'Won', stage: 'Won' }));
  if ((await getDoc(doc(db, dealPath()))).data().wonAt.toMillis() !== wonAt.toMillis()) throw new Error('wonAt changed during ordinary edit.');
  await assertSucceeds(updateDoc(doc(db, dealPath()), { stage: 'New', status: 'Active', wonAt: null, lostAt: null }));
});

test('invalid Active closure fields are rejected', async () => {
  const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
  await assertFails(updateDoc(doc(db, dealPath()), { wonAt: baseTimestamp }));
});

test('canonical active stages remain Active with null closure fields', async () => {
  const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
  for (const stage of ['Qualified', 'Proposal', 'Negotiation']) {
    await assertSucceeds(updateDoc(doc(db, dealPath()), { stage, status: 'Active', wonAt: null, lostAt: null }));
  }
});

test('legacy Opportunity stage is rejected for Deals', async () => {
  const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
  await assertFails(updateDoc(doc(db, dealPath()), { stage: 'Opportunity', status: 'Active', wonAt: null, lostAt: null }));
});
