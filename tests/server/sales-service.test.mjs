import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import * as workflow from '../../lib/sale-workflow.ts';
import * as validation from '../../lib/sale-validation.ts';

// Executes the real service with an isolated transaction adapter. These are service
// tests, not a substitute for Firestore emulator/rules/concurrency acceptance.
class FixtureDb {
  records = new Map();
  tail = Promise.resolve();
  doc(path) {
    return { path, id: path.split('/').at(-1), collection: (name) => this.collection(`${path}/${name}`) };
  }
  collection(path, filters = [], maximum = Infinity) {
    return { path, filters, maximum, doc: (id) => this.doc(`${path}/${id}`), where: (field, operator, value) => { assert.equal(operator, '=='); return this.collection(path, [...filters, [field, value]], maximum); }, limit: (count) => this.collection(path, filters, count) };
  }
  snapshot(path) {
    const value = this.records.get(path);
    return { exists: value !== undefined, id: path.split('/').at(-1), ref: this.doc(path), data: () => value === undefined ? undefined : { ...value } };
  }
  runTransaction(callback) {
    const run = async () => {
      const writes = []; let writing = false;
      const transaction = {
        get: async (ref) => {
          assert.equal(writing, false, 'All transaction reads must precede writes.');
          if (!ref.filters) return this.snapshot(ref.path);
          const docs = [...this.records.keys()].filter((path) => path.startsWith(`${ref.path}/`) && path.slice(ref.path.length + 1).indexOf('/') === -1).map((path) => this.snapshot(path)).filter((doc) => ref.filters.every(([field, value]) => doc.data()[field] === value)).slice(0, ref.maximum);
          return { docs, empty: docs.length === 0, size: docs.length };
        },
        create: (ref, data) => { writing = true; writes.push(() => { assert.equal(this.records.has(ref.path), false); this.records.set(ref.path, data); }); },
        set: (ref, data, options) => { writing = true; writes.push(() => this.records.set(ref.path, options?.merge ? { ...this.records.get(ref.path), ...data } : data)); },
        update: (ref, data) => { writing = true; writes.push(() => { assert.ok(this.records.has(ref.path)); this.records.set(ref.path, { ...this.records.get(ref.path), ...data }); }); },
        delete: (ref) => { writing = true; writes.push(() => this.records.delete(ref.path)); },
      };
      const result = await callback(transaction);
      writes.forEach((write) => write());
      return result;
    };
    const next = this.tail.then(run, run); this.tail = next.catch(() => undefined); return next;
  }
}

