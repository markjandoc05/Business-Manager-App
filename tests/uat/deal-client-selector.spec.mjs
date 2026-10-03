import { readFileSync } from 'node:fs';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { test, expect } from '@playwright/test';

const PROJECT_ID = 'demo-bsm-client-app';
const credentialsPath = process.env.BSM_UAT_CREDENTIALS_FILE;
if (!credentialsPath) throw new Error('BSM_UAT_CREDENTIALS_FILE is required for Add Deal Client selector UAT.');
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error('Add Deal Client selector UAT requires Auth and Firestore emulators.');
}
if ([process.env.GOOGLE_CLOUD_PROJECT, process.env.GCLOUD_PROJECT, process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID].filter(Boolean).some((value) => value !== PROJECT_ID)) {
  throw new Error(`Add Deal Client selector UAT is restricted to ${PROJECT_ID}.`);
}

const fixture = JSON.parse(readFileSync(credentialsPath, 'utf8'));
const firestoreRules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const [firestoreHost, firestorePortValue] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const firestorePort = Number(firestorePortValue);
const selectorAdmin = fixture.users?.find((user) => user.key === 'selectorAdmin');
const workspaceA = fixture.organizations?.find((organization) => organization.id === fixture.organizationId);
const workspaceB = fixture.organizations?.find((organization) => organization.id !== fixture.organizationId);
if (!selectorAdmin?.email || !selectorAdmin.password || !workspaceA || !workspaceB || !fixture.clients?.laterPage || !fixture.clients?.workspaceBOnly) {
  throw new Error('The generated selector UAT fixture is incomplete. Run npm run uat:seed first.');
}

const adminApp = getApps().find((app) => app.name === 'deal-client-selector-uat')
  || initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() }, 'deal-client-selector-uat');
const adminDb = getFirestore(adminApp);
let sequence = 0;

function unique(prefix) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

async function signInAndChooseWorkspace(page, workspaceName = workspaceA.name) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Local UAT sign-in')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Local UAT email').fill(selectorAdmin.email);
  await page.getByLabel('Local UAT password').fill(selectorAdmin.password);
  await page.getByRole('button', { name: 'Sign in for local UAT' }).click();
  await expect.poll(async () => {
    if (await page.getByRole('heading', { name: 'Select Workspace' }).isVisible().catch(() => false)) return 'picker';
    if (await page.getByRole('heading', { name: 'Key Metrics' }).isVisible().catch(() => false)) return 'dashboard';
    return 'loading';
  }, { timeout: 30_000 }).toMatch(/picker|dashboard/);
  if (await page.getByRole('heading', { name: 'Select Workspace' }).isVisible().catch(() => false)) {
    await page.getByRole('button').filter({ has: page.getByText(workspaceName, { exact: true }) }).click();
  }
  await expect(page.getByRole('heading', { name: 'Key Metrics' })).toBeVisible({ timeout: 30_000 });
}

async function openPipeline(page) {
  let pipelineLink = page.getByRole('link', { name: 'Pipeline' });
  if (!await pipelineLink.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: (page.viewportSize()?.width || 0) < 768 ? 'More navigation' : 'Open navigation' }).click();
    pipelineLink = page.getByRole('link', { name: 'Pipeline' });
  }
  await pipelineLink.click();
  await expect(page.getByRole('heading', { name: 'Sales Pipeline' })).toBeVisible({ timeout: 30_000 });
}

async function openAddDeal(page) {
  const addDealButton = page.getByRole('button', { name: 'Add Deal', exact: true }).filter({ visible: true }).first();
  await expect(addDealButton).toBeVisible({ timeout: 30_000 });
  await addDealButton.click();
  const dialog = page.getByRole('dialog', { name: 'Add Deal dialog' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function createFixtureClient(organizationId, name) {
  const id = unique('selector-client');
  const now = Timestamp.now();
  const ref = adminDb.doc(`organizations/${organizationId}/clients/${id}`);
  await ref.set({
    name,
    company: 'Selector Browser Fixture',
    email: `${id}@example.test`,
    phone: '09178888888',
    assignedToUid: selectorAdmin.uid,
    assignedToName: selectorAdmin.displayName,
    status: 'ACTIVE',
    archived: false,
    trashed: false,
    createdAt: now,
    createdBy: selectorAdmin.uid,
    updatedAt: now,
    updatedBy: selectorAdmin.uid,
  });
  return ref;
}

async function installFirestoreRules(rules) {
  const environment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: firestoreHost, port: firestorePort, rules },
  });
  await environment.cleanup();
}

