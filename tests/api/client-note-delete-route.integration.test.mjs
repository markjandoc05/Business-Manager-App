import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const PORT = 3103;
const BASE_URL = `http://127.0.0.1:${PORT}`;
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Note delete API tests require Firestore and Auth emulators.');
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = PROJECT_ID;

const app = getApps()[0] || initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
const adminAuth = getAuth(app);
const adminDb = getFirestore(app);
let sequence = 0;
let server;
const id = (prefix) => `${prefix}-${Date.now()}-${++sequence}`;
const expiry = () => Timestamp.fromMillis(Date.now() + 86_400_000);

async function createToken(label) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  await adminAuth.createUser({ uid, email, password: 'note-delete-test-password' });
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'note-delete-test-password', returnSecureToken: true }),
  });
  assert.equal(response.ok, true);
  await adminDb.doc(`users/${uid}`).set({ uid, name: label, email, displayName: label, status: 'active', role: 'USER', active: true });
  return { uid, token: (await response.json()).idToken };
}

async function seed(actor, role = 'ADMIN', archived = true) {
  const organizationId = id('org');
  const clientId = id('client');
  const noteId = id('note');
  const organization = adminDb.doc(`organizations/${organizationId}`);
  const until = expiry();
  await Promise.all([
    organization.set({ status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: until }),
    organization.collection('license').doc('current').set({ plan: 'TEAM', status: 'ACTIVE', maxUsers: 3, subscriptionEndsAt: until }),
    organization.collection('members').doc(actor.uid).set({ userId: actor.uid, role, status: 'active' }),
    organization.collection('clients').doc(clientId).set({ status: 'ACTIVE' }),
    organization.collection('clients').doc(clientId).collection('notes').doc(noteId).set({ content: 'test', archived, createdAt: Timestamp.now() }),
  ]);
  return { organizationId, clientId, noteId };
}

async function request(token, target) {
  return fetch(`${BASE_URL}/api/organizations/${target.organizationId}/clients/${target.clientId}/notes/${target.noteId}`, {
    method: 'DELETE', headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

async function startNext() {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: process.cwd(), env: { ...process.env, GOOGLE_CLOUD_PROJECT: PROJECT_ID, GCLOUD_PROJECT: PROJECT_ID }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = [];
  server.stdout.on('data', (chunk) => output.push(chunk.toString()));
  server.stderr.on('data', (chunk) => output.push(chunk.toString()));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { const response = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(1_000) }); if (response.status < 500) return; } catch { /* compiling */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next.js did not become ready.\n${output.join('')}`);
}

before(startNext);
after(async () => { if (server && server.exitCode === null) server.kill('SIGTERM'); });

test('ADMIN can permanently delete an archived Note through the trusted route', async () => {
  const actor = await createToken('admin');
  const target = await seed(actor);
  const response = await request(actor.token, target);
  assert.equal(response.status, 200);
  assert.equal((await adminDb.doc(`organizations/${target.organizationId}/clients/${target.clientId}/notes/${target.noteId}`).get()).exists, false);
});

test('USER, unauthenticated, and active-note callers are denied', async () => {
  const user = await createToken('user');
  const target = await seed(user, 'USER');
  assert.equal((await request(user.token, target)).status, 403);
  assert.equal((await request(null, target)).status, 401);
  const admin = await createToken('active-note-admin');
  const activeTarget = await seed(admin, 'ADMIN', false);
  assert.equal((await request(admin.token, activeTarget)).status, 409);
});
