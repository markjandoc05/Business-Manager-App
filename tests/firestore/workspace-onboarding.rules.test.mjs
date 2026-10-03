import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collectionGroup, doc, getDoc, getDocs, query, runTransaction, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const NEW_UID = 'onboarding-new-user';
const EXISTING_UID = 'onboarding-existing-user';
const OTHER_UID = 'onboarding-other-user';
const EXISTING_ORG_ID = 'onboarding-existing-org';
let testEnv;

function legacyBootstrapPayload(db, uid = NEW_UID, organizationId = `forged-${uid}`, slug = `forged-${uid}`) {
  const timestamp = Timestamp.now();
  const trialEndsAt = Timestamp.fromMillis(Date.now() + 14 * 24 * 60 * 60 * 1000);
  return {
    organizationRef: doc(db, 'organizations', organizationId),
    memberRef: doc(db, 'organizations', organizationId, 'members', uid),
    settingsRef: doc(db, 'organizations', organizationId, 'settings', 'settings'),
    licenseRef: doc(db, 'organizations', organizationId, 'license', 'current'),
    slugRef: doc(db, 'organizationSlugs', slug),
    bootstrapRef: doc(db, 'workspaceBootstrap', uid),
    profileRef: doc(db, 'users', uid),
    organization: {
      name: 'Forged Workspace', slug, businessType: 'Agency', status: 'trial', plan: 'trial', subscriptionStatus: 'trial', maxUsers: 3,
      licenseStatus: 'TRIAL', licenseWriteEnabled: true, licenseExpiresAt: trialEndsAt, createdAt: timestamp, updatedAt: timestamp, createdByUid: uid,
    },
    membership: { userId: uid, email: `${uid}@example.test`, displayName: 'Forged Owner', role: 'ADMIN', status: 'active', joinedAt: timestamp, activatedAt: timestamp, activatedBy: uid },
    settings: {
      businessName: 'Forged Workspace', businessType: 'Agency', email: `${uid}@example.test`, phone: '', website: '', address: '',
      currency: 'PHP', timezone: 'Asia/Manila', logoUrl: '', accentColor: '#3b82f6', pipelineStages: [{ name: 'New', isActive: true }], leadSources: [{ name: 'Website', isActive: true }],
    },
    license: { plan: 'TRIAL', status: 'TRIAL', trialStartedAt: timestamp, trialEndsAt, maxUsers: 3, features: { crm: true }, createdAt: timestamp, updatedAt: timestamp, updatedBy: uid },
    slug: { organizationId, slug, createdAt: timestamp, createdByUid: uid },
    bootstrap: { organizationId, createdAt: timestamp, createdByUid: uid },
  };
}

async function attemptLegacyBootstrap(db, payload) {
  return runTransaction(db, async (transaction) => {
    transaction.set(payload.organizationRef, payload.organization);
    transaction.set(payload.slugRef, payload.slug);
    transaction.set(payload.memberRef, payload.membership);
    transaction.set(payload.settingsRef, payload.settings);
    transaction.set(payload.licenseRef, payload.license);
    transaction.set(payload.bootstrapRef, payload.bootstrap);
    transaction.update(payload.profileRef, { status: 'active', active: true });
  });
}

async function seedExistingWorkspace() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const now = Timestamp.fromMillis(Date.now() - 60_000);
    const expiry = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await Promise.all([
      db.doc(`users/${NEW_UID}`).set({ uid: NEW_UID, role: 'USER', status: 'pending', active: false }),
      db.doc(`users/${EXISTING_UID}`).set({ uid: EXISTING_UID, role: 'USER', status: 'active', active: true }),
      db.doc(`users/${OTHER_UID}`).set({ uid: OTHER_UID, role: 'USER', status: 'active', active: true }),
      db.doc(`organizations/${EXISTING_ORG_ID}`).set({
        name: 'Existing Workspace', slug: 'existing-workspace', businessType: 'Agency', status: 'active', plan: 'TEAM', subscriptionStatus: 'active', maxUsers: 3,
        licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: expiry, createdAt: now, updatedAt: now, createdByUid: 'platform',
      }),
      db.doc(`organizations/${EXISTING_ORG_ID}/members/${EXISTING_UID}`).set({ userId: EXISTING_UID, role: 'ADMIN', status: 'active', joinedAt: now, activatedAt: now, activatedBy: 'platform' }),
      db.doc(`organizations/${EXISTING_ORG_ID}/settings/settings`).set({
        businessName: 'Existing Workspace', businessType: 'Agency', email: 'existing@example.test', phone: '', website: '', address: '',
        currency: 'PHP', timezone: 'Asia/Manila', logoUrl: '', accentColor: '#3b82f6', pipelineStages: [{ name: 'New', isActive: true }], leadSources: [{ name: 'Website', isActive: true }],
      }),
      db.doc(`organizations/${EXISTING_ORG_ID}/license/current`).set({
        plan: 'TEAM', status: 'ACTIVE', maxUsers: 3, features: { crm: true }, subscriptionStartedAt: now, subscriptionEndsAt: expiry, createdAt: now, updatedAt: now, updatedBy: 'platform',
      }),
      db.doc(`workspaceBootstrap/${EXISTING_UID}`).set({ organizationId: EXISTING_ORG_ID, createdAt: now, createdByUid: EXISTING_UID }),
    ]);
  });
}

