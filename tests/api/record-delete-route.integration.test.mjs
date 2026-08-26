import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const PORT = 3104;
const BASE_URL = `http://127.0.0.1:${PORT}`;
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Record delete API tests require Firestore and Auth emulators.');
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = PROJECT_ID;

const app = getApps()[0] || initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
const adminAuth = getAuth(app);
const adminDb = getFirestore(app);
let sequence = 0;
let server;
const id = (prefix) => `${prefix}-${Date.now()}-${++sequence}`;

async function createToken(label) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  await adminAuth.createUser({ uid, email, password: 'record-delete-test-password' });
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'record-delete-test-password', returnSecureToken: true }),
  });
  assert.equal(response.ok, true);
  return { uid, token: (await response.json()).idToken };
}

async function seedOrganization(actor, organizationId, role = 'ADMIN') {
  const until = Timestamp.fromMillis(Date.now() + 86_400_000);
  const organization = adminDb.doc(`organizations/${organizationId}`);
  await Promise.all([
    organization.set({ status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: until }),
    organization.collection('license').doc('current').set({ plan: 'TEAM', status: 'ACTIVE', maxUsers: 3, subscriptionEndsAt: until }),
    organization.collection('members').doc(actor.uid).set({ userId: actor.uid, role, status: 'active' }),
  ]);
  return organization;
}

async function request(token, path, options = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
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

test('Lead Trash permanent delete previews blockers, cleans owned children, and preserves Activity history', async () => {
  const actor = await createToken('lead-admin');
  const organizationId = id('lead-org');
  const organization = await seedOrganization(actor, organizationId);
  const leadId = id('lead');
  const taskId = id('task');
  const timelineId = id('timeline');
  const activityId = id('activity');
  const taskActivityId = id('task-activity');
  await Promise.all([
    organization.collection('leads').doc(leadId).set({ name: 'Lead with children', status: 'New', archived: true, trashed: true, createdAt: Timestamp.now() }),
    organization.collection('tasks').doc(taskId).set({ title: 'Lead task', relatedTo: { type: 'Lead', id: leadId }, archived: false }),
    organization.collection('leads').doc(leadId).collection('timeline').doc(timelineId).set({ entryType: 'NOTE', content: 'Lead note', createdAt: Timestamp.now() }),
    organization.collection('activities').doc(activityId).set({ type: 'lead_creation', entityType: 'Lead', entityId: leadId, description: 'Lead created', createdAt: Timestamp.now(), createdBy: actor.uid }),
    organization.collection('activities').doc(taskActivityId).set({ type: 'task_creation', entityType: 'Task', entityId: taskId, description: 'Task created', createdAt: Timestamp.now(), createdBy: actor.uid }),
  ]);

  const previewResponse = await request(actor.token, `/api/organizations/${organizationId}/records/lead/${leadId}?action=permanent-delete`);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.decision.outcome, 'ALLOWED_WITH_WARNING');
  assert.deepEqual(preview.decision.cleanupRecords, { Tasks: 1, 'Task Activities': 1, Notes: 1 });
  assert.deepEqual(preview.decision.preservedRecords, { Activities: 1 });

  const deleteResponse = await request(actor.token, `/api/organizations/${organizationId}/records/lead/${leadId}`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 200);
  assert.equal((await organization.collection('leads').doc(leadId).get()).exists, false);
  assert.equal((await organization.collection('tasks').doc(taskId).get()).exists, false);
  assert.equal((await organization.collection('leads').doc(leadId).collection('timeline').doc(timelineId).get()).exists, false);
  assert.equal((await organization.collection('activities').doc(activityId).get()).exists, true);
  assert.equal((await organization.collection('activities').doc(taskActivityId).get()).exists, false);
});

test('Client permanent delete is blocked by Active and historical Deals', async () => {
  const actor = await createToken('client-admin');
  const organizationId = id('client-org');
  const organization = await seedOrganization(actor, organizationId);
  const clientId = id('client');
  await Promise.all([
    organization.collection('clients').doc(clientId).set({ name: 'Protected Client', status: 'ARCHIVED', archived: true, trashed: true }),
    organization.collection('deals').doc(id('active-deal')).set({ clientId, status: 'Active', archived: false }),
    organization.collection('deals').doc(id('won-deal')).set({ clientId, status: 'Won', archived: true }),
  ]);
  const previewResponse = await request(actor.token, `/api/organizations/${organizationId}/records/client/${clientId}?action=permanent-delete`);
  assert.equal(previewResponse.status, 200);
  const preview = await previewResponse.json();
  assert.equal(preview.decision.outcome, 'BLOCKED');
  assert.deepEqual(preview.decision.blockingRecords, { 'Active Deals': 1, 'Won Deals': 1 });
  const deleteResponse = await request(actor.token, `/api/organizations/${organizationId}/records/client/${clientId}`, { method: 'DELETE' });
  assert.equal(deleteResponse.status, 409);
  assert.equal((await organization.collection('clients').doc(clientId).get()).exists, true);
});

test('Client Trash permanent delete cleans eligible children and preserves Client Activity history', async () => {
  const actor = await createToken('client-cleanup-admin');
  const organizationId = id('client-cleanup-org');
  const organization = await seedOrganization(actor, organizationId);
  const clientId = id('client');
  const taskId = id('task');
  const noteId = id('note');
  const activityId = id('activity');
  await Promise.all([
    organization.collection('clients').doc(clientId).set({ name: 'Client with children', status: 'ARCHIVED', archived: true, trashed: true }),
    organization.collection('tasks').doc(taskId).set({ title: 'Client task', relatedTo: { type: 'Client', id: clientId }, archived: false }),
    organization.collection('clients').doc(clientId).collection('notes').doc(noteId).set({ content: 'Client note', archived: false, createdAt: Timestamp.now() }),
    organization.collection('activities').doc(activityId).set({ type: 'client_creation', entityType: 'Client', entityId: clientId, description: 'Client created', createdAt: Timestamp.now(), createdBy: actor.uid }),
  ]);
  const response = await request(actor.token, `/api/organizations/${organizationId}/records/client/${clientId}`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  assert.equal((await organization.collection('clients').doc(clientId).get()).exists, false);
  assert.equal((await organization.collection('tasks').doc(taskId).get()).exists, false);
  assert.equal((await organization.collection('clients').doc(clientId).collection('notes').doc(noteId).get()).exists, false);
  assert.equal((await organization.collection('activities').doc(activityId).get()).exists, true);
});

test('Permanent delete route rejects cross-organization access', async () => {
  const actor = await createToken('cross-org-admin');
  const ownOrganizationId = id('own-org');
  await seedOrganization(actor, ownOrganizationId);
  const otherOrganizationId = id('other-org');
  const otherOrganization = await seedOrganization({ uid: id('other-admin') }, otherOrganizationId);
  const clientId = id('other-client');
  await otherOrganization.collection('clients').doc(clientId).set({ name: 'Other Client', status: 'ARCHIVED', archived: true, trashed: true });
  const response = await request(actor.token, `/api/organizations/${otherOrganizationId}/records/client/${clientId}`, { method: 'DELETE' });
  assert.equal(response.status, 403);
});
