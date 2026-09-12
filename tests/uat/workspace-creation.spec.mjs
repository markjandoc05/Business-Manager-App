import assert from 'node:assert/strict';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { test, expect } from '@playwright/test';

if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Workspace creation UAT requires Auth and Firestore emulators.');
}

const projectId = 'demo-bsm-client-app';
const adminApp = getApps()[0] || initializeApp({ projectId, credential: applicationDefault() });
const adminAuth = getAuth(adminApp);
const adminDb = getFirestore(adminApp);

test('a new account can create and load its first workspace', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const uid = `workspace-create-${suffix}`;
  const email = `${uid}@example.test`;
  const password = `Workspace-${suffix}-password`;
  const workspaceName = `Creation UAT ${suffix}`;
  await adminAuth.createUser({ uid, email, emailVerified: true, password });

  const consoleErrors = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Local UAT sign-in')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Local UAT email').fill(email);
  await page.getByLabel('Local UAT password').fill(password);
  await page.getByRole('button', { name: 'Sign in for local UAT' }).click();

  await expect(page.getByRole('heading', { name: 'No workspace found' })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Create Your Workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Create your workspace' })).toBeVisible();
  await page.getByPlaceholder('e.g. Acme Studio').fill(workspaceName);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Create Workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Key Metrics' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Unable to load workspace' })).toHaveCount(0);

  const organizations = await adminDb.collection('organizations').where('createdByUid', '==', uid).get();
  assert.equal(organizations.size, 1);
  const organizationId = organizations.docs[0].id;
  const [member, settings, license, guard, profile] = await Promise.all([
    adminDb.doc(`organizations/${organizationId}/members/${uid}`).get(),
    adminDb.doc(`organizations/${organizationId}/settings/settings`).get(),
    adminDb.doc(`organizations/${organizationId}/license/current`).get(),
    adminDb.doc(`workspaceBootstrap/${uid}`).get(),
    adminDb.doc(`users/${uid}`).get(),
  ]);
  assert.equal(member.data()?.role, 'ADMIN');
  assert.equal(member.data()?.status, 'active');
  assert.equal(settings.data()?.businessName, workspaceName);
  assert.equal(license.data()?.status, 'TRIAL');
  assert.equal(guard.data()?.organizationId, organizationId);
  assert.equal(profile.data()?.status, 'active');
  assert.equal(profile.data()?.active, true);
  assert.deepEqual(consoleErrors, []);
});
