import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG = 'settings-focused-org';
const OTHER_ORG = 'settings-focused-other-org';
const ADMIN = 'settings-focused-admin';
const MANAGER = 'settings-focused-manager';
const USER = 'settings-focused-user';
const OTHER_ADMIN = 'settings-focused-other-admin';
let testEnv;

function validLicense(status = 'ACTIVE', expiresAt = Timestamp.fromMillis(Date.now() + 86_400_000)) {
  const startedAt = Timestamp.fromMillis(Date.now() - 60_000);
  return {
    plan: status === 'TRIAL' ? 'TRIAL' : 'TEAM',
    status,
    maxUsers: 3,
    trialStartedAt: status === 'TRIAL' ? startedAt : null,
    trialEndsAt: status === 'TRIAL' ? expiresAt : null,
    subscriptionStartedAt: status === 'ACTIVE' ? startedAt : null,
    subscriptionEndsAt: status === 'ACTIVE' ? expiresAt : null,
    createdAt: startedAt,
    updatedAt: startedAt,
    updatedBy: ADMIN,
  };
}

async function seed() {
  const expiresAt = Timestamp.fromMillis(Date.now() + 86_400_000);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc(`organizations/${ORG}`).set({
      name: 'Settings Focused Organization', slug: ORG, status: 'active',
      licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: expiresAt,
    });
    await db.doc(`organizations/${ORG}/license/current`).set(validLicense('ACTIVE', expiresAt));
    await db.doc(`organizations/${ORG}/members/${ADMIN}`).set({ userId: ADMIN, role: 'ADMIN', status: 'active' });
    await db.doc(`organizations/${ORG}/members/${MANAGER}`).set({ userId: MANAGER, role: 'MANAGER', status: 'active' });
    await db.doc(`organizations/${ORG}/members/${USER}`).set({ userId: USER, role: 'USER', status: 'active' });
    await db.doc(`organizations/${ORG}/settings/settings`).set({
      businessName: 'Initial Settings', currency: 'PHP', timezone: 'Asia/Manila',
      leadSources: [{ name: 'Website', isActive: true }],
    });
    await db.doc(`organizations/${OTHER_ORG}`).set({
      name: 'Other Organization', slug: OTHER_ORG, status: 'active',
      licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: expiresAt,
    });
    await db.doc(`organizations/${OTHER_ORG}/license/current`).set(validLicense('ACTIVE', expiresAt));
    await db.doc(`organizations/${OTHER_ORG}/members/${OTHER_ADMIN}`).set({ userId: OTHER_ADMIN, role: 'ADMIN', status: 'active' });
    await db.doc(`organizations/${OTHER_ORG}/settings/settings`).set({ businessName: 'Other Settings' });
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

test('ADMIN can save every persisted settings field and read it back', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const settingsRef = doc(db, `organizations/${ORG}/settings/settings`);
  await assertSucceeds(updateDoc(settingsRef, {
    businessName: 'Updated Settings', businessType: 'Agency', email: 'admin@example.test',
    phone: '+63 900 000 0000', website: 'https://example.test', address: 'Manila',
    currency: 'PHP', timezone: 'Asia/Manila', logoUrl: '', accentColor: '#123456',
    pipelineStages: [{ name: 'Opportunity', isActive: true }],
    leadSources: [{ name: 'Referral', isActive: true }],
  }));
  const saved = await getDoc(settingsRef);
  assert.equal(saved.data()?.businessName, 'Updated Settings');
  assert.equal(saved.data()?.currency, 'PHP');
  assert.deepEqual(saved.data()?.pipelineStages, [{ name: 'Opportunity', isActive: true }]);
});

test('MANAGER and USER can read settings but cannot write them', async () => {
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext(MANAGER).firestore(), `organizations/${ORG}/settings/settings`)));
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext(USER).firestore(), `organizations/${ORG}/settings/settings`)));
  await assertFails(updateDoc(doc(testEnv.authenticatedContext(MANAGER).firestore(), `organizations/${ORG}/settings/settings`), { businessName: 'Nope' }));
  await assertFails(updateDoc(doc(testEnv.authenticatedContext(USER).firestore(), `organizations/${ORG}/settings/settings`), { businessName: 'Nope' }));
});

test('inactive and cross-organization users cannot read or write settings', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`organizations/${ORG}/members/${ADMIN}`).update({ status: 'inactive' });
  });
  const inactiveDb = testEnv.authenticatedContext(ADMIN).firestore();
  await assertFails(getDoc(doc(inactiveDb, `organizations/${ORG}/settings/settings`)));
  await assertFails(updateDoc(doc(inactiveDb, `organizations/${ORG}/settings/settings`), { businessName: 'Nope' }));
  const crossTenantDb = testEnv.authenticatedContext(OTHER_ADMIN).firestore();
  await assertFails(getDoc(doc(crossTenantDb, `organizations/${ORG}/settings/settings`)));
  await assertFails(updateDoc(doc(crossTenantDb, `organizations/${ORG}/settings/settings`), { businessName: 'Nope' }));
});

test('settings change and settings_update activity succeed only as the intended atomic pair', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, `organizations/${ORG}/settings/settings`), { businessName: 'Atomic update' }, { merge: true });
  batch.set(doc(db, `organizations/${ORG}/activities/settings-update`), {
    type: 'settings_update', description: 'Business settings updated', entityType: 'Settings',
    createdAt: serverTimestamp(), createdBy: ADMIN,
  });
  await assertSucceeds(batch.commit());
  const invalidActivity = writeBatch(db);
  invalidActivity.set(doc(db, `organizations/${ORG}/activities/fake-settings-update`), {
    type: 'settings_update', description: 'Fabricated audit', entityType: 'Settings',
    createdAt: serverTimestamp(), createdBy: ADMIN,
  });
  await assertFails(invalidActivity.commit());
});

test('expired, suspended, missing, malformed, or mismatched licenses fail closed', async () => {
  const cases = [
    { name: 'expired', org: { status: 'expired', licenseStatus: 'EXPIRED', licenseWriteEnabled: false, licenseExpiresAt: null }, license: { status: 'EXPIRED' } },
    { name: 'suspended', org: { status: 'suspended', licenseStatus: 'SUSPENDED', licenseWriteEnabled: false, licenseExpiresAt: null }, license: { status: 'SUSPENDED' } },
    { name: 'missing', org: { status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true }, license: null },
    { name: 'malformed', org: { status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true }, license: { status: 'ACTIVE', plan: 'TEAM', maxUsers: '3' } },
    { name: 'mismatched', org: { status: 'active', licenseStatus: 'TRIAL', licenseWriteEnabled: true }, license: { status: 'ACTIVE', maxUsers: 3 } },
  ];
  for (const item of cases) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc(`organizations/${ORG}`).set({
        name: 'Settings Focused Organization', slug: ORG, ...item.org,
      }, { merge: true });
      if (item.license === null) await db.doc(`organizations/${ORG}/license/current`).delete();
      else await db.doc(`organizations/${ORG}/license/current`).set(item.license, { merge: true });
    });
    await assertFails(updateDoc(doc(testEnv.authenticatedContext(ADMIN).firestore(), `organizations/${ORG}/settings/settings`), { businessName: `blocked-${item.name}` }));
    await seed();
  }
});

test('protected or unknown settings fields are denied', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertFails(updateDoc(doc(db, `organizations/${ORG}/settings/settings`), { updatedBy: ADMIN }));
  await assertFails(updateDoc(doc(db, `organizations/${ORG}/settings/settings`), { unknownField: true }));
});