async function assertPayloadWasNotCreated(payload) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const [organization, membership, settings, license, slug, bootstrap] = await Promise.all([
      db.doc(payload.organizationRef.path).get(),
      db.doc(payload.memberRef.path).get(),
      db.doc(payload.settingsRef.path).get(),
      db.doc(payload.licenseRef.path).get(),
      db.doc(payload.slugRef.path).get(),
      db.doc(payload.bootstrapRef.path).get(),
    ]);
    assert.equal(organization.exists, false);
    assert.equal(membership.exists, false);
    assert.equal(settings.exists, false);
    assert.equal(license.exists, false);
    assert.equal(slug.exists, false);
    assert.equal(bootstrap.exists, false);
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedExistingWorkspace();
});

after(async () => testEnv.cleanup());

test('a browser may create only its own pending profile before Platform provisioning', async () => {
  const uid = 'profile-only-user';
  const db = testEnv.authenticatedContext(uid).firestore();
  const profile = doc(db, 'users', uid);
  const now = Timestamp.now();

  await assertSucceeds(setDoc(profile, {
    uid, name: 'Pending User', email: 'pending@example.test', displayName: 'Pending User', photoURL: '', role: 'USER', status: 'pending', active: false, createdAt: now,
  }));
  await assertFails(setDoc(doc(db, 'users', `${uid}-active`), {
    uid: `${uid}-active`, role: 'USER', status: 'active', active: true, createdAt: now,
  }));
});

test('the retired browser bootstrap transaction is denied atomically and leaves no provisioning records', async () => {
  const db = testEnv.authenticatedContext(NEW_UID).firestore();
  const payload = legacyBootstrapPayload(db);

  await assertFails(attemptLegacyBootstrap(db, payload));
  await assertPayloadWasNotCreated(payload);
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const profile = await context.firestore().doc(`users/${NEW_UID}`).get();
    assert.equal(profile.data()?.status, 'pending');
    assert.equal(profile.data()?.active, false);
  });
});

test('browser clients cannot directly create an organization, privileged membership, canonical license, slug, or bootstrap guard', async () => {
  const db = testEnv.authenticatedContext(NEW_UID).firestore();
  const payload = legacyBootstrapPayload(db, NEW_UID, 'direct-provisioning-org', 'direct-provisioning-slug');

  await assertFails(setDoc(payload.organizationRef, payload.organization));
  await assertFails(setDoc(payload.memberRef, payload.membership));
  await assertFails(setDoc(payload.licenseRef, payload.license));
  await assertFails(setDoc(payload.slugRef, payload.slug));
  await assertFails(setDoc(payload.bootstrapRef, payload.bootstrap));
  await assertFails(updateDoc(payload.profileRef, { status: 'active', active: true }));
  await assertPayloadWasNotCreated(payload);
});

test('an existing organization ADMIN can still read its workspace, discover membership, and update allowed settings', async () => {
  const db = testEnv.authenticatedContext(EXISTING_UID).firestore();
  await assertSucceeds(getDoc(doc(db, `organizations/${EXISTING_ORG_ID}`)));
  await assertSucceeds(getDoc(doc(db, `organizations/${EXISTING_ORG_ID}/members/${EXISTING_UID}`)));
  await assertSucceeds(getDoc(doc(db, `organizations/${EXISTING_ORG_ID}/license/current`)));
  await assertSucceeds(getDoc(doc(db, `workspaceBootstrap/${EXISTING_UID}`)));
  await assertSucceeds(updateDoc(doc(db, `organizations/${EXISTING_ORG_ID}/settings/settings`), { businessName: 'Existing Workspace Updated' }));

  const memberships = await getDocs(query(
    collectionGroup(db, 'members'),
    where('userId', '==', EXISTING_UID),
    where('role', 'in', ['ADMIN', 'MANAGER', 'USER']),
    where('status', 'in', ['pending', 'active', 'inactive', 'suspended', 'archived']),
  ));
  assert.deepEqual(memberships.docs.map((item) => item.ref.parent.parent?.id), [EXISTING_ORG_ID]);
});

test('an organization ADMIN cannot mutate tenant root mirrors, canonical license, or memberships through Firestore', async () => {
  const db = testEnv.authenticatedContext(EXISTING_UID).firestore();
  await assertFails(updateDoc(doc(db, `organizations/${EXISTING_ORG_ID}`), { licenseStatus: 'EXPIRED', licenseWriteEnabled: false }));
  await assertFails(updateDoc(doc(db, `organizations/${EXISTING_ORG_ID}/license/current`), { status: 'EXPIRED', maxUsers: 999 }));
  await assertFails(updateDoc(doc(db, `organizations/${EXISTING_ORG_ID}/members/${EXISTING_UID}`), { role: 'USER', status: 'inactive' }));
});

test('an unrelated active user cannot read or write another tenant', async () => {
  const db = testEnv.authenticatedContext(OTHER_UID).firestore();
  await assertFails(getDoc(doc(db, `organizations/${EXISTING_ORG_ID}`)));
  await assertFails(getDoc(doc(db, `organizations/${EXISTING_ORG_ID}/members/${EXISTING_UID}`)));
  await assertFails(getDoc(doc(db, `organizations/${EXISTING_ORG_ID}/license/current`)));
  await assertFails(updateDoc(doc(db, `organizations/${EXISTING_ORG_ID}/settings/settings`), { businessName: 'Cross-tenant attempt' }));
});