async function switchWorkspace(page, organizationId, organizationName) {
  const switcher = page.getByLabel('Switch workspace');
  await expect(switcher).toBeVisible();
  await switcher.selectOption(organizationId);
  await expect(switcher).toHaveValue(organizationId);
  await expect(page.getByText(organizationName).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Sales Pipeline' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await signInAndChooseWorkspace(page);
  await openPipeline(page);
});

test('loaded and later-page Clients are keyboard-selectable and create exactly one Deal without a Sale', async ({ page }) => {
  const dialog = await openAddDeal(page);
  const title = dialog.getByPlaceholder('Deal title');
  const clientSearch = dialog.getByRole('combobox', { name: 'Client' });
  await expect(clientSearch).toBeVisible();
  const initialOptions = dialog.getByRole('listbox').getByRole('option');
  await expect(initialOptions.first()).toBeVisible();
  expect(await initialOptions.count()).toBeGreaterThan(0);
  expect(await initialOptions.count()).toBeLessThanOrEqual(8);

  await title.focus();
  await page.keyboard.press('Tab');
  await expect(clientSearch).toBeFocused();
  await clientSearch.fill('m');
  await expect(dialog.getByText('Enter at least 2 characters to search.')).toBeVisible();
  await expect(dialog.getByRole('listbox')).toHaveCount(0);

  await clientSearch.fill('Marquee');
  const laterPageOption = dialog.getByRole('option', { name: new RegExp(fixture.clients.laterPage.name) });
  await expect(laterPageOption).toBeVisible();
  await clientSearch.press('ArrowDown');
  await expect(clientSearch).toHaveAttribute('aria-activedescendant', await laterPageOption.getAttribute('id'));
  await clientSearch.press('Enter');
  await expect(dialog.getByText(fixture.clients.laterPage.name, { exact: true })).toBeVisible();
  await expect(clientSearch).toBeFocused();
  await expect(dialog.getByRole('listbox')).toHaveCount(0);

  await clientSearch.fill('No Client Matches This');
  await expect(dialog.getByText('No matching active Clients found.')).toBeVisible();
  await expect(dialog.getByText(fixture.clients.laterPage.name, { exact: true })).toBeVisible();
  await clientSearch.fill('');
  await expect(dialog.getByRole('listbox')).toBeVisible();
  await clientSearch.press('Escape');
  await expect(dialog.getByRole('listbox')).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(clientSearch).toBeFocused();
  await expect(dialog.getByText(fixture.clients.laterPage.name, { exact: true })).toBeVisible();

  const dealTitle = unique('Selector Browser Deal');
  await title.fill(dealTitle);
  await dialog.getByRole('button', { name: 'Create Deal' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(dealTitle, { exact: true })).toBeVisible();

  const deals = await adminDb.collection(`organizations/${workspaceA.id}/deals`).where('title', '==', dealTitle).get();
  expect(deals.size).toBe(1);
  expect(deals.docs[0].data().clientId).toBe(fixture.clients.laterPage.id);
  expect(deals.docs[0].data().stage).toBe('New');
  const sales = await adminDb.collection(`organizations/${workspaceA.id}/sales`).where('dealId', '==', deals.docs[0].id).get();
  expect(sales.size).toBe(0);
});

test('transient search failure is safe, retryable, and not cached', async ({ page }) => {
  const recoveryName = `Recovery ${unique('Client')}`;
  await createFixtureClient(workspaceA.id, recoveryName);
  const dialog = await openAddDeal(page);
  const clientSearch = dialog.getByRole('combobox', { name: 'Client' });

  await installFirestoreRules("rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }");
  try {
    await clientSearch.fill(recoveryName);
    await expect(dialog.getByText('Unable to search Clients. Check your connection and try again.')).toBeVisible({ timeout: 20_000 });
    await expect(dialog).not.toContainText(/FirebaseError|Firestore|PERMISSION_DENIED|stack/i);
  } finally {
    await installFirestoreRules(firestoreRules);
  }
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog.getByRole('option', { name: new RegExp(recoveryName) })).toBeVisible({ timeout: 20_000 });
});

