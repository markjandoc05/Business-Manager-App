'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Button } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { loadReportData, type ReportData } from '@/lib/repositories/reports';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { startOfDay, startOfMonth, subMonths, startOfQuarter, startOfYear, addDays } from 'date-fns';
import { BarChart3, BriefcaseBusiness, CircleDollarSign, Download, HandCoins, Percent, ReceiptText, Target, TrendingDown, Trophy, UserCheck, Users, WalletCards } from 'lucide-react';
import { formatCurrency } from '@/lib/formatting';
import { firestoreQueryErrorMessage } from '@/lib/repositories/pagination';
import { DEAL_STAGES } from '@/lib/deal-workflow';
import { KpiCardGrid, MovableKpiCard, StandardKpiCard } from '@/components/KpiCard';
import { KpiCustomizationModal } from '@/components/KpiCustomizationModal';
import { readKpiPreference, reorderKpiIds, writeKpiPreference } from '@/lib/kpi-preferences';

type ReportKpiId = 'totalLeads' | 'clients' | 'convertedLeads' | 'activeDeals' | 'totalSales' | 'transactions' | 'amountPaid' | 'outstanding' | 'wonDeals' | 'lostDeals' | 'pipelineValue' | 'conversionRate';
const REPORT_KPIS: ReadonlyArray<{ id: ReportKpiId; label: string; description: string }> = [
  { id: 'totalLeads', label: 'Total Leads', description: 'Total number of leads recorded.' },
  { id: 'clients', label: 'Clients', description: 'Active clients currently recorded in BSM.' },
  { id: 'convertedLeads', label: 'Converted Leads', description: 'Leads converted into clients.' },
  { id: 'activeDeals', label: 'Active Deals', description: 'Deals currently in progress.' },
  { id: 'totalSales', label: 'Total Sales', description: 'Total value of active sales.' },
  { id: 'transactions', label: 'Transactions', description: 'Number of active sales recorded.' },
  { id: 'amountPaid', label: 'Amount Paid', description: 'Amount collected from active sales.' },
  { id: 'outstanding', label: 'Outstanding Balance', description: 'Remaining unpaid balance on active sales.' },
  { id: 'wonDeals', label: 'Won Deals', description: 'Deals successfully closed as won.' },
  { id: 'lostDeals', label: 'Lost Deals', description: 'Deals marked as lost.' },
  { id: 'pipelineValue', label: 'Pipeline Value', description: 'Total value of open deals.' },
  { id: 'conversionRate', label: 'Conversion Rate', description: 'Percentage of leads that converted.' },
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
  totalSales: 'Recorded sales value', transactions: 'Sales transactions', amountPaid: 'Amount collected', outstanding: 'Unpaid balance',
  wonDeals: 'Successfully closed', lostDeals: 'Marked as lost', pipelineValue: 'Open Deal value', conversionRate: 'Lead conversion rate',
};
const REPORT_KPI_OPTIONS = REPORT_KPIS.map((metric) => ({ ...metric, context: REPORT_KPI_CONTEXTS[metric.id] }));
const REPORT_KPI_CATEGORIES = [
  { id: 'sales', label: 'Sales', description: 'Recorded sales, collections, and balances', optionIds: ['totalSales', 'transactions', 'amountPaid', 'outstanding'] },
  { id: 'leads-clients', label: 'Leads & Clients', description: 'Customer growth and conversion activity', optionIds: ['totalLeads', 'clients', 'convertedLeads', 'conversionRate'] },
  { id: 'deals', label: 'Deals & Pipeline', description: 'Opportunity outcomes and pipeline value', optionIds: ['activeDeals', 'wonDeals', 'lostDeals', 'pipelineValue'] },
] as const;

