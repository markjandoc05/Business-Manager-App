import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const PROJECT_ID = 'demo-bsm-client-app';
const PORT = 3102;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const EMULATOR_HOSTS = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST'];

if (process.env.GOOGLE_CLOUD_PROJECT === 'bsm-client-app-web' || process.env.GCLOUD_PROJECT === 'bsm-client-app-web') {
  throw new Error('Refusing Client Document delete API tests with the production project ID.');
}
if (!EMULATOR_HOSTS.every((name) => process.env[name])) {
  throw new Error(`Client Document delete API tests require ${EMULATOR_HOSTS.join(', ')}.`);
}

process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = PROJECT_ID;
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = `${PROJECT_ID}.firebasestorage.app`;

const app = getApps()[0] || initializeApp({
  projectId: PROJECT_ID,
  storageBucket: `${PROJECT_ID}.firebasestorage.app`,
  credential: applicationDefault(),
});
const adminAuth = getAuth(app);
const adminDb = getFirestore(app);
const bucket = getStorage(app).bucket(`${PROJECT_ID}.firebasestorage.app`);
let sequence = 0;
let server;

function id(prefix) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

function futureTimestamp() {
  return Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
}

async function createToken(label) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  await adminAuth.createUser({ uid, email, password: 'client-document-delete-test-password' });
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'client-document-delete-test-password', returnSecureToken: true }),
  });
  assert.equal(response.ok, true, `Auth emulator sign-in failed for ${label}.`);
  return { uid, token: (await response.json()).idToken };
}

