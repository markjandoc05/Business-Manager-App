import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const PORT = 3101;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const EMULATOR_HOSTS = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'];

if (process.env.GOOGLE_CLOUD_PROJECT === 'bsm-client-app-web' || process.env.GCLOUD_PROJECT === 'bsm-client-app-web') {
  throw new Error('Refusing membership API tests with the production project ID.');
}
if (!EMULATOR_HOSTS.every((name) => process.env[name])) {
  throw new Error(`Membership API tests require ${EMULATOR_HOSTS.join(' and ')}.`);
}

process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = PROJECT_ID;

const app = getApps()[0] || initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
const adminAuth = getAuth(app);
const adminDb = getFirestore(app);
const future = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
let sequence = 0;
let server;

function id(prefix) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

async function createToken(label) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  await adminAuth.createUser({ uid, email, password: 'phase3a-test-password' });
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'phase3a-test-password', returnSecureToken: true }),
  });
  assert.equal(response.ok, true, `Auth emulator sign-in failed for ${label}.`);
  await adminDb.doc(`users/${uid}`).set({ uid, name: label, email, displayName: label, status: 'active', role: 'USER', active: true });
  return { uid, token: (await response.json()).idToken };
}

async function seedOrganization({ maxUsers = 5, members = [], licenseStatus = 'ACTIVE', organizationStatus = 'active', mirrorStatus = licenseStatus, mirrorExpiry = future, includeLicense = true, licenseOverrides = {}, organizationOverrides = {} } = {}) {
  const organizationId = id('org');
  const organizationRef = adminDb.doc(`organizations/${organizationId}`);
  const organization = {
    status: organizationStatus,
    licenseStatus: mirrorStatus,
    licenseWriteEnabled: licenseStatus === 'ACTIVE',
    licenseExpiresAt: mirrorExpiry,
    ...organizationOverrides,
  };
  const writes = [organizationRef.set(organization)];
  for (const member of members) writes.push(organizationRef.collection('members').doc(member.uid).set({ userId: member.uid, role: member.role, status: member.status }));
  if (includeLicense) {
    writes.push(organizationRef.collection('license').doc('current').set({
      plan: 'TEAM',
      status: licenseStatus,
      maxUsers,
      features: { crm: true },
      trialEndsAt: null,
      subscriptionEndsAt: future,
      createdAt: future,
      updatedAt: future,
      updatedBy: 'phase3a-test',
      ...licenseOverrides,
    }));
  }
  await Promise.all(writes);
  return organizationId;
}

async function patchMembership(token, organizationId, memberUid, body) {
  return fetch(`${BASE_URL}/api/organizations/${organizationId}/members/${memberUid}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function expectStatus(responsePromise, expected, message) {
  const response = await responsePromise;
  assert.equal(response.status, expected, `${message} (received ${response.status})`);
  return response;
}

async function expectRejected(responsePromise, message) {
  const response = await responsePromise;
  assert.notEqual(response.status, 200, `${message} unexpectedly succeeded`);
  return response;
}

async function startNext() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GOOGLE_CLOUD_PROJECT: PROJECT_ID,
      GCLOUD_PROJECT: PROJECT_ID,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  server.stdout.on('data', (chunk) => output.push(chunk.toString()));
  server.stderr.on('data', (chunk) => output.push(chunk.toString()));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return;
    } catch {
      // The dev server is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next.js did not become ready.\n${output.join('')}`);
}

before(async () => startNext());
after(async () => {
  if (server) server.kill('SIGTERM');
});

