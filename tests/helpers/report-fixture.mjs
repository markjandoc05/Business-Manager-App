import assert from 'node:assert/strict';
import { repositoryFixture } from './repository-fixture.mjs';
export function reportFixture(role = 'ADMIN', overrides = {}) {
  const fixture = repositoryFixture(role, overrides);
  Object.assign(fixture.firestore, {
    count: () => ({ kind: 'count' }), sum: name => ({ kind: 'sum', name }),
    getAggregateFromServer: async (query, aggregates) => {
      const { docs } = await fixture.firestore.getDocs(query);
      return { data: () => Object.fromEntries(Object.entries(aggregates).map(([key, value]) => [key, value.kind === 'count' ? docs.length : docs.reduce((total, doc) => total + (doc.data()[value.name] || 0), 0)])) };
    },
  });
  return fixture;
}
export function financialReportRecords(uid = 'fixture-user') {
  const deal = { archived: false, assignedToUid: uid, createdAt: new Date('2020-01-01T00:00:00Z') };
  const sale = { status: 'ACTIVE', source: 'CLIENT', customerType: 'CLIENT', clientId: 'client', paymentStatus: 'PARTIAL' };
  return [
    ['clients/client', { archived: false, name: 'Synthetic Client', status: 'ACTIVE', createdAt: new Date('2020-01-01T00:00:00Z') }],
    ['deals/old-open', { ...deal, status: 'Active', stage: 'New', value: 300 }],
    ['deals/other-assignee', { ...deal, assignedToUid: 'another-user', status: 'Active', stage: 'Qualified', value: 700 }],
    ['deals/won-in-period', { ...deal, status: 'Won', stage: 'Won', value: 9000, wonAt: new Date('2026-03-01T05:00:00Z') }],
    ['deals/won-at-end', { ...deal, status: 'Won', stage: 'Won', value: 20000, wonAt: new Date('2026-04-01T04:00:00Z') }],
    ['deals/archived-open', { ...deal, archived: true, status: 'Active', stage: 'New', value: 50000 }],
    ['sales/start', { ...sale, saleDate: '2026-03-01', total: 120.25, amountPaid: 70.25, balance: 50 }],
    ['sales/end-minus-day', { ...sale, source: 'DEAL', saleDate: '2026-03-31', total: 80.75, amountPaid: 80.75, balance: 0, paymentStatus: 'PAID' }],
    ['sales/old-paid-this-month', { ...sale, saleDate: '2026-02-28', total: 400, amountPaid: 400, balance: 0, paymentStatus: 'PAID' }],
    ['sales/next-month', { ...sale, saleDate: '2026-04-01', total: 600, amountPaid: 600, balance: 0, paymentStatus: 'PAID' }],
    ['sales/voided', { ...sale, status: 'VOIDED', saleDate: '2026-03-15', total: 1000, amountPaid: 1000, balance: 0 }],
    ['leads/start', { archived: false, assignedToUid: uid, status: 'Client', source: 'Website', createdAt: new Date('2026-03-01T05:00:00Z') }],
    ['leads/before', { archived: false, assignedToUid: uid, status: 'New', source: 'Website', createdAt: new Date('2026-03-01T04:59:59.999Z') }],
    ['leads/end', { archived: false, assignedToUid: uid, status: 'New', source: 'Website', createdAt: new Date('2026-04-01T04:00:00Z') }],
  ];
}
export function seedReportFixture(fixture) {
  for (const [path, value] of financialReportRecords(fixture.user.uid)) fixture.records.set(`${fixture.prefix}/${path}`, value);
  assert.ok(fixture.records.size > 10);
}
