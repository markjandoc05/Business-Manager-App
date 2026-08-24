import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, Timestamp, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'bsm-client-app-web';
const ORG = 'license-test-org';
const ADMIN = 'license-admin';
let testEnv;

function seedLicense(status, expiresAt = null) {
  return { plan: status === 'TRIAL' ? 'TRIAL' : 'TEAM', status, maxUsers: 3, features: { crm: true }, trialEndsAt: status === 'TRIAL' ? expiresAt : null, subscriptionEndsAt: status === 'ACTIVE' ? expiresAt : null, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), updatedBy: ADMIN };
}

async function seed(status = 'ACTIVE', expiresAt = null) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await context.firestore().doc(`organizations/${ORG}`).set({ name: 'License Test', slug: ORG, status: 'trial', licenseStatus: status, licenseWriteEnabled: status === 'TRIAL' || status === 'ACTIVE', licenseExpiresAt: expiresAt });
    await context.firestore().doc(`organizations/${ORG}/members/${ADMIN}`).set({ userId: ADMIN, role: 'ADMIN', status: 'active' });
    await context.firestore().doc(`organizations/${ORG}/settings/settings`).set({ businessName: 'License Test' });
    await context.firestore().doc(`organizations/${ORG}/license/current`).set(seedLicense(status, expiresAt));
    assert.ok(db);
  });
}

before(async () => { testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } }); });
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => testEnv.cleanup());

test('active organization ADMIN can read and update business settings', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertSucceeds(getDoc(doc(db, `organizations/${ORG}/license/current`)));
  await assertSucceeds(updateDoc(doc(db, `organizations/${ORG}/settings/settings`), { businessName: 'Updated' }));
});

test('expired organization remains readable but business writes are denied', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`organizations/${ORG}`).update({ status: 'expired', licenseStatus: 'EXPIRED', licenseWriteEnabled: false, licenseExpiresAt: null });
    await context.firestore().doc(`organizations/${ORG}/license/current`).update({ status: 'EXPIRED' });
  });
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertSucceeds(getDoc(doc(db, `organizations/${ORG}/settings/settings`)));
  await assertFails(updateDoc(doc(db, `organizations/${ORG}/settings/settings`), { businessName: 'Blocked' }));
});

test('suspended organization remains readable but business writes are denied', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`organizations/${ORG}`).update({ status: 'suspended', licenseStatus: 'SUSPENDED', licenseWriteEnabled: false, licenseExpiresAt: null });
    await context.firestore().doc(`organizations/${ORG}/license/current`).update({ status: 'SUSPENDED' });
  });
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertSucceeds(getDoc(doc(db, `organizations/${ORG}/settings/settings`)));
  await assertFails(updateDoc(doc(db, `organizations/${ORG}/settings/settings`), { businessName: 'Blocked' }));
});

test('tenant ADMIN cannot modify the organization license', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertFails(updateDoc(doc(db, `organizations/${ORG}/license/current`), { status: 'ACTIVE' }));
});

test('trial after its expiry is denied by the enforcement mirror', async () => {
  const expired = Timestamp.fromMillis(Date.now() - 1_000);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`organizations/${ORG}`).update({ licenseStatus: 'TRIAL', licenseWriteEnabled: true, licenseExpiresAt: expired });
    await context.firestore().doc(`organizations/${ORG}/license/current`).update({ status: 'TRIAL', trialEndsAt: expired });
  });
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertFails(updateDoc(doc(db, `organizations/${ORG}/settings/settings`), { businessName: 'Blocked' }));
});
