import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before } from 'node:test';
import { test } from 'node:test';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const EMULATOR_HOSTS = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'];
if (process.env.GOOGLE_CLOUD_PROJECT === 'bsm-client-app-web' || process.env.GCLOUD_PROJECT === 'bsm-client-app-web') throw new Error('Refusing workspace bootstrap tests with the production project ID.');
if (!EMULATOR_HOSTS.every((name) => process.env[name])) throw new Error(`Workspace bootstrap tests require ${EMULATOR_HOSTS.join(', ')}.`);

process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = PROJECT_ID;

const app = getApps()[0] || initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
const adminAuth = getAuth(app);
const adminDb = getFirestore(app);
let sequence = 0;
const PORT = 3105;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;
const id = (prefix) => `${prefix}-${Date.now()}-${++sequence}`;
const future = Timestamp.fromMillis(Date.now() + 30 * 86_400_000);

async function createUser(label, email = `${label}-${Date.now()}@example.test`) {
  const uid = id(label);
  await adminAuth.createUser({ uid, email, emailVerified: true, password: 'workspace-bootstrap-test-password' });
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'workspace-bootstrap-test-password', returnSecureToken: true }),
  });
  assert.equal(response.ok, true);
  return { uid, email, token: (await response.json()).idToken };
}

async function seedOrganization(label, maxUsers = 3) {
  const organizationId = id(`org-${label}`);
  const organization = adminDb.doc(`organizations/${organizationId}`);
  await Promise.all([
    organization.set({ name: label, slug: `${organizationId}-slug`, status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: future }),
    organization.collection('license').doc('current').set({ plan: 'TEAM', status: 'ACTIVE', maxUsers, subscriptionStartedAt: Timestamp.now(), subscriptionEndsAt: future, maxUsers, features: { crm: true } }),
  ]);
  return { organizationId, organization };
}