test('unauthenticated callers, USERs, and MANAGERs are rejected while an ADMIN is accepted', async () => {
  const admin = await createToken('admin');
  const manager = await createToken('manager');
  const user = await createToken('user');
  const target = await createToken('target');
  const organizationId = await seedOrganization({ members: [
    { uid: admin.uid, role: 'ADMIN', status: 'active' },
    { uid: manager.uid, role: 'MANAGER', status: 'active' },
    { uid: user.uid, role: 'USER', status: 'active' },
    { uid: target.uid, role: 'USER', status: 'pending' },
  ] });

  await expectStatus(fetch(`${BASE_URL}/api/organizations/${organizationId}/members/${target.uid}`, { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }), 401, 'Unauthenticated caller');
  await expectStatus(patchMembership(user.token, organizationId, target.uid, { status: 'active' }), 403, 'USER caller');
  await expectStatus(patchMembership(manager.token, organizationId, target.uid, { status: 'active' }), 403, 'MANAGER caller');
  await expectStatus(patchMembership(admin.token, organizationId, target.uid, { status: 'active' }), 200, 'ADMIN caller');
});

test('cross-organization ADMIN access is rejected', async () => {
  const adminA = await createToken('admin-a');
  const adminB = await createToken('admin-b');
  const target = await createToken('cross-target');
  const orgA = await seedOrganization({ members: [{ uid: adminA.uid, role: 'ADMIN', status: 'active' }] });
  const orgB = await seedOrganization({ members: [
    { uid: adminB.uid, role: 'ADMIN', status: 'active' },
    { uid: target.uid, role: 'USER', status: 'pending' },
  ] });
  assert.notEqual(orgA, orgB);
  await expectRejected(patchMembership(adminA.token, orgB, target.uid, { status: 'active' }), 'Cross-organization ADMIN');
});

test('missing, malformed, blocked, expired, and mismatched licenses are rejected', async () => {
  const admin = await createToken('license-admin');
  const target = await createToken('license-target');
  const missing = await seedOrganization({ includeLicense: false, members: [{ uid: admin.uid, role: 'ADMIN', status: 'active' }, { uid: target.uid, role: 'USER', status: 'pending' }] });
  await expectRejected(patchMembership(admin.token, missing, target.uid, { status: 'active' }), 'Missing canonical license');

  const malformed = await seedOrganization({ licenseOverrides: { maxUsers: '3' }, members: [{ uid: admin.uid, role: 'ADMIN', status: 'active' }, { uid: target.uid, role: 'USER', status: 'pending' }] });
  await expectStatus(patchMembership(admin.token, malformed, target.uid, { status: 'active' }), 409, 'Malformed canonical license');

  const suspended = await seedOrganization({ licenseStatus: 'SUSPENDED', organizationStatus: 'suspended', mirrorStatus: 'SUSPENDED', members: [{ uid: admin.uid, role: 'ADMIN', status: 'active' }, { uid: target.uid, role: 'USER', status: 'pending' }] });
  await expectStatus(patchMembership(admin.token, suspended, target.uid, { status: 'active' }), 409, 'SUSPENDED license');

  const expired = await seedOrganization({ licenseStatus: 'EXPIRED', organizationStatus: 'expired', mirrorStatus: 'EXPIRED', members: [{ uid: admin.uid, role: 'ADMIN', status: 'active' }, { uid: target.uid, role: 'USER', status: 'pending' }] });
  await expectStatus(patchMembership(admin.token, expired, target.uid, { status: 'active' }), 409, 'EXPIRED license');

  const mismatch = await seedOrganization({ licenseStatus: 'ACTIVE', organizationStatus: 'active', mirrorStatus: 'TRIAL', members: [{ uid: admin.uid, role: 'ADMIN', status: 'active' }, { uid: target.uid, role: 'USER', status: 'pending' }] });
  await expectStatus(patchMembership(admin.token, mismatch, target.uid, { status: 'active' }), 409, 'Canonical/mirror mismatch');
});

