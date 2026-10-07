import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

// Never run against a live project, even if the shell has ambient credentials.
const PROJECT_ID = 'demo-bsm-client-app';
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[name] || '')) throw new Error(`${name} must point to a loopback emulator.`);
}
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
const app = initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() }, 'financial-integrity-tests');
const db = getFirestore(app); const auth = getAuth(app);
const PORT = 3120; const BASE = `http://127.0.0.1:${PORT}`;
let server; let serial = 0;
const id = (prefix) => `${prefix}-${Date.now()}-${++serial}`;
const sale = (overrides = {}) => ({ saleDate: '2026-10-07', customerType: 'WALK_IN', customerName: 'Synthetic buyer', items: [{ source: 'OTHER', catalogItemId: null, type: null, name: 'Fixture service', code: '', categoryId: null, category: '', unit: '', regularPrice: 0.3, salePrice: null, quantity: 1, unitPrice: 0.3, subtotal: 0.3 }], paymentStatus: 'PARTIAL', amountPaid: 0.1, paymentMethod: 'CASH', ...overrides });
async function fixture(role = 'ADMIN') {
  const uid = id('actor'); const email = `${uid}@example.test`; const password = 'synthetic-finance-password';
  await auth.createUser({ uid, email, password });
  const login = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  assert.equal(login.ok, true);
  const token = (await login.json()).idToken;
  const org = id('org'); const ref = db.doc(`organizations/${org}`); const expiry = Timestamp.fromMillis(Date.now() + 86400000);
  await Promise.all([
    db.doc(`users/${uid}`).set({ uid, status: 'active', active: true }),
    ref.set({ status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: expiry }),
    ref.collection('license').doc('current').set({ status: 'ACTIVE', plan: 'TEAM', maxUsers: 3, subscriptionEndsAt: expiry }),
    ref.collection('members').doc(uid).set({ userId: uid, status: 'active', role }),
  ]);
  return { uid, token, org, ref };
}
async function request(f, path, body, key = id('operation'), method = 'POST') {
  return fetch(`${BASE}/api/organizations/${f.org}/${path}`, { method, headers: { authorization: `Bearer ${f.token}`, 'content-type': 'application/json', 'Idempotency-Key': key }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function create(f, body = sale(), key) {
  const response = await request(f, 'sales', body, key); assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).saleId;
}
before(async () => {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    env: { ...process.env, NEXT_DIST_DIR: '.next-financial-tests', NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID, NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-key', NEXT_PUBLIC_FIREBASE_APP_ID: 'demo-app', NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PROJECT_ID}.firebaseapp.com`, NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true', NEXT_PUBLIC_LOCAL_UAT: 'true', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; server.stdout.on('data', (chunk) => { output += chunk; }); server.stderr.on('data', (chunk) => { output += chunk; });
  const until = Date.now() + 45000;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error(`Next exited: ${output}`);
    try { if ((await fetch(BASE, { signal: AbortSignal.timeout(1000) })).status < 500) return; } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next startup timed out: ${output}`);
});
after(async () => { if (server?.exitCode === null) server.kill('SIGTERM'); await db.terminate(); });

test('decimal opening payment and concurrent retries commit exactly once, with immutable receipts', async () => {
  const f = await fixture('MANAGER'); const key = id('create');
  const ids = await Promise.all([create(f, sale(), key), create(f, sale(), key)]); assert.equal(ids[0], ids[1]);
  const ref = f.ref.collection('sales').doc(ids[0]);
  assert.equal((await ref.collection('payments').doc('opening').get()).data().amount, 0.1);
  const payment = { amount: 0.2, method: 'CASH', paymentDate: '2026-10-07' }; const paymentKey = id('payment');
  const responses = await Promise.all([request(f, `sales/${ref.id}/payments`, payment, paymentKey), request(f, `sales/${ref.id}/payments`, payment, paymentKey)]);
  responses.forEach((response) => assert.equal(response.status, 200));
  assert.equal((await ref.get()).data().amountPaid, 0.3); assert.equal((await ref.get()).data().balance, 0);
  const receipts = await ref.collection('payments').get(); assert.equal(receipts.size, 2);
  assert.equal(receipts.docs.reduce((sum, item) => sum + Math.round(item.data().amount * 100), 0), 30);
  assert.equal((await request(f, `sales/${ref.id}/payments`, { ...payment, amount: 0.1 }, paymentKey)).status, 409);
  assert.equal((await request(f, 'sales', sale({ notes: 'Changed' }), key)).status, 409);
  assert.equal((await f.ref.collection('sales').get()).size, 1);
});

test('server rejects malformed item snapshots and stale/cross-tenant references without writes', async () => {
  const f = await fixture();
  for (const overrides of [{ quantity: -1 }, { subtotal: 0.1 }, { unitPrice: 0.001 }, { quantity: 2 }]) {
    const body = sale(); Object.assign(body.items[0], overrides);
    assert.equal((await request(f, 'sales', body)).status, 400);
  }
  assert.equal((await request(f, 'sales', sale({ customerType: 'CLIENT', clientId: 'missing-client' }))).status, 409);
  assert.equal((await f.ref.collection('sales').get()).size, 0);
});

test('USER, foreign tenant, inactive user and expired license cannot write financial records', async () => {
  const user = await fixture('USER'); assert.equal((await request(user, 'sales', sale())).status, 403);
  const f = await fixture(); const foreign = await fixture();
  assert.equal((await request({ ...f, org: foreign.org }, 'sales', sale())).status, 403);
  await db.doc(`users/${f.uid}`).update({ active: false }); assert.equal((await request(f, 'sales', sale())).status, 403);
  await db.doc(`users/${f.uid}`).update({ active: true });
  await f.ref.collection('license').doc('current').update({ subscriptionEndsAt: Timestamp.fromMillis(1) });
  assert.equal((await request(f, 'sales', sale())).status, 409);
});

test('legacy aggregates accept decimal payment without rewriting history or fabricating an opening receipt', async () => {
  const f = await fixture(); const ref = f.ref.collection('sales').doc('legacy'); const items = [{ legacy: 'unchanged' }];
  await ref.set({ status: 'ACTIVE', total: 19.99, amountPaid: 6.66, balance: 13.33, items });
  assert.equal((await request(f, `sales/${ref.id}/payments`, { amount: 13.33, method: 'GCASH', paymentDate: '2026-10-07' })).status, 200);
  assert.deepEqual((await ref.get()).data().items, items); assert.equal((await ref.get()).data().amountPaid, 19.99);
  assert.equal((await ref.collection('payments').get()).size, 1); assert.equal((await ref.collection('payments').doc('opening').get()).exists, false);
});

test('Won Deal remains separate from Sales; concurrent recording allows one active Sale and no-lock legacy duplicates fail', async () => {
  const f = await fixture(); const client = f.ref.collection('clients').doc('client'); const deal = f.ref.collection('deals').doc('deal');
  await client.set({ name: 'Synthetic Client', status: 'ACTIVE' }); await deal.set({ status: 'Won', stage: 'Won', clientId: client.id });
  assert.equal((await f.ref.collection('sales').get()).size, 0);
  const body = sale({ source: 'DEAL', customerType: 'CLIENT', clientId: client.id, dealId: deal.id });
  const attempts = await Promise.all([request(f, 'sales', body), request(f, 'sales', body)]);
  assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 409]);
  const active = (await f.ref.collection('sales').where('dealId', '==', deal.id).get()).docs[0];
  assert.equal((await deal.get()).data().status, 'Won');
  await f.ref.collection('dealSaleLocks').doc(deal.id).delete();
  assert.equal((await request(f, 'sales', body)).status, 409);
  await active.ref.update({ status: 'VOIDED' });
  await f.ref.collection('dealSaleLocks').doc(deal.id).set({ status: 'AVAILABLE', saleId: active.id, dealId: deal.id });
  await create(f, body); assert.equal((await deal.get()).data().status, 'Won');
});

test('single and bulk Client deletion retain every Sale status, including a Sale added after preview', async () => {
  const f = await fixture();
  for (const status of ['ACTIVE', 'VOIDED']) {
    const clientId = id('client'); const client = f.ref.collection('clients').doc(clientId);
    await client.set({ name: 'Historical Client', status: 'ARCHIVED', archived: true, trashed: true });
    const preview = await fetch(`${BASE}/api/organizations/${f.org}/records/client/${clientId}?action=permanent-delete`, { headers: { authorization: `Bearer ${f.token}` } });
    assert.notEqual((await preview.json()).decision.outcome, 'BLOCKED');
    await f.ref.collection('sales').doc(id('sale')).set({ clientId, status, archived: true, trashed: true });
    assert.equal((await request(f, `records/client/${clientId}`, undefined, undefined, 'DELETE')).status, 409);
    const body = { entity: 'Client', action: 'permanent-delete', mode: 'preview', recordIds: [clientId] };
    const bulk = await request(f, 'records/bulk', body); assert.equal(bulk.status, 200);
    assert.equal((await bulk.json()).results[0].decision.outcome, 'BLOCKED');
    const execution = await request(f, 'records/bulk', { ...body, mode: 'execute' }); assert.equal(execution.status, 200);
    assert.equal((await execution.json()).results[0].ok, false); assert.equal((await client.get()).exists, true);
  }
});

test('Deal deletion protects reopened Deals with voided Sales or ACTIVE/AVAILABLE locks, but permits an empty archived Deal', async () => {
  const f = await fixture();
  for (const evidence of ['VOIDED', 'ACTIVE', 'AVAILABLE', 'none']) {
    const dealId = id('deal'); const ref = f.ref.collection('deals').doc(dealId);
    await ref.set({ status: 'Active', stage: 'New', archived: true });
    if (evidence === 'VOIDED') await f.ref.collection('sales').doc(id('history')).set({ dealId, status: 'VOIDED', archived: true, trashed: true });
    else if (evidence !== 'none') await f.ref.collection('dealSaleLocks').doc(dealId).set({ status: evidence });
    assert.equal((await request(f, `deals/${dealId}`, undefined, undefined, 'DELETE')).status, evidence === 'none' ? 200 : 409);
    assert.equal((await ref.get()).exists, evidence !== 'none');
  }
});
