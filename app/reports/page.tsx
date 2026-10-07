'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Button, EmptyState } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { loadReportData, type ReportData } from '@/lib/repositories/reports';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { getWorkspaceCalendarDate, workspaceDayStart, workspaceReportRange } from '@/lib/workspace-calendar';
import { createReportCSV, FINANCIAL_HISTORY_NOTE, SALE_COHORT_NOTE } from '@/lib/report-export';
import { BarChart3, BriefcaseBusiness, CircleDollarSign, Download, HandCoins, Percent, ReceiptText, Settings2, Target, TrendingDown, Trophy, UserCheck, Users, WalletCards } from 'lucide-react';
import { formatCurrency } from '@/lib/formatting';
import { firestoreQueryErrorMessage } from '@/lib/repositories/pagination';
import { DEAL_STAGES } from '@/lib/deal-workflow';
import { KpiCardGrid, MovableKpiCard, StandardKpiCard } from '@/components/KpiCard';
import { KpiCustomizationModal } from '@/components/KpiCustomizationModal';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { organizationPreferenceKey, readKpiPreference, reorderKpiIds, writeKpiPreference } from '@/lib/kpi-preferences';

type ReportKpiId = 'totalLeads' | 'clients' | 'convertedLeads' | 'activeDeals' | 'totalSales' | 'transactions' | 'amountPaid' | 'outstanding' | 'wonDeals' | 'lostDeals' | 'pipelineValue' | 'conversionRate';
type ReportDateRange = 'ThisMonth' | 'LastMonth' | 'ThisQuarter' | 'ThisYear';
type PendingReportExport = { scope: string; data: ReportData };
const REPORT_DATE_RANGE_LABELS: Record<ReportDateRange, string> = {
  ThisMonth: 'This Month', LastMonth: 'Last Month', ThisQuarter: 'This Quarter', ThisYear: 'This Year',
};
const REPORT_KPIS: ReadonlyArray<{ id: ReportKpiId; label: string; description: string }> = [
  { id: 'totalLeads', label: 'Total Leads', description: 'Leads created in the selected period.' },
  { id: 'clients', label: 'Clients', description: 'Active clients currently recorded in BSM.' },
  { id: 'convertedLeads', label: 'Converted Leads', description: 'Leads created in the selected period that are currently converted into Clients.' },
  { id: 'activeDeals', label: 'Active Deals', description: 'Deals currently in progress.' },
  { id: 'totalSales', label: 'Total Sales', description: 'Total value of active sales.' },
  { id: 'transactions', label: 'Transactions', description: 'Number of active sales recorded.' },
  { id: 'amountPaid', label: 'Paid to date', description: 'All payments recorded so far for active Sales dated in the selected period.' },
  { id: 'outstanding', label: 'Outstanding Balance', description: 'Current unpaid balance for active Sales dated in the selected period.' },
  { id: 'wonDeals', label: 'Won Deals', description: 'Deals successfully closed as won.' },
  { id: 'lostDeals', label: 'Lost Deals', description: 'Deals marked as lost.' },
  { id: 'pipelineValue', label: 'Pipeline Value', description: 'Total value of open deals.' },
  { id: 'conversionRate', label: 'Conversion Rate', description: 'Current converted share of Leads created in the selected period.' },
];
const REPORT_DEFAULT_KPI_IDS: readonly ReportKpiId[] = [
  'totalSales',
  'amountPaid',
  'outstanding',
  'pipelineValue',
  'wonDeals',
  'conversionRate',
];
const REPORT_KPI_STORAGE_KEY = 'bsm_reports_kpis_v1';
const REPORT_MIN_KPIS = 3;
const REPORT_MAX_KPIS = 12;
const REPORT_KPI_CONTEXTS: Record<ReportKpiId, string> = {
  totalLeads: 'Leads recorded', clients: 'Active clients', convertedLeads: 'Converted leads', activeDeals: 'Deals in progress',
  totalSales: 'Recorded sales value', transactions: 'Sales transactions', amountPaid: 'Sale-date cohort', outstanding: 'Unpaid balance',
  wonDeals: 'Successfully closed', lostDeals: 'Marked as lost', pipelineValue: 'Open Deal value', conversionRate: 'Lead conversion rate',
};
const REPORT_KPI_OPTIONS = REPORT_KPIS.map((metric) => ({ ...metric, context: REPORT_KPI_CONTEXTS[metric.id] }));
const REPORT_KPI_CATEGORIES = [
  { id: 'sales', label: 'Sales', description: 'Sale-date totals, paid amounts, and balances', optionIds: ['totalSales', 'transactions', 'amountPaid', 'outstanding'] },
  { id: 'leads-clients', label: 'Leads & Clients', description: 'Customer growth and conversion activity', optionIds: ['totalLeads', 'clients', 'convertedLeads', 'conversionRate'] },
  { id: 'deals', label: 'Deals & Pipeline', description: 'Opportunity outcomes and pipeline value', optionIds: ['activeDeals', 'wonDeals', 'lostDeals', 'pipelineValue'] },
] as const;