test('activation honors exact maxUsers boundaries and rejects reactivation above the limit', async () => {
  const admin = await createToken('boundary-admin');
  const activeUser = await createToken('boundary-active');
  const first = await createToken('boundary-first');
  const second = await createToken('boundary-second');
  const third = await createToken('boundary-third');
  const organizationId = await seedOrganization({ maxUsers: 3, members: [
    { uid: admin.uid, role: 'ADMIN', status: 'active' },
    { uid: activeUser.uid, role: 'USER', status: 'active' },
    { uid: first.uid, role: 'USER', status: 'pending' },
    { uid: second.uid, role: 'USER', status: 'pending' },
    { uid: third.uid, role: 'USER', status: 'pending' },
  ] });
  await expectStatus(patchMembership(admin.token, organizationId, first.uid, { status: 'active' }), 200, 'Activation to maxUsers');
  await expectStatus(patchMembership(admin.token, organizationId, second.uid, { status: 'active' }), 409, 'Activation above maxUsers');

  const reactivation = await seedOrganization({ maxUsers: 2, members: [
    { uid: admin.uid, role: 'ADMIN', status: 'active' },
    { uid: activeUser.uid, role: 'USER', status: 'active' },
    { uid: third.uid, role: 'USER', status: 'inactive' },
  ] });
  await expectStatus(patchMembership(admin.token, reactivation, third.uid, { status: 'active' }), 409, 'Reactivation above maxUsers');
});

test('deactivation releases a seat for later reuse', async () => {
  const admin = await createToken('reuse-admin');
  const activeUser = await createToken('reuse-active');
  const pendingUser = await createToken('reuse-pending');
  const organizationId = await seedOrganization({ maxUsers: 2, members: [
    { uid: admin.uid, role: 'ADMIN', status: 'active' },
    { uid: activeUser.uid, role: 'USER', status: 'active' },
    { uid: pendingUser.uid, role: 'USER', status: 'pending' },
  ] });
  await expectStatus(patchMembership(admin.token, organizationId, activeUser.uid, { status: 'inactive' }), 200, 'Deactivation');
  assert.equal((await adminDb.doc(`users/${activeUser.uid}`).get()).data().status, 'active');
  await expectStatus(patchMembership(admin.token, organizationId, pendingUser.uid, { status: 'active' }), 200, 'Seat reuse');
});

