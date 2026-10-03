import assert from 'node:assert/strict';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { test, expect } from '@playwright/test';

const PROJECT_ID = 'demo-bsm-console';
const FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;

if (!FIREBASE_AUTH_EMULATOR_HOST || !FIRESTORE_EMULATOR_HOST) {
  throw new Error('Platform onboarding UAT requires Auth and Firestore emulators.');
}
if ([process.env.GOOGLE_CLOUD_PROJECT, process.env.GCLOUD_PROJECT, process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID].filter(Boolean).some((value) => value !== PROJECT_ID)) {
  throw new Error(`Platform onboarding UAT is restricted to ${PROJECT_ID}.`);
}

const adminApp = getApps()[0] || initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
const adminAuth = getAuth(adminApp);
const adminDb = getFirestore(adminApp);
const firestoreRestBase = `http://${FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
let sequence = 0;

function unique(prefix) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

function fields(values) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { stringValue: value }]));
}

function firestoreDocument(path, documentFields) {
  return { name: `projects/${PROJECT_ID}/databases/(default)/documents/${path}`, fields: documentFields };
}

async function createLocalUser(prefix) {
  const uid = unique(prefix);
  const email = `${uid}@example.test`;
  const password = `Platform-${uid}-password`;
  await adminAuth.createUser({ uid, email, password, emailVerified: true });
  const response = await fetch(`http://${FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  assert.equal(response.ok, true, 'Auth emulator sign-in must succeed.');
  const body = await response.json();
  assert.equal(typeof body.idToken, 'string');
  return { uid, email, password, idToken: body.idToken };
}

async function signIn(page, user) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Local UAT sign-in')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Local UAT email').fill(user.email);
  await page.getByLabel('Local UAT password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in for local UAT' }).click();
}