function tokenForDifferentProject(token) {
  const segments = token.split('.');
  assert.equal(segments.length, 3, 'Expected a Firebase ID token JWT.');
  const payload = JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'));
  payload.aud = 'demo-other-bsm-project';
  payload.iss = 'https://securetoken.google.com/demo-other-bsm-project';
  segments[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return segments.join('.');
}

async function seedDocument({ members, licenseStatus = 'ACTIVE', organizationStatus = 'active', mirrorStatus = licenseStatus, mirrorWriteEnabled = true, documentArchived = true, storagePath, expiry = futureTimestamp() } = {}) {
  const organizationId = id('org');
  const clientId = id('client');
  const documentId = id('document');
  const path = typeof storagePath === 'function'
    ? storagePath({ organizationId, clientId, documentId })
    : storagePath ?? `organizations/${organizationId}/clients/${clientId}/documents/${documentId}/document.pdf`;
  const organizationRef = adminDb.doc(`organizations/${organizationId}`);
  const writes = [
    organizationRef.set({ status: organizationStatus, licenseStatus: mirrorStatus, licenseWriteEnabled: mirrorWriteEnabled, licenseExpiresAt: expiry }),
    organizationRef.collection('license').doc('current').set({
      plan: 'TEAM', status: licenseStatus, maxUsers: 3, subscriptionStartedAt: Timestamp.fromMillis(Date.now() - 60_000), subscriptionEndsAt: expiry,
    }),
    organizationRef.collection('clients').doc(clientId).set({ status: 'ACTIVE' }),
    organizationRef.collection('clients').doc(clientId).collection('documents').doc(documentId).set({
      name: 'document.pdf', storagePath: path, archived: documentArchived, uploadedAt: Timestamp.now(), uploadedByUid: members[0]?.uid || 'seed',
    }),
  ];
  for (const member of members) {
    writes.push(organizationRef.collection('members').doc(member.uid).set({ userId: member.uid, role: member.role, status: member.status }));
  }
  await Promise.all(writes);
  return { organizationId, clientId, documentId, path };
}

async function putObject(path) {
  await bucket.file(path).save(Buffer.from('test document'), { contentType: 'application/pdf' });
}

async function objectExists(path) {
  return (await bucket.file(path).exists())[0];
}

function deleteRequest(token, { organizationId, clientId, documentId }, baseUrl = BASE_URL) {
  return fetch(`${baseUrl}/api/organizations/${organizationId}/clients/${clientId}/documents/${documentId}`, {
    method: 'DELETE',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function deleteRequestWithHeaders(headers, target, baseUrl = BASE_URL) {
  return fetch(`${baseUrl}/api/organizations/${target.organizationId}/clients/${target.clientId}/documents/${target.documentId}`, {
    method: 'DELETE',
    headers,
  });
}

function cleanupRequest(token, target, baseUrl = BASE_URL, storagePath = target.path) {
  return fetch(`${baseUrl}/api/organizations/${target.organizationId}/clients/${target.clientId}/documents/${target.documentId}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ storagePath }),
  });
}

async function expectStillPresent(target) {
  assert.equal((await adminDb.doc(`organizations/${target.organizationId}/clients/${target.clientId}/documents/${target.documentId}`).get()).exists, true);
  assert.equal(await objectExists(target.path), true);
}

async function stopNext() {
  if (!server || server.exitCode !== null) return;
  await new Promise((resolve) => {
    server.once('exit', resolve);
    server.kill('SIGTERM');
  });
}

async function startNext(port = PORT, environment = {}) {
  const baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GOOGLE_CLOUD_PROJECT: PROJECT_ID,
      GCLOUD_PROJECT: PROJECT_ID,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID,
      NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.firebasestorage.app`,
      ...environment,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  server.stdout.on('data', (chunk) => output.push(chunk.toString()));
  server.stderr.on('data', (chunk) => output.push(chunk.toString()));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(1_000) });
      if (response.status < 500) return baseUrl;
    } catch {
      // The development server is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next.js did not become ready.\n${output.join('')}`);
}

before(async () => startNext());
after(async () => stopNext());

for (const role of ['ADMIN', 'MANAGER']) {
  test(`${role} can permanently delete an archived document and its object`, async () => {
    const actor = await createToken(role.toLowerCase());
    const target = await seedDocument({ members: [{ uid: actor.uid, role, status: 'active' }] });
    await putObject(target.path);

    const response = await deleteRequest(actor.token, target);
    assert.equal(response.status, 200);
    assert.equal((await adminDb.doc(`organizations/${target.organizationId}/clients/${target.clientId}/documents/${target.documentId}`).get()).exists, false);
    assert.equal(await objectExists(target.path), false);
  });
}

test('unauthenticated, USER, inactive, and cross-organization callers are denied without deletion', async () => {
  const admin = await createToken('admin');
  const user = await createToken('user');
  const inactive = await createToken('inactive');
  const outsider = await createToken('outsider');
  const target = await seedDocument({ members: [
    { uid: admin.uid, role: 'ADMIN', status: 'active' },
    { uid: user.uid, role: 'USER', status: 'active' },
    { uid: inactive.uid, role: 'ADMIN', status: 'inactive' },
  ] });
  await putObject(target.path);
  for (const token of [null, user.token, inactive.token, outsider.token]) {
    const response = await deleteRequest(token, target);
    assert.equal(response.status, token ? 403 : 401);
    await expectStillPresent(target);
  }
});

test('missing, empty, malformed, and invalid Authorization headers return 401', async () => {
  const target = await seedDocument({ members: [] });
  const requests = [
    {},
    { authorization: 'Bearer ' },
    { authorization: 'Token invalid-token' },
    { authorization: 'Bearer invalid-token' },
  ];
  for (const headers of requests) {
    assert.equal((await deleteRequestWithHeaders(headers, target)).status, 401);
  }
});

test('a Firebase ID token issued for another project is rejected', async () => {
  const actor = await createToken('wrong-project');
  const target = {
    organizationId: id('org'),
    clientId: id('client'),
    documentId: id('document'),
  };
  const response = await deleteRequest(tokenForDifferentProject(actor.token), target);
  assert.equal(response.status, 401);
});

test('nonexistent Clients and Documents return a controlled not-found response', async () => {
  const admin = await createToken('not-found-admin');
  const target = await seedDocument({ members: [{ uid: admin.uid, role: 'ADMIN', status: 'active' }] });

  assert.equal((await deleteRequest(admin.token, { ...target, clientId: 'missing-client' })).status, 404);
  assert.equal((await deleteRequest(admin.token, { ...target, documentId: 'missing-document' })).status, 404);
  assert.equal((await adminDb.doc(`organizations/${target.organizationId}/clients/${target.clientId}/documents/${target.documentId}`).get()).exists, true);
});

test('blocked or expired/non-writable licenses deny deletion without removing the document', async () => {
  const admin = await createToken('license-admin');
  const suspended = await seedDocument({
    members: [{ uid: admin.uid, role: 'ADMIN', status: 'active' }],
    licenseStatus: 'SUSPENDED', organizationStatus: 'suspended', mirrorStatus: 'SUSPENDED', mirrorWriteEnabled: false,
  });
  await putObject(suspended.path);
  assert.equal((await deleteRequest(admin.token, suspended)).status, 409);
  await expectStillPresent(suspended);

  const expired = await seedDocument({
    members: [{ uid: admin.uid, role: 'ADMIN', status: 'active' }],
    licenseStatus: 'ACTIVE', organizationStatus: 'active', mirrorStatus: 'ACTIVE', expiry: Timestamp.fromMillis(Date.now() - 60_000),
  });
  await putObject(expired.path);
  assert.equal((await deleteRequest(admin.token, expired)).status, 409);
  await expectStillPresent(expired);
});

test('active documents and paths outside the exact document namespace are denied', async () => {
  const admin = await createToken('validation-admin');
  const active = await seedDocument({ members: [{ uid: admin.uid, role: 'ADMIN', status: 'active' }], documentArchived: false });
  await putObject(active.path);
  assert.equal((await deleteRequest(admin.token, active)).status, 409);
  await expectStillPresent(active);

  for (const [label, storagePath] of [
    ['organization', ({ clientId, documentId }) => `organizations/other-org/clients/${clientId}/documents/${documentId}/document.pdf`],
    ['client', ({ organizationId, documentId }) => `organizations/${organizationId}/clients/other-client/documents/${documentId}/document.pdf`],
    ['document', ({ organizationId, clientId }) => `organizations/${organizationId}/clients/${clientId}/documents/other-document/document.pdf`],
  ]) {
    const malformed = await seedDocument({ members: [{ uid: admin.uid, role: 'ADMIN', status: 'active' }], storagePath });
    await putObject(malformed.path);
    assert.equal((await deleteRequest(admin.token, malformed)).status, 409);
    assert.equal((await adminDb.doc(`organizations/${malformed.organizationId}/clients/${malformed.clientId}/documents/${malformed.documentId}`).get()).exists, true);
    assert.equal(await objectExists(malformed.path), true, `The ${label} path object must remain untouched.`);
  }
});

test('a missing Storage object is treated as an orphan and metadata is cleaned up', async () => {
  const admin = await createToken('orphan-admin');
  const target = await seedDocument({ members: [{ uid: admin.uid, role: 'ADMIN', status: 'active' }] });
  assert.equal(await objectExists(target.path), false);
  assert.equal((await deleteRequest(admin.token, target)).status, 200);
  assert.equal((await adminDb.doc(`organizations/${target.organizationId}/clients/${target.clientId}/documents/${target.documentId}`).get()).exists, false);
});

test('authorized upload cleanup removes the object without requiring metadata', async () => {
  const admin = await createToken('cleanup-admin');
  const target = await seedDocument({ members: [{ uid: admin.uid, role: 'ADMIN', status: 'active' }] });
  await putObject(target.path);
  assert.equal((await adminDb.doc(`organizations/${target.organizationId}/clients/${target.clientId}/documents/${target.documentId}`).get()).exists, true);

  const response = await cleanupRequest(admin.token, target);
  assert.equal(response.status, 200);
  assert.equal(await objectExists(target.path), false);
  assert.equal((await adminDb.doc(`organizations/${target.organizationId}/clients/${target.clientId}/documents/${target.documentId}`).get()).exists, true);
});

test('upload cleanup remains tenant- and role-protected', async () => {
  const admin = await createToken('cleanup-owner');
  const user = await createToken('cleanup-user');
  const target = await seedDocument({ members: [
    { uid: admin.uid, role: 'ADMIN', status: 'active' },
    { uid: user.uid, role: 'USER', status: 'active' },
  ] });
  await putObject(target.path);

  assert.equal((await cleanupRequest(user.token, target)).status, 403);
  assert.equal(await objectExists(target.path), true);
  assert.equal((await cleanupRequest(admin.token, target, BASE_URL, `organizations/other-org/clients/${target.clientId}/documents/${target.documentId}/file.pdf`)).status, 400);
  assert.equal(await objectExists(target.path), true);
});

test('a non-missing Storage failure preserves metadata and returns a controlled error', async () => {
  const admin = await createToken('storage-failure-admin');
  const target = await seedDocument({ members: [{ uid: admin.uid, role: 'ADMIN', status: 'active' }] });
  await putObject(target.path);

  await stopNext();
  const failureBaseUrl = await startNext(3103, {
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:1',
    STORAGE_EMULATOR_HOST: 'http://127.0.0.1:1',
  });
  const response = await deleteRequest(admin.token, target, failureBaseUrl);
  assert.equal(response.status, 502);
  await expectStillPresent(target);
});