test('concurrent activation cannot exceed maxUsers when one seat remains', async () => {
  const admin = await createToken('concurrent-admin');
  const activeUser = await createToken('concurrent-active');
  const pendingA = await createToken('concurrent-pending-a');
  const pendingB = await createToken('concurrent-pending-b');
  const organizationId = await seedOrganization({ maxUsers: 3, members: [
    { uid: admin.uid, role: 'ADMIN', status: 'active' },
    { uid: activeUser.uid, role: 'USER', status: 'active' },
    { uid: pendingA.uid, role: 'USER', status: 'pending' },
    { uid: pendingB.uid, role: 'USER', status: 'pending' },
  ] });
  const responses = await Promise.all([
    patchMembership(admin.token, organizationId, pendingA.uid, { status: 'active' }),
    patchMembership(admin.token, organizationId, pendingB.uid, { status: 'active' }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
});

test('client-supplied actor, role, counts, limits, and license values cannot influence the route', async () => {
  const admin = await createToken('forged-admin');
  const target = await createToken('forged-target');
  const organizationId = await seedOrganization({ maxUsers: 1, members: [
    { uid: admin.uid, role: 'ADMIN', status: 'active' },
    { uid: target.uid, role: 'USER', status: 'pending' },
  ] });
  const response = await patchMembership(admin.token, organizationId, target.uid, {
    status: 'active',
    actorUid: 'forged-admin',
    actorRole: 'SUPER_ADMIN',
    activeMemberCount: 0,
    maxUsers: 999,
    licenseStatus: 'ACTIVE',
  });
  assert.equal(response.status, 400);
});

test('inactive application users are rejected before organization authorization', async () => {
  const admin = await createToken('inactive-app-admin');
  const target = await createToken('inactive-app-target');
  const organizationId = await seedOrganization({ members: [
    { uid: admin.uid, role: 'ADMIN', status: 'active' },
    { uid: target.uid, role: 'USER', status: 'pending' },
  ] });
  await adminDb.doc(`users/${admin.uid}`).update({ status: 'inactive', active: false });
  await expectStatus(patchMembership(admin.token, organizationId, target.uid, { status: 'active' }), 403, 'Inactive application user');
});

test('revoked Firebase ID tokens are rejected by every protected API entry point', async () => {
  const admin = await createToken('revoked-token-admin');
  const target = await createToken('revoked-token-target');
  const organizationId = await seedOrganization({ members: [
    { uid: admin.uid, role: 'ADMIN', status: 'active' },
    { uid: target.uid, role: 'USER', status: 'pending' },
  ] });
  // Firebase revocation timestamps have one-second precision. Ensure the ID
  // token's auth_time is strictly older than validSince in the emulator.
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  await adminAuth.revokeRefreshTokens(admin.uid);
  await expectStatus(patchMembership(admin.token, organizationId, target.uid, { status: 'active' }), 401, 'Revoked ID token');
});

test('Firebase-disabled users cannot use an otherwise valid ID token', async () => {
  const admin = await createToken('disabled-auth-admin');
  const target = await createToken('disabled-auth-target');
  const organizationId = await seedOrganization({ members: [
    { uid: admin.uid, role: 'ADMIN', status: 'active' },
    { uid: target.uid, role: 'USER', status: 'pending' },
  ] });
  await adminAuth.updateUser(admin.uid, { disabled: true });
  await expectStatus(patchMembership(admin.token, organizationId, target.uid, { status: 'active' }), 401, 'Firebase-disabled user');
});

test('explicit account disablement and reactivation update both Firebase Auth and the app profile', async () => {
  const admin = await createToken('account-action-admin');
  const target = await createToken('account-action-target');
  const organizationId = await seedOrganization({ members: [
    { uid: admin.uid, role: 'ADMIN', status: 'active' },
    { uid: target.uid, role: 'USER', status: 'active' },
  ] });

  await expectStatus(patchMembership(admin.token, organizationId, target.uid, { accountAction: 'disable' }), 200, 'Account disablement');
  assert.equal((await adminAuth.getUser(target.uid)).disabled, true);
  assert.deepEqual((await adminDb.doc(`users/${target.uid}`).get()).data(), {
    uid: target.uid,
    name: 'account-action-target',
    email: `${target.uid}@example.test`,
    displayName: 'account-action-target',
    status: 'disabled',
    role: 'USER',
    active: false,
  });
  assert.equal((await adminDb.doc(`organizations/${organizationId}/members/${target.uid}`).get()).data().status, 'inactive');

  await expectStatus(patchMembership(admin.token, organizationId, target.uid, { accountAction: 'reactivate' }), 200, 'Account reactivation');
  assert.equal((await adminAuth.getUser(target.uid)).disabled, false);
  assert.equal((await adminDb.doc(`users/${target.uid}`).get()).data().status, 'active');
  assert.equal((await adminDb.doc(`users/${target.uid}`).get()).data().active, true);
  assert.equal((await adminDb.doc(`organizations/${organizationId}/members/${target.uid}`).get()).data().status, 'active');
});

test('a non-ADMIN cannot trigger account reactivation', async () => {
  const admin = await createToken('unauthorized-action-admin');
  const user = await createToken('unauthorized-action-user');
  const target = await createToken('unauthorized-action-target');
  const organizationId = await seedOrganization({ members: [
    { uid: admin.uid, role: 'ADMIN', status: 'active' },
    { uid: user.uid, role: 'USER', status: 'active' },
    { uid: target.uid, role: 'USER', status: 'active' },
  ] });
  await expectStatus(patchMembership(admin.token, organizationId, target.uid, { accountAction: 'disable' }), 200, 'Target disablement');
  await expectStatus(patchMembership(user.token, organizationId, target.uid, { accountAction: 'reactivate' }), 403, 'Unauthorized reactivation');
  assert.equal((await adminAuth.getUser(target.uid)).disabled, true);
  assert.equal((await adminDb.doc(`users/${target.uid}`).get()).data().status, 'disabled');
});
