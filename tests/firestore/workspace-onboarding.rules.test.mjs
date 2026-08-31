import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collectionGroup, doc, getDoc, getDocs, query, Timestamp, where, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const CREATOR_UID = 'onboarding-creator';
const OTHER_UID = 'onboarding-other';
const EXISTING_ORG_ID = 'onboarding-existing-org';
const EXISTING_SLUG = 'taken-workspace';

let testEnv;

function onboardingPayload(db, uid = CREATOR_UID, organizationId = `onboarding-${uid}` , slug = 'new-workspace') {
  const orgRef = doc(db, 'organizations', organizationId);
  const memberRef = doc(db, 'organizations', organizationId, 'members', uid);
  const settingsRef = doc(db, 'organizations', organizationId, 'settings', 'settings');
  const licenseRef = doc(db, 'organizations', organizationId, 'license', 'current');
  const slugRef = doc(db, 'organizationSlugs', slug);
  const bootstrapGuardRef = doc(db, 'workspaceBootstrap', uid);
  const userRef = doc(db, 'users', uid);
  const timestamp = Timestamp.now();
  const trialEndsAt = Timestamp.fromMillis(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const org = {
    name: 'New Workspace', slug, businessType: 'Solo Entrepreneur', status: 'trial', plan: 'trial',
    subscriptionStatus: 'trial', maxUsers: 3, licenseStatus: 'TRIAL', licenseWriteEnabled: true, licenseExpiresAt: trialEndsAt, createdAt: timestamp, updatedAt: timestamp, createdByUid: uid,
  };
  const member = { userId: uid, email: `${uid}@example.com`, displayName: 'New Owner', role: 'ADMIN', status: 'active', joinedAt: timestamp, activatedAt: timestamp, activatedBy: uid };
  const settings = {
    businessName: 'New Workspace', businessType: 'Solo Entrepreneur', email: `${uid}@example.com`, phone: '', website: '', address: '',
    currency: 'PHP', timezone: 'Asia/Manila', logoUrl: '', accentColor: '#3b82f6',
    pipelineStages: ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'].map((name) => ({ name, isActive: true })),
    leadSources: [{ name: 'Website', isActive: true }],
  };
  const slugData = { organizationId, slug, createdAt: timestamp, createdByUid: uid };
  const guard = { organizationId, createdAt: timestamp, createdByUid: uid };
  const license = { plan: 'TRIAL', status: 'TRIAL', trialStartedAt: timestamp, trialEndsAt, maxUsers: 3, features: { crm: true }, createdAt: timestamp, updatedAt: timestamp, updatedBy: uid };
  return { orgRef, memberRef, settingsRef, licenseRef, slugRef, bootstrapGuardRef, userRef, org, member, settings, slugData, guard, license };
}

async function seedExisting() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const timestamp = Timestamp.fromMillis(1_700_000_000_000);
    await Promise.all([
      context.firestore().doc(`organizations/${EXISTING_ORG_ID}`).set({ name: 'Existing', slug: EXISTING_SLUG, status: 'trial', licenseStatus: 'TRIAL', licenseWriteEnabled: true, licenseExpiresAt: Timestamp.fromMillis(Date.now() + 14 * 24 * 60 * 60 * 1000) }),
      context.firestore().doc(`organizations/${EXISTING_ORG_ID}/members/${CREATOR_UID}`).set({ userId: CREATOR_UID, role: 'ADMIN', status: 'active' }),
      context.firestore().doc(`users/${CREATOR_UID}`).set({ uid: CREATOR_UID, status: 'pending', active: false }),
      context.firestore().doc(`organizationSlugs/${EXISTING_SLUG}`).set({ organizationId: EXISTING_ORG_ID, slug: EXISTING_SLUG }),
      context.firestore().doc(`organizations/${EXISTING_ORG_ID}/settings/settings`).set({ businessName: 'Existing', currency: 'PHP', timezone: 'Asia/Manila' }),
    ]);
    assert.ok(timestamp);
  });
}

async function commitPayload(db, payload) {
  const batch = writeBatch(db);
  batch.set(payload.orgRef, payload.org);
  batch.set(payload.slugRef, payload.slugData);
  batch.set(payload.memberRef, payload.member);
  batch.update(payload.userRef, { status: 'active', active: true });
  batch.set(payload.settingsRef, payload.settings);
  batch.set(payload.licenseRef, payload.license);
  batch.set(payload.bootstrapGuardRef, payload.guard);
  return batch.commit();
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedExisting();
});

after(async () => testEnv.cleanup());

test('new authenticated user can atomically create an organization and first ADMIN membership', async () => {
  const db = testEnv.authenticatedContext(CREATOR_UID).firestore();
  const payload = onboardingPayload(db);
  await assertSucceeds(commitPayload(db, payload));
  assert.equal((await getDoc(payload.orgRef)).data().createdByUid, CREATOR_UID);
  assert.equal((await getDoc(payload.memberRef)).data().role, 'ADMIN');
  assert.equal((await getDoc(payload.settingsRef)).data().currency, 'PHP');
  assert.equal((await getDoc(payload.licenseRef)).data().status, 'TRIAL');
});

test('creator cannot make another UID the initial ADMIN', async () => {
  const db = testEnv.authenticatedContext(CREATOR_UID).firestore();
  const payload = onboardingPayload(db, OTHER_UID, 'onboarding-invalid-owner', 'invalid-owner');
  await assertFails(commitPayload(db, payload));
});

test('creator cannot bootstrap into an existing organization', async () => {
  const db = testEnv.authenticatedContext(CREATOR_UID).firestore();
  const payload = onboardingPayload(db, CREATOR_UID, EXISTING_ORG_ID, 'existing-claimed');
  await assertFails(commitPayload(db, payload));
});

test('creator cannot claim an existing slug', async () => {
  const db = testEnv.authenticatedContext(CREATOR_UID).firestore();
  const payload = onboardingPayload(db, CREATOR_UID, 'onboarding-slug-conflict', EXISTING_SLUG);
  await assertFails(commitPayload(db, payload));
});

test('a new user cannot query memberships until its application profile is active', async () => {
  const db = testEnv.authenticatedContext('brand-new-user').firestore();
  await assertFails(getDocs(query(
    collectionGroup(db, 'members'),
    where('userId', '==', 'brand-new-user'),
    where('role', 'in', ['ADMIN', 'MANAGER', 'USER']),
    where('status', 'in', ['pending', 'active', 'inactive', 'suspended', 'archived']),
  )));
});