async function bootstrap(user, body = { email: 'forged@example.com' }) {
  const response = await fetch(`${BASE_URL}/api/auth/bootstrap`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = {
    status: response.status,
    requestId: response.headers.get('x-bootstrap-request-id'),
    serverTiming: response.headers.get('server-timing'),
    body: await response.json(),
  };
  if (process.env.PRINT_BOOTSTRAP_TIMINGS === '1' && result.body.timings) {
    console.info(`[bootstrap-timing] ${JSON.stringify(result.body.timings)}`);
  }
  return result;
}

async function recordLoginActivity(user, { orgId, status, bodyFields = {} }) {
  const response = await fetch(`${BASE_URL}/api/auth/login-activity${status === 'FAILED' ? '/failure' : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${user.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId, ...bodyFields }),
  });
  return { status: response.status, serverTiming: response.headers.get('server-timing'), body: await response.json() };
}

async function startNext() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, GOOGLE_CLOUD_PROJECT: PROJECT_ID, GCLOUD_PROJECT: PROJECT_ID, NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID },
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
after(async () => { if (server) server.kill('SIGTERM'); });

test('existing UID membership activates the profile and is discovered without duplication', async () => {
  const user = await createUser('existing');
  const { organizationId, organization } = await seedOrganization('existing');
  const memberRef = organization.collection('members').doc(user.uid);
  await memberRef.set({ userId: user.uid, email: user.email, role: 'ADMIN', status: 'active' });

  const result = await bootstrap(user);
  assert.equal(result.status, 200);
  assert.match(result.requestId || '', /^[0-9a-f-]{36}$/i);
  assert.equal(typeof result.body.timings?.total, 'number');
  assert.equal(typeof result.body.timings?.['token-verification'], 'number');
  assert.equal(typeof result.body.timings?.['bootstrap-profile-read'], 'number');
  assert.match(result.serverTiming || '', /token-verification;dur=\d+/);
  assert.match(result.serverTiming || '', /bootstrap-profile-read;dur=\d+/);
  assert.equal(result.body.data.profileStatus, 'active');
  assert.equal((await adminDb.doc(`users/${user.uid}`).get()).data().active, true);
  assert.equal((await organization.collection('members').where('userId', '==', user.uid).get()).size, 1);
});

test('Console pending assignment is claimed by verified Firebase email and preserves the assigned role', async () => {
  const user = await createUser('invited');
  const { organizationId, organization } = await seedOrganization('invited');
  const invitation = adminDb.collection('organizationInvitations').doc(id('invitation'));
  await invitation.set({ organizationId, email: user.email, emailNormalized: user.email.toLowerCase(), role: 'MANAGER', status: 'pending' });

  const result = await bootstrap(user, { email: 'different@example.com' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.claimedOrganizations, [organizationId]);
  assert.equal((await organization.collection('members').doc(user.uid).get()).data().role, 'MANAGER');
  assert.equal((await organization.collection('members').doc(user.uid).get()).data().status, 'active');
  assert.equal((await invitation.get()).data().status, 'claimed');
  assert.equal((await adminDb.doc(`users/${user.uid}`).get()).data().status, 'active');
});

test('wrong verified email cannot claim an assignment, and repeated claims remain idempotent', async () => {
  const invited = await createUser('assigned');
  const wrong = await createUser('wrong');
  const { organizationId, organization } = await seedOrganization('wrong-email');
  const invitation = adminDb.collection('organizationInvitations').doc(id('invitation'));
  await invitation.set({ organizationId, email: invited.email, emailNormalized: invited.email.toLowerCase(), role: 'USER', status: 'pending' });

  const denied = await bootstrap(wrong);
  assert.equal(denied.status, 200);
  assert.deepEqual(denied.body.data.claimedOrganizations, []);
  assert.equal((await organization.collection('members').get()).size, 0);
  assert.equal((await invitation.get()).data().status, 'pending');

  await bootstrap(invited);
  await bootstrap(invited);
  assert.equal((await organization.collection('members').where('userId', '==', invited.uid).get()).size, 1);
  assert.equal((await invitation.get()).data().status, 'claimed');
});

test('inactive membership is never auto-reactivated by email or profile bootstrap', async () => {
  const user = await createUser('inactive');
  const { organization } = await seedOrganization('inactive');
  await adminDb.doc(`users/${user.uid}`).set({ uid: user.uid, email: user.email, status: 'active', active: true, role: 'USER' });
  await organization.collection('members').doc(user.uid).set({ userId: user.uid, email: user.email, role: 'USER', status: 'inactive' });
  await adminDb.collection('organizationInvitations').doc(id('invitation')).set({ organizationId: organization.id, email: user.email, emailNormalized: user.email.toLowerCase(), role: 'ADMIN', status: 'pending' });

  const result = await bootstrap(user);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.claimedOrganizations, []);
  const member = (await organization.collection('members').doc(user.uid).get()).data();
  assert.equal(member.status, 'inactive');
  assert.equal(member.lastLoginStatus, 'FAILED');
  assert.equal(member.lastLoginFailureCode, 'MEMBERSHIP_INACTIVE');
});

test('one verified user can claim multiple organization assignments without cross-tenant membership', async () => {
  const user = await createUser('multi');
  const first = await seedOrganization('multi-a');
  const second = await seedOrganization('multi-b');
  for (const organizationId of [first.organizationId, second.organizationId]) {
    await adminDb.collection('organizationInvitations').doc(id('invitation')).set({ organizationId, email: user.email, emailNormalized: user.email.toLowerCase(), role: 'USER', status: 'pending' });
  }

  const result = await bootstrap(user);
  assert.equal(result.status, 200);
  assert.deepEqual(new Set(result.body.data.claimedOrganizations), new Set([first.organizationId, second.organizationId]));
  const memberships = await adminDb.collectionGroup('members').where('userId', '==', user.uid).get();
  assert.deepEqual(new Set(memberships.docs.map((item) => item.ref.parent.parent?.id)), new Set([first.organizationId, second.organizationId]));
});

test('concurrent bootstrap requests are idempotent for the same user', async () => {
  const user = await createUser('concurrent-same-user');
  const { organizationId, organization } = await seedOrganization('concurrent-same-user');
  const invitation = adminDb.collection('organizationInvitations').doc(id('invitation'));
  await invitation.set({ organizationId, email: user.email, emailNormalized: user.email.toLowerCase(), role: 'USER', status: 'pending' });

  const results = await Promise.all(Array.from({ length: 5 }, () => bootstrap(user)));
  assert.ok(results.every((result) => result.status === 200));
  assert.equal((await organization.collection('members').where('userId', '==', user.uid).get()).size, 1);
  assert.equal((await invitation.get()).data().status, 'claimed');
  assert.equal((await adminDb.doc(`users/${user.uid}`).get()).data().active, true);
});

test('concurrent users cannot over-claim a single available seat', async () => {
  const firstUser = await createUser('concurrent-seat-first');
  const secondUser = await createUser('concurrent-seat-second');
  const { organizationId, organization } = await seedOrganization('concurrent-seat-cap', 1);
  const firstInvitation = adminDb.collection('organizationInvitations').doc(id('invitation'));
  const secondInvitation = adminDb.collection('organizationInvitations').doc(id('invitation'));
  await Promise.all([
    firstInvitation.set({ organizationId, email: firstUser.email, emailNormalized: firstUser.email.toLowerCase(), role: 'USER', status: 'pending' }),
    secondInvitation.set({ organizationId, email: secondUser.email, emailNormalized: secondUser.email.toLowerCase(), role: 'USER', status: 'pending' }),
  ]);

  const results = await Promise.all([bootstrap(firstUser), bootstrap(secondUser)]);
  assert.ok(results.every((result) => result.status === 200));
  const members = await organization.collection('members').get();
  assert.equal(members.docs.filter((member) => member.data().status === 'active').length, 1);
  const invitationStatuses = await Promise.all([firstInvitation.get(), secondInvitation.get()]);
  assert.equal(invitationStatuses.filter((snapshot) => snapshot.data().status === 'claimed').length, 1);
  assert.equal(invitationStatuses.filter((snapshot) => snapshot.data().status === 'pending').length, 1);
});

test('login activity is server-controlled, preserves history, and cannot cross organizations', async () => {
  const user = await createUser('login-activity');
  const first = await seedOrganization('login-activity-first');
  const second = await seedOrganization('login-activity-second');
  const memberRef = first.organization.collection('members').doc(user.uid);
  const otherMemberRef = second.organization.collection('members').doc(user.uid);
  await memberRef.set({ userId: user.uid, email: user.email, role: 'USER', status: 'active' });
  await otherMemberRef.set({ userId: user.uid, email: user.email, role: 'USER', status: 'active' });

  const forgedSuccess = await recordLoginActivity(user, { orgId: first.organizationId, status: 'SUCCESS', bodyFields: { lastLoginAt: '2000-01-01T00:00:00.000Z' } });
  assert.equal(forgedSuccess.status, 400);
  const success = await recordLoginActivity(user, { orgId: first.organizationId, status: 'SUCCESS' });
  assert.equal(success.status, 200);
  assert.equal(typeof success.body.timings?.total, 'number');
  assert.equal(typeof success.body.timings?.['token-verification'], 'number');
  assert.equal(typeof success.body.timings?.['activity-member-read'], 'number');
  assert.match(success.serverTiming || '', /activity-member-read;dur=\d+/);
  const afterSuccess = (await memberRef.get()).data();
  assert.equal(afterSuccess.lastLoginStatus, 'SUCCESS');
  assert.ok(afterSuccess.lastLoginAt instanceof Timestamp);
  assert.ok(afterSuccess.lastSuccessfulLoginAt instanceof Timestamp);
  assert.equal(afterSuccess.lastLoginAt.toMillis(), afterSuccess.lastSuccessfulLoginAt.toMillis());

  const forgedFailure = await recordLoginActivity(user, { orgId: first.organizationId, status: 'FAILED', bodyFields: { failureCode: 'raw stack trace: secret', lastFailedLoginAt: '2000-01-01T00:00:00.000Z' } });
  assert.equal(forgedFailure.status, 400);
  const failure = await recordLoginActivity(user, { orgId: first.organizationId, status: 'FAILED' });
  assert.equal(failure.status, 200);
  const afterFailure = (await memberRef.get()).data();
  assert.equal(afterFailure.lastLoginStatus, 'FAILED');
  assert.equal(afterFailure.lastLoginFailureCode, 'WORKSPACE_ACCESS_FAILED');
  assert.ok(afterFailure.lastFailedLoginAt instanceof Timestamp);
  assert.equal(afterFailure.lastSuccessfulLoginAt.toMillis(), afterSuccess.lastSuccessfulLoginAt.toMillis());

  const successAgain = await recordLoginActivity(user, { orgId: first.organizationId, status: 'SUCCESS' });
  assert.equal(successAgain.status, 200);
  const afterSuccessAgain = (await memberRef.get()).data();
  assert.equal(afterSuccessAgain.lastLoginStatus, 'SUCCESS');
  assert.ok(afterSuccessAgain.lastSuccessfulLoginAt.toMillis() >= afterFailure.lastSuccessfulLoginAt.toMillis());
  assert.equal(afterSuccessAgain.lastFailedLoginAt.toMillis(), afterFailure.lastFailedLoginAt.toMillis());

  const forgedOrganization = await recordLoginActivity(user, { orgId: 'not-a-member-organization', status: 'SUCCESS' });
  assert.equal(forgedOrganization.status, 403);
  const forgedFailureOrganization = await recordLoginActivity(user, { orgId: 'not-a-member-organization', status: 'FAILED' });
  assert.equal(forgedFailureOrganization.status, 403);
  assert.equal((await second.organization.collection('members').doc(user.uid).get()).data().lastLoginStatus, undefined);
});

test('an authenticated user without membership still receives a successful pending profile bootstrap', async () => {
  const user = await createUser('no-membership');
  const result = await bootstrap(user);
  assert.equal(result.status, 200);
  assert.equal(result.body.data.profileStatus, 'pending');
  assert.equal(result.body.data.profileActive, false);
  assert.equal((await adminDb.doc(`users/${user.uid}`).get()).data().status, 'pending');
});

test('missing profile bootstrap accepts null Google display fields without undefined Firestore values', async () => {
  const user = await createUser('null-google-fields');
  await adminAuth.updateUser(user.uid, { displayName: null, photoURL: null });
  const { organization } = await seedOrganization('null-google-fields');
  await organization.collection('members').doc(user.uid).set({ userId: user.uid, email: user.email, role: 'USER', status: 'active' });

  const result = await bootstrap(user);
  assert.equal(result.status, 200);
  const profile = (await adminDb.doc(`users/${user.uid}`).get()).data();
  assert.equal(profile.displayName, 'User');
  assert.equal(profile.photoURL, '');
  assert.equal(profile.status, 'active');
});

test('unauthenticated, malformed, and revoked bootstrap tokens are rejected with 401', async () => {
  const missing = await fetch(`${BASE_URL}/api/auth/bootstrap`, { method: 'POST' });
  assert.equal(missing.status, 401);
  assert.equal((await missing.json()).code, 'AUTH_REQUIRED');

  const malformed = await fetch(`${BASE_URL}/api/auth/bootstrap`, { method: 'POST', headers: { Authorization: 'Bearer not-a-firebase-token' } });
  assert.equal(malformed.status, 401);
  assert.equal((await malformed.json()).code, 'AUTH_REQUIRED');

  const revoked = await createUser('revoked');
  // Firebase Auth records revocation time to second precision; make the
  // token's issuance time unambiguously earlier than the revocation.
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  await adminAuth.revokeRefreshTokens(revoked.uid);
  const revokedResponse = await fetch(`${BASE_URL}/api/auth/bootstrap`, { method: 'POST', headers: { Authorization: `Bearer ${revoked.token}` } });
  assert.equal(revokedResponse.status, 401);
  assert.equal((await revokedResponse.json()).code, 'AUTH_REQUIRED');
});
