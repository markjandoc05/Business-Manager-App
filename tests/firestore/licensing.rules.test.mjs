import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG = 'license-test-org';
const ADMIN = 'license-admin';
const MANAGER = 'license-manager';
const USER = 'license-assigned-user';
const LEAD = 'license-lead';
const OTHER_ORG = 'license-other-org';
const OTHER_ADMIN = 'license-other-admin';
let testEnv;

function seedLicense(status, expiresAt = Timestamp.fromMillis(Date.now() + 86_400_000)) {
  const startedAt = Timestamp.fromMillis(Date.now() - 60_000);
  return {
    plan: status === 'TRIAL' ? 'TRIAL' : 'TEAM', status, maxUsers: 3, features: { crm: true },
    trialStartedAt: status === 'TRIAL' ? startedAt : null,
    trialEndsAt: status === 'TRIAL' ? expiresAt : null,
    subscriptionStartedAt: status === 'ACTIVE' ? startedAt : null,
    subscriptionEndsAt: status === 'ACTIVE' ? expiresAt : null,
    createdAt: startedAt, updatedAt: startedAt, updatedBy: ADMIN,
  };
}

async function seed(status = 'ACTIVE', expiresAt = Timestamp.fromMillis(Date.now() + 86_400_000)) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await context.firestore().doc(`organizations/${ORG}`).set({ name: 'License Test', slug: ORG, status: 'trial', licenseStatus: status, licenseWriteEnabled: status === 'TRIAL' || status === 'ACTIVE', licenseExpiresAt: expiresAt });
    await context.firestore().doc(`organizations/${ORG}/members/${ADMIN}`).set({ userId: ADMIN, role: 'ADMIN', status: 'active' });
    await context.firestore().doc(`organizations/${ORG}/members/${MANAGER}`).set({ userId: MANAGER, role: 'MANAGER', status: 'active' });
    await context.firestore().doc(`organizations/${ORG}/members/${USER}`).set({ userId: USER, role: 'USER', status: 'active' });
    await Promise.all([ADMIN, MANAGER, USER].map((uid) => context.firestore().doc(`users/${uid}`).set({ uid, status: 'active', active: true })));
    await context.firestore().doc(`organizations/${ORG}/leads/${LEAD}`).set({ name: 'Lead', company: 'Company', email: '', phone: '', source: 'Other', status: 'New', assignedTo: USER, assignedToUid: USER, assignedToName: USER, createdAt: Timestamp.now(), createdBy: ADMIN, updatedAt: Timestamp.now(), updatedBy: ADMIN, archived: false });
    await context.firestore().doc(`organizations/${ORG}/settings/settings`).set({ businessName: 'License Test' });
    await context.firestore().doc(`organizations/${ORG}/license/current`).set(seedLicense(status, expiresAt));
    assert.ok(db);
  });
}

before(async () => { testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } }); });
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => testEnv.cleanup());

test('active organization ADMIN can persist and read back business settings', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertSucceeds(getDoc(doc(db, `organizations/${ORG}/license/current`)));
  await assertSucceeds(updateDoc(doc(db, `organizations/${ORG}/settings/settings`), {
    businessName: 'Updated',
    businessType: 'Agency',
    email: 'updated@example.test',
    phone: '+63 900 000 0000',
    website: 'https://updated.example',
    address: 'Updated address',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    logoUrl: 'https://cdn.example/logo.png',
    accentColor: '#123456',
    pipelineStages: [{ name: 'Opportunity', isActive: true }],
    leadSources: [{ name: 'Partner', isActive: true }],
  }));
  const saved = await getDoc(doc(db, `organizations/${ORG}/settings/settings`));
  assert.deepEqual(saved.data(), {
    businessName: 'Updated',
    businessType: 'Agency',
    email: 'updated@example.test',
    phone: '+63 900 000 0000',
    website: 'https://updated.example',
    address: 'Updated address',
    currency: 'PHP',
    timezone: 'Asia/Manila',
    logoUrl: 'https://cdn.example/logo.png',
    accentColor: '#123456',
    pipelineStages: [{ name: 'Opportunity', isActive: true }],
    leadSources: [{ name: 'Partner', isActive: true }],
  });
});

test('active organization ADMIN can atomically persist changed settings with the required audit activity', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, `organizations/${ORG}/settings/settings`), { businessName: 'Changed with audit' }, { merge: true });
  batch.set(doc(db, `organizations/${ORG}/activities/settings-update`), {
    type: 'settings_update',
    description: 'Business settings updated',
    entityType: 'Settings',
    createdAt: serverTimestamp(),
    createdBy: ADMIN,
  });

  await assertSucceeds(batch.commit());
  const saved = await getDoc(doc(db, `organizations/${ORG}/settings/settings`));
  assert.equal(saved.data()?.businessName, 'Changed with audit');
});

