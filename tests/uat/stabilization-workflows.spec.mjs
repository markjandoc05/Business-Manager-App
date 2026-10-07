import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { test, expect } from '@playwright/test';

const projectId = 'demo-bsm-client-app';
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key] || '')) throw new Error('Workflow acceptance requires loopback emulators.');
}
for (const key of ['FIREBASE_ADMIN_PROJECT_ID', 'NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT']) {
  if (process.env[key] !== projectId) throw new Error('Workflow acceptance requires the demo project.');
}
const fixture = JSON.parse(readFileSync(process.env.BSM_UAT_CREDENTIALS_FILE, 'utf8'));
const identity = fixture.users.find((user) => user.role === 'ADMIN');
const db = getFirestore(initializeApp({ projectId }, 'stabilization-workflow-acceptance'));
const collection = (name) => db.collection(`organizations/${fixture.organizationId}/${name}`);

async function signIn(page) {
  await page.goto('/');
  await page.getByLabel('Local UAT email').fill(identity.email);
  await page.getByLabel('Local UAT password').fill(identity.password);
  await page.getByRole('button', { name: 'Sign in for local UAT' }).click();
  await expect(page.getByRole('heading', { name: 'KPIs' })).toBeVisible();
}
async function record(name, field, value) {
  const result = await collection(name).where(field, '==', value).get();
  expect(result.size).toBe(1);
  return { id: result.docs[0].id, ...result.docs[0].data() };
}

test('Native workflow creates a Lead, Client, and general Task and preserves them after reload', async ({ page }) => {
  await signIn(page);
  const name = `Native CRM ${randomUUID()}`;
  await page.goto('/leads');
  await page.getByRole('button', { name: 'Add Lead', exact: true }).first().click();
  const lead = page.getByRole('dialog', { name: 'Add Lead dialog' });
  await lead.locator('input[type="text"]').first().fill(name);
  await lead.locator('input[type="email"]').fill(`lead-${randomUUID()}@example.test`);
  await lead.locator('select').first().selectOption({ label: 'Website' });
  await lead.getByRole('button', { name: 'Save Lead' }).click();
  await expect(lead).toHaveCount(0);
  expect((await record('leads', 'name', name)).assignedToUid).toBe(identity.uid);
  await page.reload();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

  await page.goto('/clients');
  await page.getByRole('button', { name: 'Add Client', exact: true }).first().click();
  const client = page.getByRole('dialog', { name: 'Add Client dialog' });
  await client.locator('input[type="text"]').first().fill(name);
  await client.locator('input[type="email"]').fill(`client-${randomUUID()}@example.test`);
  await client.getByRole('button', { name: 'Save Client' }).click();
  await expect(client).toHaveCount(0);
  expect((await record('clients', 'name', name)).status).toBe('ACTIVE');
  await page.reload();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();

  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add Task', exact: true }).first().click();
  const task = page.getByRole('dialog', { name: 'Task form' });
  await task.getByLabel('Title', { exact: true }).fill(name);
  const scheduled = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  await task.locator('input[type="datetime-local"]').fill(scheduled);
  await task.getByLabel('Related Record').selectOption('');
  await task.getByRole('button', { name: 'Save Task' }).click();
  await expect(task).toHaveCount(0);
  const saved = await record('tasks', 'title', name);
  expect(saved.dueDate).toBe(await page.evaluate((localTime) => new Date(localTime).toISOString(), scheduled));
  expect(saved.relatedTo == null).toBe(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tasks & Follow-ups', exact: true })).toBeVisible();
  expect((await record('tasks', 'title', name)).dueDate).toBe(saved.dueDate);
});

test('Native workflow sells a Catalog item and posts partial and final payments with exact totals', async ({ page }) => {
  await signIn(page);
  const name = `Native Sale ${randomUUID()}`;
  await page.goto('/catalog');
  await page.getByRole('button', { name: 'Add Item', exact: true }).first().click();
  const item = page.getByRole('dialog', { name: 'Catalog item form' });
  await item.locator('#catalog-name').fill(name);
  await item.locator('#catalog-regular-price').fill('0.30');
  await item.getByRole('button', { name: 'Save Item', exact: true }).click();
  await expect(item).toHaveCount(0);
  const catalog = await record('catalogItems', 'name', name);
  expect(catalog.regularPrice).toBe(0.3);

  await page.goto('/sales');
  await page.getByRole('button', { name: 'Record Sale', exact: true }).first().click();
  const sale = page.getByRole('dialog', { name: 'Record Sale', exact: true });
  await sale.getByPlaceholder('Customer name').fill(name);
  await sale.getByRole('button', { name: /^Products & Services/ }).click();
  await sale.getByRole('button', { name: 'Add Product / Service', exact: true }).click();
  const selector = page.getByRole('dialog', { name: 'Select Product or Service' });
  await selector.getByPlaceholder('Search name, code, or category').fill(name);
  await selector.getByRole('button', { name: 'Add', exact: true }).click();
  await selector.getByRole('button', { name: /Close/ }).click();
  await sale.getByRole('button', { name: /^Payment ·/ }).click();
  await sale.getByRole('combobox', { name: 'Status', exact: true }).selectOption('PARTIAL');
  await sale.getByRole('textbox', { name: /^Amount paid/ }).fill('0.10');
  await sale.getByRole('button', { name: 'Record Sale', exact: true }).click();
  await expect(sale).toHaveCount(0);
  const opening = await record('sales', 'customerName', name);
  expect(opening).toMatchObject({ total: 0.3, amountPaid: 0.1, balance: 0.2, paymentStatus: 'PARTIAL' });
  expect(opening.items[0]).toMatchObject({ catalogItemId: catalog.id, unitPrice: 0.3 });
  await page.getByRole('button', { name: `View ${opening.saleNumber}`, exact: true }).click();
  await page.getByRole('dialog', { name: 'Sale details' }).getByRole('button', { name: 'Record Payment', exact: true }).click();
  const payment = page.getByRole('dialog', { name: 'Record payment', exact: true });
  await payment.getByRole('textbox', { name: /^Amount/ }).fill('0.20');
  // Commit the first request but lose its response, then retry through the UI.
  // The real API must retain one immutable receipt for the operation.
  const paymentKeys = [];
  await page.route('**/api/organizations/*/sales/*/payments', async (route) => {
    paymentKeys.push(route.request().headers()['idempotency-key']);
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    if (paymentKeys.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await payment.getByRole('button', { name: 'Record Payment', exact: true }).click();
  await expect(payment.getByRole('button', { name: 'Record Payment', exact: true })).toBeEnabled();
  await expect(payment).toBeVisible();
  await payment.getByRole('button', { name: 'Record Payment', exact: true }).click();
  await expect(payment).toHaveCount(0);
  expect(paymentKeys).toHaveLength(2);
  expect(paymentKeys[0]).toBeTruthy();
  expect(new Set(paymentKeys).size).toBe(1);
  const paid = await record('sales', 'customerName', name);
  expect(paid).toMatchObject({ total: 0.3, amountPaid: 0.3, balance: 0, paymentStatus: 'PAID' });
  const receipts = await collection('sales').doc(paid.id).collection('payments').get();
  expect(receipts.size).toBe(2);
  expect(receipts.docs.reduce((sum, doc) => sum + Math.round(doc.data().amount * 100), 0)).toBe(30);
  await page.reload();
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toContainText('Paid');
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports & Analytics' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'KPIs' })).toBeVisible();
});