async function openPlanSelection(page, user, workspaceName) {
  await signIn(page, user);
  await expect(page.getByRole('heading', { name: 'No workspace found' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Create Your Workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
  await page.getByPlaceholder('e.g. Acme Studio').fill(workspaceName);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Choose your plan')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Founding 100')).toBeVisible();
  await page.getByRole('button', { name: /Founding 100/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Review and start your free trial')).toBeVisible();
}

async function firestorePatchFromBrowser(page, idToken, path, body, query = '') {
  const url = `${firestoreRestBase}/${path}${query}`;
  return page.evaluate(async ({ url: requestUrl, token, requestBody }) => {
    const response = await fetch(requestUrl, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    return { status: response.status };
  }, { url, token: idToken, requestBody: body });
}

async function firestoreGetFromBrowser(page, idToken, path) {
  const url = `${firestoreRestBase}/${path}`;
  return page.evaluate(async ({ url: requestUrl, token }) => {
    const response = await fetch(requestUrl, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status };
  }, { url, token: idToken });
}

test('a fresh account provisions only through Platform and browser writes to trusted bootstrap records are rejected', async ({ page }) => {
  const user = await createLocalUser('platform-cutover');
  const workspaceName = `Platform Workspace ${unique('name')}`;

  await openPlanSelection(page, user, workspaceName);
  const provisioningResponsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/platform/trials' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start 14-Day Free Trial' }).click();
  const provisioningResponse = await provisioningResponsePromise;
  assert.equal(provisioningResponse.status(), 201);
  const provisioningBody = await provisioningResponse.json();
  assert.equal(provisioningBody.success, true);
  assert.equal(provisioningBody.data.provisioningStatus, 'PROVISIONED');
  assert.equal(provisioningBody.data.productCode, 'founding_100');
  await expect(page.getByRole('heading', { name: 'Key Metrics' })).toBeVisible({ timeout: 30_000 });

  const request = provisioningResponse.request();
  const idempotencyKey = request.headers()['idempotency-key'];
  const requestBody = request.postData();
  assert.match(idempotencyKey || '', /^[A-Za-z0-9][A-Za-z0-9._~-]{15,127}$/);
  assert.ok(requestBody);
  const replay = await page.evaluate(async ({ token, key, body }) => {
    const response = await fetch('/api/platform/trials', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body,
    });
    return { status: response.status, body: await response.json() };
  }, { token: user.idToken, key: idempotencyKey, body: requestBody });
  assert.ok(replay.status >= 200 && replay.status < 300);
  assert.equal(replay.body.success, true);
  assert.equal(replay.body.data.idempotent, true);
  assert.equal(replay.body.data.organizationId, provisioningBody.data.organizationId);

  const memberships = await adminDb.collectionGroup('members').where('userId', '==', user.uid).get();
  assert.equal(memberships.size, 1);
  const organizationId = memberships.docs[0].ref.parent.parent?.id;
  assert.equal(organizationId, provisioningBody.data.organizationId);
  const [organization, member, settings, license, bootstrap] = await Promise.all([
    adminDb.doc(`organizations/${organizationId}`).get(),
    adminDb.doc(`organizations/${organizationId}/members/${user.uid}`).get(),
    adminDb.doc(`organizations/${organizationId}/settings/settings`).get(),
    adminDb.doc(`organizations/${organizationId}/license/current`).get(),
    adminDb.doc(`workspaceBootstrap/${user.uid}`).get(),
  ]);
  assert.equal(organization.exists, true);
  assert.equal(member.data()?.role, 'ADMIN');
  assert.equal(member.data()?.status, 'active');
  assert.equal(settings.data()?.businessName, workspaceName);
  assert.equal(license.data()?.plan, 'TRIAL');
  assert.equal(license.data()?.status, 'TRIAL');
  // This is a Platform-owned idempotency guard. It is not created by the
  // browser and the direct write checks below prove that it is immutable from
  // the Client SDK after provisioning.
  assert.equal(bootstrap.exists, true);
  assert.equal(bootstrap.data()?.organizationId, organizationId);
  assert.equal(bootstrap.data()?.createdByUid, user.uid);

  const forgedOrganizationId = unique('browser-forged-org');
  const directWriteResults = await Promise.all([
    firestorePatchFromBrowser(page, user.idToken, `organizations/${forgedOrganizationId}`, firestoreDocument(`organizations/${forgedOrganizationId}`, fields({ name: 'Forged Workspace' }))),
    firestorePatchFromBrowser(page, user.idToken, `organizations/${forgedOrganizationId}/members/${user.uid}`, firestoreDocument(`organizations/${forgedOrganizationId}/members/${user.uid}`, fields({ userId: user.uid, role: 'ADMIN', status: 'active' }))),
    firestorePatchFromBrowser(page, user.idToken, `organizations/${forgedOrganizationId}/license/current`, firestoreDocument(`organizations/${forgedOrganizationId}/license/current`, fields({ plan: 'TRIAL', status: 'TRIAL', maxUsers: '999' }))),
    firestorePatchFromBrowser(page, user.idToken, `organizationSlugs/${forgedOrganizationId}`, firestoreDocument(`organizationSlugs/${forgedOrganizationId}`, fields({ organizationId: forgedOrganizationId }))),
    firestorePatchFromBrowser(page, user.idToken, `workspaceBootstrap/${user.uid}`, firestoreDocument(`workspaceBootstrap/${user.uid}`, fields({ organizationId: forgedOrganizationId, createdByUid: user.uid }))),
    firestorePatchFromBrowser(page, user.idToken, `organizations/${organizationId}/license/current`, firestoreDocument(`organizations/${organizationId}/license/current`, fields({ status: 'ACTIVE' })), '?updateMask.fieldPaths=status'),
  ]);
  assert.deepEqual(directWriteResults.map((result) => result.status), [403, 403, 403, 403, 403, 403]);
  assert.equal((await adminDb.doc(`organizations/${forgedOrganizationId}`).get()).exists, false);
  assert.equal((await adminDb.doc(`organizations/${organizationId}/license/current`).get()).data()?.status, 'TRIAL');
});

test('Platform unavailability keeps the browser retry key and never falls back to local workspace provisioning', async ({ page }) => {
  const user = await createLocalUser('platform-outage');
  await openPlanSelection(page, user, `Unavailable Workspace ${unique('name')}`);
  await page.route('**/api/platform/trials', async (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ success: false, error: { code: 'PLATFORM_UNAVAILABLE', message: 'Unavailable' } }),
  }));

  await page.getByRole('button', { name: 'Start 14-Day Free Trial' }).click();
  await expect(page.getByText('Unable to start the free trial. Please try again later.')).toBeVisible();
  const storedAttempt = await page.evaluate((uid) => window.localStorage.getItem(`ventale.platform-onboarding.v1:${encodeURIComponent(uid)}`), user.uid);
  assert.ok(storedAttempt);
  assert.equal((await adminDb.collectionGroup('members').where('userId', '==', user.uid).get()).size, 0);
  assert.equal((await adminDb.doc(`workspaceBootstrap/${user.uid}`).get()).exists, false);
  assert.equal((await adminDb.collection('organizations').where('createdByUid', '==', user.uid).get()).size, 0);
});