function fixture() {
  const db = new FixtureDb();
  const org = 'finance-org'; const uid = 'finance-admin';
  const expiry = Timestamp.fromMillis(Date.now() + 86400000);
  db.records.set(`users/${uid}`, { uid, status: 'active', active: true });
  db.records.set(`organizations/${org}`, { status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: expiry });
  db.records.set(`organizations/${org}/members/${uid}`, { userId: uid, role: 'ADMIN', status: 'active' });
  db.records.set(`organizations/${org}/license/current`, { plan: 'TEAM', status: 'ACTIVE', maxUsers: 3, subscriptionEndsAt: expiry });
  const source = fs.readFileSync('lib/server/sales-service.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const fixtureModule = { exports: {} };
  const dependencies = { 'node:crypto': crypto, 'firebase-admin/firestore': { Timestamp, FieldValue }, '@/lib/server/firebase-admin': { adminDb: db }, '@/lib/sale-workflow': workflow, '@/lib/sale-validation': validation };
  const localRequire = (name) => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected runtime dependency ${name}`); return dependencies[name]; };
  vm.runInNewContext(compiled, { module: fixtureModule, exports: fixtureModule.exports, require: localRequire, Date, console, Error, Number, String, Object, Promise }, { filename: 'sales-service.fixture.js' });
  return { db, org, uid, service: fixtureModule.exports, path: `organizations/${org}` };
}

const sale = (changes = {}) => ({ saleDate: '2026-10-07', customerType: 'WALK_IN', customerName: 'Fixture buyer', items: [{ source: 'OTHER', catalogItemId: null, type: null, name: 'Service', code: '', categoryId: null, category: '', unit: '', regularPrice: 0.3, salePrice: null, quantity: 1, unitPrice: 0.3, subtotal: 0.3 }], paymentStatus: 'PARTIAL', paymentMethod: 'CASH', amountPaid: 0.1, ...changes });

test('decimal Sale creates one opening receipt and same-key retries do not duplicate Sale/sequence', async () => {
  const f = fixture();
  f.db.records.set(`${f.path}/settings/settings`, { salesReferenceMode: 'SEQUENTIAL', salesReferencePrefix: 'SALE-', salesReferenceStartingNumber: 20, salesReferenceDigits: 3 });
  const results = await Promise.all([1, 2].map(() => f.service.createSaleForOrganization(f.org, f.uid, sale(), 'same-operation-key')));
  assert.equal(results[0], results[1]);
  const stored = f.db.records.get(`${f.path}/sales/${results[0]}`);
  assert.equal(stored.total, 0.3); assert.equal(stored.balance, 0.2); assert.equal(stored.saleNumber, 'SALE-020');
  assert.equal(f.db.records.get(`${f.path}/sales/${results[0]}/payments/opening`).amount, 0.1);
  assert.equal(f.db.records.get(`${f.path}/settings/salesSequence`).nextNumber, 21);
  await assert.rejects(f.service.createSaleForOrganization(f.org, f.uid, sale({ notes: 'Different details' }), 'same-operation-key'), /different financial details/);
});

test('payment replay is idempotent, immutable and uses exact cents across .1 + .2', async () => {
  const f = fixture(); const id = await f.service.createSaleForOrganization(f.org, f.uid, sale(), 'create-operation-key');
  const input = { amount: 0.2, method: 'CASH', paymentDate: '2026-10-07' };
  await Promise.all([1, 2].map(() => f.service.recordPaymentForOrganization(f.org, f.uid, id, input, 'payment-operation-key')));
  assert.equal(f.db.records.get(`${f.path}/sales/${id}`).amountPaid, 0.3);
  assert.equal(f.db.records.get(`${f.path}/sales/${id}`).balance, 0);
  const events = [...f.db.records].filter(([path]) => path.startsWith(`${f.path}/sales/${id}/payments/`));
  assert.equal(events.length, 2); assert.equal(Math.round(events.reduce((sum, [, event]) => sum + event.amount, 0) * 100), 30);
  await assert.rejects(f.service.recordPaymentForOrganization(f.org, f.uid, id, { ...input, amount: 0.1 }, 'payment-operation-key'), /different financial details/);
  await assert.rejects(f.service.recordPaymentForOrganization(f.org, f.uid, id, input, 'another-payment-key'), /outstanding balance/);
});

test('legacy aggregate-only Sales accept additional receipts without backfilling or rewriting snapshots', async () => {
  const f = fixture(); const legacy = { status: 'ACTIVE', total: 19.99, amountPaid: 6.66, balance: 13.33, items: [{ legacy: 'retained' }], createdBy: 'legacy-owner' };
  f.db.records.set(`${f.path}/sales/legacy-sale`, legacy);
  await f.service.recordPaymentForOrganization(f.org, f.uid, 'legacy-sale', { amount: 13.33, method: 'CASH', paymentDate: '2026-10-07' }, 'legacy-payment-key');
  assert.equal(f.db.records.get(`${f.path}/sales/legacy-sale`).amountPaid, 19.99);
  assert.equal(f.db.records.has(`${f.path}/sales/legacy-sale/payments/opening`), false);
  assert.equal(f.db.records.get(`${f.path}/sales/legacy-sale`).items, legacy.items);
});

test('zero-price paid Sales have no zero-amount receipt', async () => {
  const f = fixture(); const body = sale({ paymentStatus: 'PAID', amountPaid: 0 });
  Object.assign(body.items[0], { regularPrice: 0, unitPrice: 0, subtotal: 0 });
  const id = await f.service.createSaleForOrganization(f.org, f.uid, body, 'zero-sale-operation');
  assert.equal(f.db.records.has(`${f.path}/sales/${id}/payments/opening`), false);
});

test('USER, inactive user, foreign tenant and expired/disabled license fail closed', async () => {
  for (const change of ['USER', 'inactive', 'foreign', 'expired', 'disabled', 'invalid-active']) {
    const f = fixture();
    if (change === 'USER') f.db.records.get(`${f.path}/members/${f.uid}`).role = 'USER';
    if (change === 'inactive') f.db.records.get(`users/${f.uid}`).status = 'inactive';
    if (change === 'invalid-active') f.db.records.get(`users/${f.uid}`).active = 'true';
    if (change === 'expired') f.db.records.get(`${f.path}/license/current`).subscriptionEndsAt = Timestamp.fromMillis(1);
    if (change === 'disabled') f.db.records.get(f.path).licenseWriteEnabled = false;
    await assert.rejects(f.service.createSaleForOrganization(change === 'foreign' ? 'other-org' : f.org, f.uid, sale(), 'blocked-operation-key'));
    assert.equal([...f.db.records.keys()].some((path) => path.includes('/sales/')), false);
  }
});

test('standalone Client creation rechecks current parent availability in the transaction', async () => {
  for (const client of [null, { name: 'Client', archived: true }, { name: 'Client', trashed: true }, { name: 'Client', status: 'ARCHIVED' }]) {
    const f = fixture(); if (client) f.db.records.set(`${f.path}/clients/client`, client);
    await assert.rejects(f.service.createSaleForOrganization(f.org, f.uid, sale({ customerType: 'CLIENT', clientId: 'client' }), 'client-sale-operation'), /Client is not available/);
  }
  const f = fixture(); f.db.records.set(`${f.path}/clients/client`, { name: 'Current authoritative name' });
  const id = await f.service.createSaleForOrganization(f.org, f.uid, sale({ customerType: 'CLIENT', clientId: 'client', customerName: 'Stale browser name' }), 'client-sale-operation');
  assert.equal(f.db.records.get(`${f.path}/sales/${id}`).customerName, 'Current authoritative name');
});

test('Won Deal requires matching Client and legacy active Sale prevents a second recording without a lock', async () => {
  const f = fixture(); f.db.records.set(`${f.path}/clients/client`, { name: 'Client' });
  f.db.records.set(`${f.path}/deals/deal`, { status: 'Won', stage: 'Won', clientId: 'client' });
  f.db.records.set(`${f.path}/sales/legacy`, { status: 'ACTIVE', dealId: 'deal' });
  await assert.rejects(f.service.createSaleForOrganization(f.org, f.uid, sale({ customerType: 'CLIENT', clientId: 'client', source: 'DEAL', dealId: 'deal' }), 'deal-sale-operation'), /already been recorded/);
});

test('reopened/archived Deals retain voided Sales and AVAILABLE locks; empty archived Deal remains deletable', async () => {
  for (const evidence of ['sale', 'active-lock', 'available-lock']) {
    const f = fixture(); f.db.records.set(`${f.path}/deals/deal`, { status: 'Active', stage: 'New', archived: true });
    if (evidence === 'sale') f.db.records.set(`${f.path}/sales/historical`, { status: 'VOIDED', archived: true, trashed: true, dealId: 'deal' });
    else f.db.records.set(`${f.path}/dealSaleLocks/deal`, { status: evidence === 'active-lock' ? 'ACTIVE' : 'AVAILABLE' });
    await assert.rejects(f.service.deleteDealForOrganization(f.org, f.uid, 'deal'), /recorded financial history/);
    assert.equal(f.db.records.has(`${f.path}/deals/deal`), true);
  }
  const f = fixture(); f.db.records.set(`${f.path}/deals/deal`, { status: 'Active', archived: true });
  await f.service.deleteDealForOrganization(f.org, f.uid, 'deal');
  assert.equal(f.db.records.has(`${f.path}/deals/deal`), false);
});

test('Client retention is rechecked inside deletion transactions for every Sale status and existing Deal blockers', async () => {
  const source = fs.readFileSync('lib/server/financial-retention.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const fixtureModule = { exports: {} };
  vm.runInNewContext(compiled, { module: fixtureModule, exports: fixtureModule.exports, Promise, Error }, { filename: 'financial-retention.fixture.js' });
  for (const evidence of ['ACTIVE', 'VOIDED', 'Won', 'Lost', 'Active']) {
    const f = fixture(); f.db.records.set(`${f.path}/clients/client`, { archived: true, trashed: true });
    if (['ACTIVE', 'VOIDED'].includes(evidence)) f.db.records.set(`${f.path}/sales/historical`, { clientId: 'client', status: evidence, archived: true, trashed: true });
    else f.db.records.set(`${f.path}/deals/deal`, { clientId: 'client', status: evidence });
    await assert.rejects(f.db.runTransaction(async (transaction) => {
      await fixtureModule.exports.assertClientFinancialRetention(transaction, f.db.doc(f.path), 'client');
      transaction.delete(f.db.doc(`${f.path}/clients/client`));
    }), /FINANCIAL_REFERENCES/);
    assert.equal(f.db.records.has(`${f.path}/clients/client`), true);
  }
  const f = fixture(); f.db.records.set(`${f.path}/clients/client`, { archived: true });
  f.db.records.set(`${f.path}/deals/deal`, { clientId: 'client', status: 'Active', archived: true });
  await f.db.runTransaction((transaction) => fixtureModule.exports.assertClientFinancialRetention(transaction, f.db.doc(f.path), 'client'));
});
