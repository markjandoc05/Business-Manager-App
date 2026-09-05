import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const credentialsPath = process.env.BSM_UAT_CREDENTIALS_FILE;
if (!credentialsPath) throw new Error('BSM_UAT_CREDENTIALS_FILE is required for authenticated UAT smoke tests.');
const fixture = JSON.parse(readFileSync(credentialsPath, 'utf8'));
const users = Array.isArray(fixture.users) ? fixture.users : [];

function credentialsFor(role) {
  const identity = users.find((user) => user.role === role);
  if (!identity?.email || !identity.password) throw new Error(`No generated ${role} credentials were found in the local UAT fixture.`);
  return identity;
}

async function signIn(page, identity, { navigate = true } = {}) {
  const loginPrompt = page.getByText('Local UAT sign-in');
  const dashboard = page.getByRole('heading', { name: 'Key Metrics' });
  let authenticated = false;
  if (navigate) {
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    if (response && response.status() >= 500) throw new Error(`Local UAT login route returned HTTP ${response.status()}.`);
  }
  if (await dashboard.isVisible().catch(() => false)) authenticated = true;
  if (!authenticated) {
    try {
      await expect(loginPrompt).toBeVisible({ timeout: 30_000 });
    } catch (error) {
      console.log('Local UAT sign-in did not render:', JSON.stringify({ url: page.url(), body: await page.locator('body').innerText().catch(() => '') }));
      throw error;
    }
    await page.getByLabel('Local UAT email').fill(identity.email);
    await page.getByLabel('Local UAT password').fill(identity.password);
    await page.getByRole('button', { name: 'Sign in for local UAT' }).click();
  }
  await expect(dashboard).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('BSM UAT Workspace').first()).toBeVisible();
}

async function openRoute(page, path, heading) {
  const labelByPath = { '/clients': 'Clients', '/sales': 'Sales Log', '/reports': 'Reports' };
  const link = page.getByRole('link', { name: labelByPath[path] });
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 30_000 });
}

async function signOut(page) {
  await page.getByRole('button', { name: 'Sign out' }).last().click();
  await expect(page.getByText('Local UAT sign-in')).toBeVisible({ timeout: 15_000 });
}

test('ADMIN, MANAGER, and USER can authenticate through the local emulator and open core workspace routes', async ({ page }) => {
  const consoleErrors = [];
  page.on('pageerror', (error) => { consoleErrors.push(error.message); console.log('browser pageerror:', error.stack || error.message); });
  page.on('console', (message) => { if (message.type() === 'error') { consoleErrors.push(message.text()); console.log('browser console error:', message.text()); } });
  for (const role of ['ADMIN', 'MANAGER', 'USER']) {
    await signIn(page, credentialsFor(role), { navigate: true });
    await expect(page.locator('.sidebar-role-label')).toHaveText(role);
    await openRoute(page, '/clients', 'Clients');
    await openRoute(page, '/sales', 'Sales Log');
    await openRoute(page, '/reports', 'Reports & Analytics');
    await expect(page.getByRole('heading', { name: 'Reports & Analytics' })).toBeVisible();
    await signOut(page);
  }
  const actionableErrors = consoleErrors.filter((message) => !message.includes('Failed to load resource: the server responded with a status of 404 (Not Found)'));
  expect(actionableErrors).toEqual([]);
});