test('an existing provisioned customer remains able to load and perform an allowed CRM write, while cross-tenant reads are denied', async ({ page }) => {
  const user = await createLocalUser('existing-customer');
  const organizationId = unique('existing-org');
  const otherOrganizationId = unique('other-org');
  const now = Timestamp.now();
  const expiry = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await Promise.all([
    adminDb.doc(`users/${user.uid}`).set({ uid: user.uid, name: 'Existing Customer', displayName: 'Existing Customer', email: user.email, role: 'USER', status: 'active', active: true, createdAt: now }),
    adminDb.doc(`organizations/${organizationId}`).set({ name: 'Existing Customer Workspace', slug: organizationId, businessType: 'Agency', status: 'active', plan: 'TEAM', subscriptionStatus: 'active', maxUsers: 3, licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: expiry, createdAt: now, updatedAt: now, createdByUid: 'platform' }),
    adminDb.doc(`organizations/${organizationId}/members/${user.uid}`).set({ userId: user.uid, email: user.email, displayName: 'Existing Customer', role: 'ADMIN', status: 'active', joinedAt: now, activatedAt: now, activatedBy: 'platform' }),
    adminDb.doc(`organizations/${organizationId}/license/current`).set({ plan: 'TEAM', status: 'ACTIVE', maxUsers: 3, features: { crm: true }, subscriptionStartedAt: now, subscriptionEndsAt: expiry, createdAt: now, updatedAt: now, updatedBy: 'platform' }),
    adminDb.doc(`organizations/${organizationId}/settings/settings`).set({ businessName: 'Existing Customer Workspace', businessType: 'Agency', email: user.email, phone: '', website: '', address: '', currency: 'PHP', timezone: 'Asia/Manila', logoUrl: '', accentColor: '#3b82f6', pipelineStages: [{ name: 'New', isActive: true }], leadSources: [{ name: 'Website', isActive: true }] }),
    adminDb.doc(`organizations/${otherOrganizationId}`).set({ name: 'Other Workspace', slug: otherOrganizationId, status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: expiry }),
  ]);

  await signIn(page, user);
  await expect(page.getByRole('heading', { name: 'Key Metrics' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Add Lead' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add Lead dialog' });
  await dialog.locator('input').nth(0).fill('Existing Customer Lead');
  await dialog.locator('input').nth(1).fill('existing.customer.lead@example.test');
  await dialog.getByRole('button', { name: 'Save Lead' }).click();
  await expect(dialog).toHaveCount(0);
  assert.equal((await adminDb.collection(`organizations/${organizationId}/leads`).where('createdBy', '==', user.uid).get()).size, 1);

  const crossTenantRead = await firestoreGetFromBrowser(page, user.idToken, `organizations/${otherOrganizationId}`);
  assert.equal(crossTenantRead.status, 403);
});
