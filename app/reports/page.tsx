'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Card, Button } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { loadReportData, type ReportData } from '@/lib/repositories/reports';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { startOfMonth, subMonths, startOfQuarter, startOfYear, isWithinInterval, parseISO } from 'date-fns';
import { Download } from 'lucide-react';
import { formatCurrency } from '@/lib/formatting';
import { firestoreQueryErrorMessage } from '@/lib/repositories/pagination';
import { DEAL_STAGES } from '@/lib/deal-workflow';

export default function ReportsPage() {
  const { settings } = useApp();
  const { user } = useAuth();
  const { currentOrganizationId, ready: workspaceReady } = useWorkspace();
  const [dateRange, setDateRange] = useState<'ThisMonth' | 'LastMonth' | 'ThisQuarter' | 'ThisYear'>('ThisMonth');
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    const now = new Date();
    let startDate: Date;
    let endDate = new Date(now.getTime() + 1);
    switch (dateRange) {
      case 'LastMonth': startDate = startOfMonth(subMonths(now, 1)); endDate = startOfMonth(now); break;
      case 'ThisQuarter': startDate = startOfQuarter(now); break;
      case 'ThisYear': startDate = startOfYear(now); break;
      default: startDate = startOfMonth(now); break;
    }
    return { startDate, endDate };
  }, [dateRange]);

  /* eslint-disable react-hooks/set-state-in-effect */
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
  /* eslint-enable react-hooks/set-state-in-effect */

  const exportCSV = () => {
    const csvContent = "data:text/csv;charset=utf-8," + 
      "Metric,Value\n" +
      `Total Leads,${reportData?.totalLeads || 0}\n` +
      `Won Sales,${reportData?.totalWonSales || 0}\n` +
      `Pipeline Value,${reportData?.pipelineValue || 0}`;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "report.csv");
    document.body.appendChild(link);
    link.click();
  };

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

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-slate-500">Loading organization-wide report data…</p>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card className="p-3.5"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Total Leads</p><p className="mt-1 text-xl font-semibold text-slate-900">{reportData?.totalLeads || 0}</p></Card>
        <Card className="p-3.5"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Won Sales</p><p className="mt-1 text-xl font-semibold text-slate-900">{formatCurrency(reportData?.totalWonSales || 0, settings.currency)}</p></Card>
        <Card className="p-3.5"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Pipeline Value</p><p className="mt-1 text-xl font-semibold text-slate-900">{formatCurrency(reportData?.pipelineValue || 0, settings.currency)}</p></Card>
        <Card className="p-3.5"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Conversion Rate</p><p className="mt-1 text-xl font-semibold text-slate-900">{reportData && reportData.totalLeads > 0 ? (reportData.wonDeals / reportData.totalLeads * 100).toFixed(1) : 0}%</p></Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Pipeline Performance (Value)</h3>
            <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                <BarChart data={DEAL_STAGES.map(stage => ({stage, value: reportData?.pipelineByStage[stage] || 0}))}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="stage" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#3b82f6" />
                </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
        <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Won vs Lost Deals</h3>
            <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie data={[{name: 'Won', value: reportData?.wonVsLost.won || 0}, {name: 'Lost', value: reportData?.wonVsLost.lost || 0}]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#8884d8" label>
                            <Cell fill="#22c55e" />
                            <Cell fill="#ef4444" />
                        </Pie>
                        <Tooltip />
                        <Legend />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </Card>
        <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Leads by Source</h3>
            <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={settings.leadSources.map(s => ({source: s.name, count: reportData?.leadsBySource[s.name] || 0}))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="source" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="count" fill="#8b5cf6" />
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </Card>
      </div>
    </div>
  );
}