export default function ReportsPage() {
  const { settings, settingsLoading } = useApp();
  const { user } = useAuth();
  const { currentOrganizationId, ready: workspaceReady, membership } = useWorkspace();
  const [dateRange, setDateRange] = useState<ReportDateRange>('ThisMonth');
  const [loadedReportData, setReportData] = useState<ReportData | null>(null);
  const [reportDataScope, setReportDataScope] = useState<string | null>(null);
  const [pendingExport, setPendingExport] = useState<PendingReportExport | null>(null);
  const confirmedExportRef = useRef<PendingReportExport | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const [reloadToken, setReloadToken] = useState(0);
  const [requestScope, setRequestScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportKpiIds, setReportKpiIds] = useState<string[]>([...REPORT_DEFAULT_KPI_IDS]);
  const [reportKpiDraft, setReportKpiDraft] = useState<string[]>([...REPORT_DEFAULT_KPI_IDS]);
  const [customizeKpis, setCustomizeKpis] = useState(false);
  const [draggingKpi, setDraggingKpi] = useState<string | null>(null);

  useEffect(() => { if (currentOrganizationId) setReportKpiIds(readKpiPreference(window.localStorage, organizationPreferenceKey(REPORT_KPI_STORAGE_KEY, currentOrganizationId), REPORT_DEFAULT_KPI_IDS, REPORT_KPIS.map((metric) => metric.id), REPORT_MIN_KPIS, REPORT_MAX_KPIS)); }, [currentOrganizationId]);

  useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const workspaceToday = getWorkspaceCalendarDate(new Date(clock), settings.timezone);
  const range = useMemo(() => workspaceReportRange(dateRange, workspaceDayStart(workspaceToday, settings.timezone), settings.timezone), [dateRange, settings.timezone, workspaceToday]);
  const reportScope = JSON.stringify([user?.uid, currentOrganizationId, membership?.role, dateRange, range.startDay, range.endDay, settings.timezone, settings.currency, settings.leadSources, workspaceReady, settingsLoading, reloadToken]);
  const reportData = workspaceReady && !settingsLoading && !loading && !error && reportDataScope === reportScope ? loadedReportData : null;
  const visibleError = requestScope === reportScope ? error : null;

  useEffect(() => {
    let cancelled = false;
    if (!user || !workspaceReady || !currentOrganizationId || settingsLoading) return () => { cancelled = true; };
    setPendingExport(null);
    setRequestScope(reportScope);
    setLoading(true);
    setError(null);
    void loadReportData(user, currentOrganizationId, range.start, range.end, [...DEAL_STAGES], settings.leadSources.map((source) => source.name), settings.timezone)
      .then((data) => { if (!cancelled) { setReportData(data); setReportDataScope(reportScope); } })
      .catch((loadError) => { console.error('Unable to load report data', loadError); if (!cancelled) setError(firestoreQueryErrorMessage(loadError, 'Unable to load reports. Please try again.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentOrganizationId, range, reportScope, settings.leadSources, settings.timezone, settingsLoading, user, workspaceReady]);

  const canExportReport = workspaceReady && Boolean(user && currentOrganizationId && reportData && reportDataScope === reportScope && !loading && !error);
  const exportConfirmation = canExportReport && pendingExport?.scope === reportScope ? pendingExport : null;

  const requestExport = () => {
    if (canExportReport && reportData) setPendingExport({ scope: reportScope, data: reportData });
  };

  const exportCSV = () => {
    if (!exportConfirmation || confirmedExportRef.current === exportConfirmation) return;
    confirmedExportRef.current = exportConfirmation;
    setPendingExport(null);
    const data = exportConfirmation.data;
    const csvContent = createReportCSV(data, { ...range, currency: settings.currency });
    const objectUrl = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement("a");
    link.setAttribute("href", objectUrl);
    link.setAttribute("download", "report.csv");
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const openCustomizeKpis = () => { setReportKpiDraft([...reportKpiIds]); setCustomizeKpis(true); };
  const moveReportKpi = (targetId: string) => { if (!draggingKpi || draggingKpi === targetId) return; setReportKpiIds((current) => { const next = reorderKpiIds(current, draggingKpi, targetId); if (currentOrganizationId) writeKpiPreference(window.localStorage, organizationPreferenceKey(REPORT_KPI_STORAGE_KEY, currentOrganizationId), next); return next; }); };
  const reportMetrics = [
    { id: 'totalLeads' as const, label: 'Total Leads', value: reportData?.totalLeads || 0, description: 'Leads created in the selected period.', icon: Users, context: REPORT_KPI_CONTEXTS.totalLeads },
    { id: 'clients' as const, label: 'Clients', value: reportData?.clients || 0, description: 'Active clients currently recorded in BSM.', icon: UserCheck, context: REPORT_KPI_CONTEXTS.clients },
    { id: 'convertedLeads' as const, label: 'Converted Leads', value: reportData?.convertedLeads || 0, description: 'Leads created in the selected period that are currently converted into Clients.', icon: Target, context: REPORT_KPI_CONTEXTS.convertedLeads },
    { id: 'activeDeals' as const, label: 'Active Deals', value: reportData?.activeDeals || 0, description: 'Deals currently in progress.', icon: BriefcaseBusiness, context: REPORT_KPI_CONTEXTS.activeDeals },
    { id: 'totalSales' as const, label: 'Total Sales', value: formatCurrency(reportData?.totalSales || 0, settings.currency), description: 'Total value of active sales.', icon: ReceiptText, context: REPORT_KPI_CONTEXTS.totalSales },
    { id: 'transactions' as const, label: 'Transactions', value: reportData?.transactions || 0, description: 'Number of active sales recorded.', icon: BarChart3, context: REPORT_KPI_CONTEXTS.transactions },
    { id: 'amountPaid' as const, label: 'Paid to date', value: formatCurrency(reportData?.amountPaid || 0, settings.currency), description: 'All payments recorded so far for active Sales dated in the selected period.', icon: HandCoins, context: REPORT_KPI_CONTEXTS.amountPaid },
    { id: 'outstanding' as const, label: 'Outstanding Balance', value: formatCurrency(reportData?.outstanding || 0, settings.currency), description: 'Current unpaid balance for active Sales dated in the selected period.', icon: WalletCards, context: REPORT_KPI_CONTEXTS.outstanding },
    { id: 'wonDeals' as const, label: 'Won Deals', value: reportData?.wonDeals || 0, description: 'Deals successfully closed as won.', icon: Trophy, context: REPORT_KPI_CONTEXTS.wonDeals },
    { id: 'lostDeals' as const, label: 'Lost Deals', value: reportData?.lostDeals || 0, description: 'Deals marked as lost.', icon: TrendingDown, context: REPORT_KPI_CONTEXTS.lostDeals },
    { id: 'pipelineValue' as const, label: 'Pipeline Value', value: formatCurrency(reportData?.pipelineValue || 0, settings.currency), description: 'Total value of open deals.', icon: CircleDollarSign, context: REPORT_KPI_CONTEXTS.pipelineValue },
    { id: 'conversionRate' as const, label: 'Conversion Rate', value: `${reportData && reportData.totalLeads > 0 ? (reportData.convertedLeads / reportData.totalLeads * 100).toFixed(1) : 0}%`, description: 'Current converted share of Leads created in the selected period.', icon: Percent, context: REPORT_KPI_CONTEXTS.conversionRate },
  ];
  const reportMetricById = new Map(reportMetrics.map((metric) => [metric.id, metric]));
  const pipelineChartData = DEAL_STAGES.map((stage) => ({ stage, value: reportData?.pipelineByStage[stage] || 0 }));
  const outcomeChartData = [{ name: 'Won', value: reportData?.wonVsLost.won || 0 }, { name: 'Lost', value: reportData?.wonVsLost.lost || 0 }];
  const leadSourceChartData = settings.leadSources.map((source) => ({ source: source.name, count: reportData?.leadsBySource[source.name] || 0 }));

  return (
    <div className="reports-page space-y-5">
      <PageHeader title="Reports & Analytics" subtitle="Review sales performance and business activity." actions={<div className="reports-header-actions flex w-full min-w-0 items-center gap-2">
            <span className="compact-filter-field"><select aria-label="Report date range" className="border rounded-lg px-3 py-2 text-sm" value={dateRange} onChange={(e) => setDateRange(e.target.value as typeof dateRange)}>
                <option value="ThisMonth">This Month</option>
                <option value="LastMonth">Last Month</option>
                <option value="ThisQuarter">This Quarter</option>
                <option value="ThisYear">This Year</option>
            </select></span>
            <Button variant="outline" className="gap-2" onClick={requestExport} disabled={!canExportReport}><Download size={16}/> Export CSV</Button>
            <Button size="sm" variant="outline" onClick={openCustomizeKpis} className="reports-customize-action mobile-icon-only ml-auto" aria-label="Customize Cards" title="Customize Cards"><Settings2 size={16} aria-hidden="true" /><span className="mobile-button-label">Customize Cards</span></Button>
      </div>} />

      <ConfirmActionDialog open={Boolean(exportConfirmation)} title="Export report?" description={`Download report.csv with the report data for ${REPORT_DATE_RANGE_LABELS[dateRange]}?`} confirmLabel="Export CSV" onCancel={() => setPendingExport(null)} onConfirm={exportCSV} />

      {visibleError && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]">{visibleError}<Button size="sm" variant="outline" onClick={() => setReloadToken((token) => token + 1)}>Retry reports</Button></p>}
      {(!reportData && !visibleError) && <p className="text-sm text-[var(--app-muted)]">Loading organization-wide report data…</p>}

      <p className="text-xs text-[var(--app-muted)]">Workspace calendar: {settings.timezone}. {SALE_COHORT_NOTE} Open pipeline and Clients show current totals. {FINANCIAL_HISTORY_NOTE}</p>
      {reportData && <>
      <section><KpiCardGrid>{reportKpiIds.map((id, index) => { const metric = reportMetricById.get(id as ReportKpiId); if (!metric) return null; return <MovableKpiCard key={id} cardId={metric.label} order={index} onDragStart={setDraggingKpi} onDragEnd={() => setDraggingKpi(null)} onDrop={() => moveReportKpi(id)}><StandardKpiCard label={metric.label} value={metric.value} description={metric.description} context={metric.context} icon={metric.icon} /></MovableKpiCard>; })}</KpiCardGrid></section>

      {customizeKpis && <KpiCustomizationModal idPrefix="reports" ariaLabel="Customize Reports KPI cards" title="Customize Report Cards" subtitle="Choose the metrics you want to see in Reports & Analytics." draftIds={reportKpiDraft} defaultIds={REPORT_DEFAULT_KPI_IDS} options={REPORT_KPI_OPTIONS} categories={REPORT_KPI_CATEGORIES} maximum={REPORT_MAX_KPIS} onDraftChange={(ids) => setReportKpiDraft(ids)} onClose={() => setCustomizeKpis(false)} onSave={(ids) => { setReportKpiIds(ids); if (currentOrganizationId) writeKpiPreference(window.localStorage, organizationPreferenceKey(REPORT_KPI_STORAGE_KEY, currentOrganizationId), ids); setCustomizeKpis(false); }} />}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4"><h3 className="text-sm font-semibold text-[var(--app-text)]">Sales by Source</h3><div className="mt-3 grid grid-cols-3 gap-2 text-sm">{[['Walk-in', 'WALK_IN'], ['Client', 'CLIENT'], ['Deal', 'DEAL']].map(([label, key]) => <div key={key} className="rounded-lg bg-[var(--app-surface-subtle)] p-3"><p className="text-xs text-[var(--app-muted)]">{label}</p><p className="mt-1 font-bold">{reportData?.salesBySource[key as 'WALK_IN' | 'CLIENT' | 'DEAL'] || 0}</p></div>)}</div></Card>
        <Card className="p-4"><h3 className="text-sm font-semibold text-[var(--app-text)]">Sales by Payment Status</h3><div className="mt-3 grid grid-cols-3 gap-2 text-sm">{[['Paid', 'PAID'], ['Partial', 'PARTIAL'], ['Unpaid', 'UNPAID']].map(([label, key]) => <div key={key} className="rounded-lg bg-[var(--app-surface-subtle)] p-3"><p className="text-xs text-[var(--app-muted)]">{label}</p><p className="mt-1 font-bold">{reportData?.salesByPaymentStatus[key as 'PAID' | 'PARTIAL' | 'UNPAID'] || 0}</p></div>)}</div></Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--app-text)]">Deal Values: Current Pipeline and Period Outcomes</h3>
            {pipelineChartData.some((entry) => entry.value > 0) ? <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pipelineChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="stage" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#032D20" />
                </BarChart>
                </ResponsiveContainer>
            </div> : <EmptyState title="No pipeline data" description="No current open Deal value or period outcome value is available." />}
        </Card>
        <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--app-text)]">Won vs Lost Deals</h3>
            {outcomeChartData.some((entry) => entry.value > 0) ? <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={outcomeChartData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#032D20" label>
                            <Cell fill="#003B2B" />
                            <Cell fill="#B34D3E" />
                        </Pie>
                        <Tooltip />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </div> : <EmptyState title="No closed Deals" description="Won and Lost Deal results will appear here." />}
        </Card>
        <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--app-text)]">Leads by Source</h3>
            {leadSourceChartData.some((entry) => entry.count > 0) ? <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={leadSourceChartData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="source" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="count" fill="#60736A" />
                    </BarChart>
                </ResponsiveContainer>
            </div> : <EmptyState title="No lead source data" description="Lead source activity will appear here." />}
        </Card>
      </div>
      </>}
    </div>
  );
}
