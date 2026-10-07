import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportFixture, seedReportFixture } from './helpers/report-fixture.mjs';
import { createReportCSV } from '../lib/report-export.ts';
import { workspaceReportRange } from '../lib/workspace-calendar.ts';
const range = workspaceReportRange('LastMonth', new Date('2026-04-15T12:00:00Z'), 'America/New_York');
const stages = ['New', 'Qualified', 'Won', 'Lost'];

test('actual report queries include older current pipeline and reconcile Sale-date cohorts separately from Won Deals', async () => {
  for (const role of ['ADMIN', 'MANAGER', 'USER']) {
    const f = reportFixture(role); seedReportFixture(f); const reports = f.load('lib/repositories/reports.ts');
    const data = await reports.loadReportData(f.user, f.org, range.start, range.end, stages, ['Website'], range.timeZone);
    assert.equal(data.pipelineValue, role === 'USER' ? 300 : 1000); assert.equal(data.activeDeals, role === 'USER' ? 1 : 2);
    assert.equal(data.pipelineByStage.New, 300); assert.equal(data.pipelineByStage.Qualified, role === 'USER' ? 0 : 700);
    assert.equal(data.wonDeals, 1); assert.equal(data.wonDealValue, 9000); assert.equal(data.totalLeads, 1); assert.equal(data.convertedLeads, 1);
    assert.equal(data.totalSales, 201); assert.equal(data.transactions, 2); assert.equal(data.amountPaid, 151); assert.equal(data.outstanding, 50);
    assert.equal(data.salesBySource.CLIENT, 1); assert.equal(data.salesBySource.DEAL, 1); assert.equal(data.salesByPaymentStatus.PAID, 1);
    // A late payment changes this Sale-date cohort's paid-to-date figure, never
    // turns it into receipts for the period or changes Sale/Deal revenue.
    Object.assign(f.records.get(`${f.prefix}/sales/start`), { amountPaid: 120.25, balance: 0, paymentStatus: 'PAID' });
    const updated = await reports.loadReportData(f.user, f.org, range.start, range.end, stages, ['Website'], range.timeZone);
    assert.equal(updated.amountPaid, 201); assert.equal(updated.outstanding, 0); assert.equal(updated.totalSales, 201);
    await assert.rejects(reports.loadReportData(f.user, 'other-org', range.start, range.end, stages, [], range.timeZone));
    const csv = createReportCSV(data, { ...range, currency: 'PHP' });
    for (const line of ['"Total Sales (Sale-date cohort)","201"', '"Paid to date (Sale-date cohort)","151"', '"Outstanding (Sale-date cohort)","50"', `"Pipeline Value (current)","${role === 'USER' ? 300 : 1000}"`, '"Workspace timezone","America/New_York"', '"End date (exclusive)","2026-04-01"']) assert.ok(csv.includes(line));
    assert.match(csv, /Display currency \(no conversion\)/); assert.match(csv, /all payments recorded so far/);
  }
});
test('actual Dashboard range metrics agree with Reports and fail partial groups without invented totals', async () => {
  const f = reportFixture(); seedReportFixture(f); const dashboard = f.load('lib/repositories/dashboard.ts');
  const result = await dashboard.loadDashboardMetrics(f.user, f.org, ['sales.total', 'sales.transactions', 'sales.collected', 'deals.open', 'deals.potentialSales', 'deals.won', 'leads.new'], range, range.timeZone);
  assert.equal(result.values['sales.total'], 201); assert.equal(result.values['sales.transactions'], 2); assert.equal(result.values['sales.collected'], 151);
  assert.equal(result.values['deals.potentialSales'], 1000); assert.equal(result.values['deals.open'], 2); assert.equal(result.values['deals.won'], 1); assert.equal(result.values['leads.new'], 1);
  assert.equal(result.failedKpis.length, 0); dashboard.invalidateDashboardMetrics(f.org);
  const original = f.firestore.getAggregateFromServer;
  f.firestore.getAggregateFromServer = async (query, fields) => { if(query.path.endsWith('/sales')) throw new Error('Synthetic sales denial'); return original(query, fields); };
  const denied = await dashboard.loadDashboardMetrics(f.user, f.org, ['sales.total', 'deals.open'], range, range.timeZone);
  assert.equal(denied.values['sales.total'], undefined); assert.equal(denied.values['deals.open'], 2); assert.ok(denied.failedKpis.includes('sales.total'));
});
test('cached metrics recheck membership and partition role changes before returning totals', async () => {
  let role = 'ADMIN'; let active = true;
  const f = reportFixture('ADMIN', { '@/lib/permissions': { requireOrganizationAccess: async () => { if (!active) throw new Error('Revoked membership'); return {membership:{role}}; } } }); seedReportFixture(f);
  const dashboard = f.load('lib/repositories/dashboard.ts');
  const selected = ['deals.open', 'deals.potentialSales'];
  assert.equal((await dashboard.loadDashboardMetrics(f.user, f.org, selected, range, range.timeZone)).values['deals.open'], 2);
  role = 'USER'; assert.equal((await dashboard.loadDashboardMetrics(f.user, f.org, selected, range, range.timeZone)).values['deals.open'], 1);
  active = false; await assert.rejects(dashboard.loadDashboardMetrics(f.user, f.org, selected, range, range.timeZone), /Revoked/);
});
test('date-only Sale cohorts use workspace dates even when UTC boundaries fall on the previous day', async () => {
  const f = reportFixture(); seedReportFixture(f); const reports = f.load('lib/repositories/reports.ts'); const dashboard = f.load('lib/repositories/dashboard.ts');
  const manila = workspaceReportRange('LastMonth', new Date('2026-04-15T12:00:00Z'), 'Asia/Manila');
  assert.equal(manila.start.toISOString(), '2026-02-28T16:00:00.000Z');
  const report = await reports.loadReportData(f.user, f.org, manila.start, manila.end, stages, [], manila.timeZone);
  const metrics = await dashboard.loadDashboardMetrics(f.user, f.org, ['sales.total','sales.collected','sales.transactions'], manila, manila.timeZone);
  assert.equal(report.totalSales, 201); assert.equal(report.amountPaid, 151); assert.equal(metrics.values['sales.total'], 201); assert.equal(metrics.values['sales.collected'], 151);
});