test('rapid searches keep only the newest deduplicated result and preserve selection', async ({ page }) => {
  const dialog = await openAddDeal(page);
  const clientSearch = dialog.getByRole('combobox', { name: 'Client' });
  await clientSearch.fill('ma');
  await page.waitForTimeout(260);
  await clientSearch.fill('mark');
  await page.waitForTimeout(260);
  await clientSearch.fill('marke');

  const finalOption = dialog.getByRole('option', { name: new RegExp(fixture.clients.staleFinal.name) });
  await expect(finalOption).toBeVisible();
  await expect(dialog.getByRole('option', { name: /Maple Stale Client|Mark Stale Client/ })).toHaveCount(0);
  await expect(finalOption).toHaveCount(1);
  await finalOption.click();
  await clientSearch.fill('another query');
  await expect(dialog.getByText(fixture.clients.staleFinal.name, { exact: true })).toBeVisible();
});

test('workspace switching clears the previous selection and keeps search tenant-scoped', async ({ page }) => {
  let dialog = await openAddDeal(page);
  let clientSearch = dialog.getByRole('combobox', { name: 'Client' });
  await clientSearch.fill('Marquee');
  await dialog.getByRole('option', { name: new RegExp(fixture.clients.laterPage.name) }).click();
  await expect(dialog.getByText(fixture.clients.laterPage.name, { exact: true })).toBeVisible();
  await clientSearch.fill('Maple');
  await page.waitForTimeout(260);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await switchWorkspace(page, workspaceB.id, workspaceB.name);
  dialog = await openAddDeal(page);
  clientSearch = dialog.getByRole('combobox', { name: 'Client' });
  await expect(dialog.getByText(fixture.clients.laterPage.name, { exact: true })).toHaveCount(0);
  await clientSearch.fill('Marquee');
  await expect(dialog.getByText('No matching active Clients found.')).toBeVisible();
  await clientSearch.fill('Workspace B Private');
  await expect(dialog.getByRole('option', { name: new RegExp(fixture.clients.workspaceBOnly.name) })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await switchWorkspace(page, workspaceA.id, workspaceA.name);
  dialog = await openAddDeal(page);
  clientSearch = dialog.getByRole('combobox', { name: 'Client' });
  await clientSearch.fill('Workspace B Private');
  await expect(dialog.getByText('No matching active Clients found.')).toBeVisible();
});

for (const unavailableState of ['missing', 'archived', 'trashed']) {
  test(`Deal submission fails safely when the selected Client becomes ${unavailableState}`, async ({ page }) => {
    const clientName = `${unavailableState} ${unique('Client')}`;
    const clientRef = await createFixtureClient(workspaceA.id, clientName);
    const dialog = await openAddDeal(page);
    const clientSearch = dialog.getByRole('combobox', { name: 'Client' });
    await clientSearch.fill(clientName);
    await dialog.getByRole('option', { name: new RegExp(clientName) }).click();

    if (unavailableState === 'missing') await clientRef.delete();
    if (unavailableState === 'archived') await clientRef.update({ status: 'ARCHIVED', archived: true, updatedAt: Timestamp.now() });
    if (unavailableState === 'trashed') await clientRef.update({ status: 'ARCHIVED', archived: true, trashed: true, updatedAt: Timestamp.now() });

    const dealTitle = unique('Unavailable Client Deal');
    await dialog.getByPlaceholder('Deal title').fill(dealTitle);
    await dialog.getByRole('button', { name: 'Create Deal' }).click();
    await expect(dialog.getByRole('alert')).toContainText('The selected client is not available.');
    await expect(dialog).not.toContainText(/FirebaseError|Firestore|PERMISSION_DENIED|stack/i);
    await expect(dialog).toBeVisible();
    const deals = await adminDb.collection(`organizations/${workspaceA.id}/deals`).where('title', '==', dealTitle).get();
    expect(deals.size).toBe(0);
  });
}

test.describe('mobile viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Add Deal Client selector remains usable without horizontal inaccessibility', async ({ page }) => {
    const dialog = await openAddDeal(page);
    const clientSearch = dialog.getByRole('combobox', { name: 'Client' });
    await expect(clientSearch).toBeVisible();
    const viewport = page.viewportSize();
    const box = await dialog.boundingBox();
    expect(viewport).not.toBeNull();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await clientSearch.fill('Marquee');
    const option = dialog.getByRole('option', { name: new RegExp(fixture.clients.laterPage.name) });
    await expect(option).toBeVisible();
    await clientSearch.press('ArrowDown');
    await clientSearch.press('Enter');
    await expect(dialog.getByText(fixture.clients.laterPage.name, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Create Deal' })).toBeVisible();
  });
});
