import type { ReportData } from './repositories/reports';

export const FINANCIAL_HISTORY_NOTE = 'Sale dates are used as recorded. Historical timezone and currency are not recorded on every Sale. Display currency changes do not convert amounts.';
export const SALE_COHORT_NOTE = 'Sales and payment totals cover active Sales dated in the selected period. Paid totals include all payments recorded so far for those Sales; balances are current.';

function cell(value: string | number) { return `"${String(value).replaceAll('"', '""')}"`; }
export function createReportCSV(data: ReportData, context: { startDay: string; endDay: string; timeZone: string; currency: string }) {
  const rows: Array<[string, string | number]> = [
    ['Workspace timezone', context.timeZone], ['Start date (inclusive)', context.startDay], ['End date (exclusive)', context.endDay],
    ['Display currency (no conversion)', context.currency], ['Sales and payment scope', SALE_COHORT_NOTE], ['Historical interpretation', FINANCIAL_HISTORY_NOTE],
    ['Total Leads (created in period)', data.totalLeads], ['Clients (current)', data.clients], ['Converted Leads (created in period)', data.convertedLeads],
    ['Active Deals (current)', data.activeDeals], ['Won Deals (closed in period)', data.wonDeals], ['Lost Deals (closed in period)', data.lostDeals],
    ['Total Sales (Sale-date cohort)', data.totalSales], ['Transactions (Sale-date cohort)', data.transactions],
    ['Paid to date (Sale-date cohort)', data.amountPaid], ['Outstanding (Sale-date cohort)', data.outstanding], ['Pipeline Value (current)', data.pipelineValue],
  ];
  return 'Metric,Value\n' + rows.map((row) => row.map(cell).join(',')).join('\n');
}