test('a no-op settings write with a settings-update activity is denied, so callers must not create that audit record', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, `organizations/${ORG}/settings/settings`), { businessName: 'License Test' }, { merge: true });
  batch.set(doc(db, `organizations/${ORG}/activities/settings-no-op`), {
    type: 'settings_update',
    description: 'Business settings updated',
    entityType: 'Settings',
    createdAt: serverTimestamp(),
    createdBy: ADMIN,
  });

  await assert.rejects(batch.commit(), (error) => error?.code === 'permission-denied');
});

test('active MANAGER and USER can read settings but cannot update them', async () => {
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext(MANAGER).firestore(), `organizations/${ORG}/settings/settings`)));
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext(USER).firestore(), `organizations/${ORG}/settings/settings`)));
  await assertFails(updateDoc(doc(testEnv.authenticatedContext(MANAGER).firestore(), `organizations/${ORG}/settings/settings`), { businessName: 'Manager edit' }));
  await assertFails(updateDoc(doc(testEnv.authenticatedContext(USER).firestore(), `organizations/${ORG}/settings/settings`), { businessName: 'User edit' }));
});

test('inactive and cross-tenant members cannot update business settings', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc(`organizations/${ORG}/members/${ADMIN}`).update({ status: 'inactive' });
    await db.doc(`organizations/${OTHER_ORG}`).set({ name: 'Other', slug: OTHER_ORG, status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: Timestamp.fromMillis(Date.now() + 86_400_000) });
    await db.doc(`organizations/${OTHER_ORG}/members/${OTHER_ADMIN}`).set({ userId: OTHER_ADMIN, role: 'ADMIN', status: 'active' });
    await db.doc(`organizations/${OTHER_ORG}/license/current`).set(seedLicense('ACTIVE'));
    await db.doc(`organizations/${OTHER_ORG}/settings/settings`).set({ businessName: 'Other' });
  });
  await assertFails(updateDoc(doc(testEnv.authenticatedContext(ADMIN).firestore(), `organizations/${ORG}/settings/settings`), { businessName: 'Inactive' }));
  await assertFails(updateDoc(doc(testEnv.authenticatedContext(OTHER_ADMIN).firestore(), `organizations/${ORG}/settings/settings`), { businessName: 'Cross tenant' }));
});

test('missing or malformed canonical licenses cannot be bypassed through a writable organization mirror', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`organizations/${ORG}/license/current`).delete();
  });
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertFails(updateDoc(doc(db, `organizations/${ORG}/settings/settings`), { businessName: 'Missing canonical license' }));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`organizations/${ORG}/license/current`).set({ plan: 'TEAM', status: 'ACTIVE', maxUsers: '3' });
  });
  await assertFails(updateDoc(doc(db, `organizations/${ORG}/settings/settings`), { businessName: 'Malformed canonical license' }));
});

test('protected settings fields remain rejected', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertFails(updateDoc(doc(db, `organizations/${ORG}/settings/settings`), { updatedBy: ADMIN }));
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

test('tenant ADMIN cannot directly change an existing membership', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertFails(updateDoc(doc(db, `organizations/${ORG}/members/${USER}`), { status: 'inactive' }));
});

for (const [role, uid] of [['ADMIN', ADMIN], ['MANAGER', MANAGER], ['assigned USER', USER]]) {
  for (const status of ['SUSPENDED', 'EXPIRED']) {
    test(`${role} cannot update a lead while the license is ${status}`, async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(`organizations/${ORG}`).update({ status: status === 'SUSPENDED' ? 'suspended' : 'expired', licenseStatus: status, licenseWriteEnabled: false, licenseExpiresAt: null });
      await context.firestore().doc(`organizations/${ORG}/license/current`).update({ status });
    });
      const db = testEnv.authenticatedContext(uid).firestore();
      await assertFails(updateDoc(doc(db, `organizations/${ORG}/leads/${LEAD}`), { name: 'Blocked', updatedBy: uid }));
    });
  }
}

test('trial after its expiry is denied by the enforcement mirror', async () => {
  const expired = Timestamp.fromMillis(Date.now() - 1_000);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.firestore().doc(`organizations/${ORG}`).update({ licenseStatus: 'TRIAL', licenseWriteEnabled: true, licenseExpiresAt: expired });
    await context.firestore().doc(`organizations/${ORG}/license/current`).update({ status: 'TRIAL', trialEndsAt: expired });
  });
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await assertFails(updateDoc(doc(db, `organizations/${ORG}/settings/settings`), { businessName: 'Blocked' }));
});