export default function ReportsPage() {
  const { settings } = useApp();
  const { user } = useAuth();
  const { currentOrganizationId, ready: workspaceReady } = useWorkspace();
  const [dateRange, setDateRange] = useState<'ThisMonth' | 'LastMonth' | 'ThisQuarter' | 'ThisYear'>('ThisMonth');
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportKpiIds, setReportKpiIds] = useState<string[]>([...REPORT_DEFAULT_KPI_IDS]);
  const [reportKpiDraft, setReportKpiDraft] = useState<string[]>([...REPORT_DEFAULT_KPI_IDS]);
  const [customizeKpis, setCustomizeKpis] = useState(false);
  const [draggingKpi, setDraggingKpi] = useState<string | null>(null);

  useEffect(() => { setReportKpiIds(readKpiPreference(window.localStorage, REPORT_KPI_STORAGE_KEY, REPORT_DEFAULT_KPI_IDS, REPORT_KPIS.map((metric) => metric.id), REPORT_MIN_KPIS, REPORT_MAX_KPIS)); }, []);

  const range = useMemo(() => {
    const now = new Date();
    let startDate: Date;
    let endDate = startOfDay(addDays(now, 1));
    switch (dateRange) {
      case 'LastMonth': startDate = startOfMonth(subMonths(now, 1)); endDate = startOfMonth(now); break;
      case 'ThisQuarter': startDate = startOfQuarter(now); break;
      case 'ThisYear': startDate = startOfYear(now); break;
      default: startDate = startOfMonth(now); break;
    }
    return { startDate, endDate };
  }, [dateRange]);

  useEffect(() => {
    let cancelled = false;
    if (!user || !workspaceReady || !currentOrganizationId) return () => { cancelled = true; };
    setLoading(true);
    setError(null);
    void loadReportData(user, currentOrganizationId, range.startDate, range.endDate, [...DEAL_STAGES], settings.leadSources.map((source) => source.name))
      .then((data) => { if (!cancelled) setReportData(data); })
      .catch((loadError) => { console.error('Unable to load report data', loadError); if (!cancelled) setError(firestoreQueryErrorMessage(loadError, 'Unable to load reports. Please try again.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentOrganizationId, range, settings.leadSources, user, workspaceReady]);

  const exportCSV = () => {
    const csvContent = "data:text/csv;charset=utf-8," +
      "Metric,Value\n" +
      `Total Leads,${reportData?.totalLeads || 0}\n` +
      `Clients,${reportData?.clients || 0}\n` +
      `Converted Leads,${reportData?.convertedLeads || 0}\n` +
      `Active Deals,${reportData?.activeDeals || 0}\n` +
      `Won Deals,${reportData?.wonDeals || 0}\n` +
      `Lost Deals,${reportData?.lostDeals || 0}\n` +
      `Total Sales,${reportData?.totalSales || 0}\n` +
      `Transactions,${reportData?.transactions || 0}\n` +
      `Amount Paid,${reportData?.amountPaid || 0}\n` +
      `Outstanding,${reportData?.outstanding || 0}\n` +
      `Pipeline Value,${reportData?.pipelineValue || 0}`;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "report.csv");
    document.body.appendChild(link);
    link.click();
  };

  const openCustomizeKpis = () => { setReportKpiDraft([...reportKpiIds]); setCustomizeKpis(true); };
  const moveReportKpi = (targetId: string) => { if (!draggingKpi || draggingKpi === targetId) return; setReportKpiIds((current) => { const next = reorderKpiIds(current, draggingKpi, targetId); writeKpiPreference(window.localStorage, REPORT_KPI_STORAGE_KEY, next); return next; }); };
  const reportMetrics = [
    { id: 'totalLeads' as const, label: 'Total Leads', value: reportData?.totalLeads || 0, description: 'Total number of leads recorded.', icon: Users, context: REPORT_KPI_CONTEXTS.totalLeads },
    { id: 'clients' as const, label: 'Clients', value: reportData?.clients || 0, description: 'Active clients currently recorded in BSM.', icon: UserCheck, context: REPORT_KPI_CONTEXTS.clients },
    { id: 'convertedLeads' as const, label: 'Converted Leads', value: reportData?.convertedLeads || 0, description: 'Leads converted into clients.', icon: Target, context: REPORT_KPI_CONTEXTS.convertedLeads },
    { id: 'activeDeals' as const, label: 'Active Deals', value: reportData?.activeDeals || 0, description: 'Deals currently in progress.', icon: BriefcaseBusiness, context: REPORT_KPI_CONTEXTS.activeDeals },
    { id: 'totalSales' as const, label: 'Total Sales', value: formatCurrency(reportData?.totalSales || 0, settings.currency), description: 'Total value of active sales.', icon: ReceiptText, context: REPORT_KPI_CONTEXTS.totalSales },
    { id: 'transactions' as const, label: 'Transactions', value: reportData?.transactions || 0, description: 'Number of active sales recorded.', icon: BarChart3, context: REPORT_KPI_CONTEXTS.transactions },
    { id: 'amountPaid' as const, label: 'Amount Paid', value: formatCurrency(reportData?.amountPaid || 0, settings.currency), description: 'Amount collected from active sales.', icon: HandCoins, context: REPORT_KPI_CONTEXTS.amountPaid },
    { id: 'outstanding' as const, label: 'Outstanding Balance', value: formatCurrency(reportData?.outstanding || 0, settings.currency), description: 'Remaining unpaid balance on active sales.', icon: WalletCards, context: REPORT_KPI_CONTEXTS.outstanding },
    { id: 'wonDeals' as const, label: 'Won Deals', value: reportData?.wonDeals || 0, description: 'Deals successfully closed as won.', icon: Trophy, context: REPORT_KPI_CONTEXTS.wonDeals },
    { id: 'lostDeals' as const, label: 'Lost Deals', value: reportData?.lostDeals || 0, description: 'Deals marked as lost.', icon: TrendingDown, context: REPORT_KPI_CONTEXTS.lostDeals },
    { id: 'pipelineValue' as const, label: 'Pipeline Value', value: formatCurrency(reportData?.pipelineValue || 0, settings.currency), description: 'Total value of open deals.', icon: CircleDollarSign, context: REPORT_KPI_CONTEXTS.pipelineValue },
    { id: 'conversionRate' as const, label: 'Conversion Rate', value: `${reportData && reportData.totalLeads > 0 ? (reportData.convertedLeads / reportData.totalLeads * 100).toFixed(1) : 0}%`, description: 'Percentage of leads that converted.', icon: Percent, context: REPORT_KPI_CONTEXTS.conversionRate },
  ];
  const reportMetricById = new Map(reportMetrics.map((metric) => [metric.id, metric]));

  return (
    <div className="space-y-5">
      <PageHeader title="Reports & Analytics" subtitle="Review sales performance and business activity." actions={<>
            <select className="border rounded-lg px-3 py-2 text-sm" value={dateRange} onChange={(e) => setDateRange(e.target.value as any)}>
                <option value="ThisMonth">This Month</option>
                <option value="LastMonth">Last Month</option>
                <option value="ThisQuarter">This Quarter</option>
                <option value="ThisYear">This Year</option>
            </select>
            <Button variant="outline" className="gap-2" onClick={exportCSV}><Download size={16}/> Export CSV</Button>
      </>} />

      {error && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-3 text-sm text-[var(--app-danger)]">{error}</p>}
      {loading && <p className="text-sm text-[var(--app-muted)]">Loading organization-wide report data…</p>}

      <section><div className="mb-2 flex justify-end"><Button size="sm" variant="outline" onClick={openCustomizeKpis}>Customize Cards</Button></div><KpiCardGrid>{reportKpiIds.map((id, index) => { const metric = reportMetricById.get(id as ReportKpiId); if (!metric) return null; return <MovableKpiCard key={id} cardId={metric.label} order={index} onDragStart={setDraggingKpi} onDragEnd={() => setDraggingKpi(null)} onDrop={() => moveReportKpi(id)}><StandardKpiCard label={metric.label} value={metric.value} description={metric.description} context={metric.context} icon={metric.icon} /></MovableKpiCard>; })}</KpiCardGrid></section>

      {customizeKpis && <KpiCustomizationModal idPrefix="reports" ariaLabel="Customize Reports KPI cards" title="Customize Report Cards" subtitle="Choose the metrics you want to see in Reports & Analytics." draftIds={reportKpiDraft} defaultIds={REPORT_DEFAULT_KPI_IDS} options={REPORT_KPI_OPTIONS} categories={REPORT_KPI_CATEGORIES} maximum={REPORT_MAX_KPIS} onDraftChange={(ids) => setReportKpiDraft(ids)} onClose={() => setCustomizeKpis(false)} onSave={(ids) => { setReportKpiIds(ids); writeKpiPreference(window.localStorage, REPORT_KPI_STORAGE_KEY, ids); setCustomizeKpis(false); }} />}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4"><h3 className="text-sm font-semibold text-[var(--app-text)]">Sales by Source</h3><div className="mt-3 grid grid-cols-3 gap-2 text-sm">{[['Walk-in', 'WALK_IN'], ['Client', 'CLIENT'], ['Deal', 'DEAL']].map(([label, key]) => <div key={key} className="rounded-lg bg-[var(--app-surface-subtle)] p-3"><p className="text-xs text-[var(--app-muted)]">{label}</p><p className="mt-1 font-bold">{reportData?.salesBySource[key as 'WALK_IN' | 'CLIENT' | 'DEAL'] || 0}</p></div>)}</div></Card>
        <Card className="p-4"><h3 className="text-sm font-semibold text-[var(--app-text)]">Sales by Payment Status</h3><div className="mt-3 grid grid-cols-3 gap-2 text-sm">{[['Paid', 'PAID'], ['Partial', 'PARTIAL'], ['Unpaid', 'UNPAID']].map(([label, key]) => <div key={key} className="rounded-lg bg-[var(--app-surface-subtle)] p-3"><p className="text-xs text-[var(--app-muted)]">{label}</p><p className="mt-1 font-bold">{reportData?.salesByPaymentStatus[key as 'PAID' | 'PARTIAL' | 'UNPAID'] || 0}</p></div>)}</div></Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--app-text)]">Pipeline Performance (Value)</h3>
            <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                <BarChart data={DEAL_STAGES.map(stage => ({stage, value: reportData?.pipelineByStage[stage] || 0}))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="stage" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#032D20" />
                </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
        <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--app-text)]">Won vs Lost Deals</h3>
            <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={[{name: 'Won', value: reportData?.wonVsLost.won || 0}, {name: 'Lost', value: reportData?.wonVsLost.lost || 0}]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#032D20" label>
                            <Cell fill="#003B2B" />
                            <Cell fill="#B34D3E" />
                        </Pie>
                        <Tooltip />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </Card>
        <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-[var(--app-text)]">Leads by Source</h3>
            <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={settings.leadSources.map(s => ({source: s.name, count: reportData?.leadsBySource[s.name] || 0}))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="source" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="count" fill="#60736A" />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
      </div>
    </div>
  );
}
