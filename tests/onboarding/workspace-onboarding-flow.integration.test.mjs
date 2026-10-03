import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { chromium } from '@playwright/test';

// Default to the isolated Client demo project for package-script execution.
// The shared Platform UAT environment is explicitly selectable for the
// cutover browser validation; production project IDs are never accepted here.
const PROJECT_ID = process.env.BSM_ONBOARDING_TEST_PROJECT_ID === 'demo-bsm-console'
  ? 'demo-bsm-console'
  : 'demo-bsm-client-app';
const PORT = 3102;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const EMULATOR_HOSTS = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'];

if (process.env.GOOGLE_CLOUD_PROJECT === 'bsm-client-app-web' || process.env.GCLOUD_PROJECT === 'bsm-client-app-web') {
  throw new Error('Refusing onboarding UI tests with the production project ID.');
}
if (!EMULATOR_HOSTS.every((name) => process.env[name])) {
  throw new Error(`Onboarding UI tests require ${EMULATOR_HOSTS.join(' and ')}.`);
}

process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = PROJECT_ID;

const app = getApps()[0] || initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
const adminAuth = getAuth(app);
const adminDb = getFirestore(app);
let sequence = 0;
let server;
let browser;

function id(prefix) {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

function nextEnvironment({ platformOnboarding, subscriptionMock }) {
  return {
    ...process.env,
    GOOGLE_CLOUD_PROJECT: PROJECT_ID,
    GCLOUD_PROJECT: PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT_ID,
    NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-key',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PROJECT_ID}.firebaseapp.com`,
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${PROJECT_ID}.firebasestorage.app`,
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '000000000000',
    NEXT_PUBLIC_FIREBASE_APP_ID: '1:000000000000:web:onboarding-ui-test',
    NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
    NEXT_PUBLIC_LOCAL_UAT: 'true',
    NEXT_PUBLIC_ENABLE_PLATFORM_ONBOARDING: platformOnboarding ? 'true' : 'false',
    NEXT_PUBLIC_ENABLE_PLATFORM_SUBSCRIPTION_MOCK: subscriptionMock ? 'true' : 'false',
  };
}

async function startNext(flags) {
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: nextEnvironment(flags),
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
      // The server is still compiling.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Next.js did not become ready.\n${output.join('')}`);
}

async function stopNext() {
  if (!server || server.killed) return;
  const exit = once(server, 'exit');
  server.kill('SIGTERM');
  await exit;
  server = undefined;
}

async function withNext(flags, action) {
  await startNext(flags);
  try {
    await action();
  } finally {
    await stopNext();
  }
}

async function createLocalUatUser(label) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  const password = `Onboarding-${uid}-password`;
  await adminAuth.createUser({ uid, email, password, emailVerified: true });
  return { uid, email, password };
}

async function openNoWorkspace(user) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Local UAT email').fill(user.email);
  await page.getByLabel('Local UAT password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in for local UAT' }).click();
  await page.getByRole('heading', { name: 'No workspace found' }).waitFor();
  return { context, page };
}

async function openOnboarding(user) {
  const { context, page } = await openNoWorkspace(user);
  await page.getByRole('button', { name: 'Create Your Workspace' }).click();
  await page.getByRole('heading', { name: 'Create your workspace' }).waitFor();
  return { context, page };
}

before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

after(async () => {
  await stopNext();
  if (browser) await browser.close();
});

test('feature flag OFF disables new workspace onboarding instead of restoring the retired V1 browser bootstrap', async () => {
  await withNext({ platformOnboarding: false, subscriptionMock: false }, async () => {
    const user = await createLocalUatUser('platform-gate-off');
    const { context, page } = await openNoWorkspace(user);
    try {
      assert.equal(await page.getByRole('button', { name: 'Create Workspace' }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Create Your Workspace' }).count(), 0);
      await assertVisible(page, 'New workspace provisioning is temporarily unavailable.');
      assert.equal((await adminDb.collection('organizations').where('createdByUid', '==', user.uid).get()).size, 0);
      assert.equal((await adminDb.doc(`workspaceBootstrap/${user.uid}`).get()).exists, false);
    } finally {
      await context.close();
    }
  });
});

test('Platform onboarding fails closed without the explicitly enabled local development mock', async () => {
  await withNext({ platformOnboarding: true, subscriptionMock: false }, async () => {
    const user = await createLocalUatUser('platform-no-mock');
    const { context, page } = await openOnboarding(user);
    try {
      await page.getByPlaceholder('e.g. Acme Studio').fill('No Mock Workspace');
      await page.getByRole('button', { name: 'Continue' }).click();
      await assertVisible(page, 'Choose your plan');
      await assertVisible(page, 'Unable to load the available signup plan. Please try again later.');
      assert.equal(await page.getByRole('button', { name: 'Create Workspace' }).count(), 0);
    } finally {
      await context.close();
    }
  });
});

test('Platform onboarding reaches review, supports back navigation, and never falls back to V1 provisioning', async () => {
  await withNext({ platformOnboarding: true, subscriptionMock: true }, async () => {
    const user = await createLocalUatUser('platform-onboarding');
    const { context, page } = await openOnboarding(user);
    try {
      await page.getByPlaceholder('e.g. Acme Studio').fill('Platform Workspace');
      await page.getByRole('button', { name: 'Continue' }).click();
      await assertVisible(page, 'Choose your plan');
      await assertVisible(page, 'Development Signup Plan');
      await assertVisible(page, 'Choose the plan that fits your business.');
      await assertVisible(page, '14-day free trial');
      await assertVisible(page, 'No credit card required');
      await assertVisible(page, 'Development preview');
      await assertVisible(page, 'This development-only message verifies Platform-managed plan copy rendering.');
      assert.equal(await page.getByText('Plan code', { exact: true }).count(), 0);
      assert.equal(await page.getByText('Currency', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Continue' }).isDisabled(), true);
      const planCard = page.getByRole('button', { name: /Development Signup Plan/ });
      await planCard.click();
      assert.equal(await planCard.getAttribute('aria-pressed'), 'true');
      await assertVisible(page, 'Selected');
      assert.equal(await page.getByRole('button', { name: 'Continue' }).isDisabled(), false);
      await page.getByRole('button', { name: 'Continue' }).click();
      await assertVisible(page, 'Review and start your free trial');
      assert.equal(await page.getByPlaceholder('e.g. Acme Studio').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Create Workspace' }).count(), 0);

      await page.getByRole('button', { name: 'Back' }).click();
      await assertVisible(page, 'Choose your plan');
      await page.getByRole('button', { name: 'Back' }).click();
      assert.equal(await page.getByPlaceholder('e.g. Acme Studio').count(), 1);
      await page.getByRole('button', { name: 'Continue' }).click();
      await assertVisible(page, 'Choose your plan');
      await page.getByRole('button', { name: 'Continue' }).click();
      await assertVisible(page, 'Review and start your free trial');

      await page.getByRole('button', { name: 'Start 14-Day Free Trial' }).click();
      await assertVisible(page, 'Free-trial provisioning is not available in this local preview.');
      assert.equal((await adminDb.collection('organizations').where('createdByUid', '==', user.uid).get()).size, 0);
      assert.equal((await adminDb.doc(`workspaceBootstrap/${user.uid}`).get()).exists, false);
    } finally {
      await context.close();
    }
  });
});

async function assertVisible(page, text) {
  await page.getByText(text, { exact: false }).first().waitFor();
}
