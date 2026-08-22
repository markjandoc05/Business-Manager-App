'use client';

import React, { useState, useMemo } from 'react';
import { Card, Button } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { useApp } from '@/context/AppContext';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { startOfMonth, subMonths, startOfQuarter, startOfYear, isWithinInterval, parseISO } from 'date-fns';
import { Download } from 'lucide-react';
import { formatCurrency } from '@/lib/formatting';

export default function ReportsPage() {
  const { leads, deals, settings } = useApp();
  const [dateRange, setDateRange] = useState<'ThisMonth' | 'LastMonth' | 'ThisQuarter' | 'ThisYear'>('ThisMonth');

  const filteredData = useMemo(() => {
    const now = new Date();
    let startDate: Date;
    switch (dateRange) {
      case 'LastMonth': startDate = startOfMonth(subMonths(now, 1)); break;
      case 'ThisQuarter': startDate = startOfQuarter(now); break;
      case 'ThisYear': startDate = startOfYear(now); break;
      default: startDate = startOfMonth(now); break;
    }

    const filterByDate = (item: { createdAt: string }) => parseISO(item.createdAt) >= startDate;
    return {
      leads: leads.filter(filterByDate),
      deals: deals.filter(filterByDate),
    };
  }, [dateRange, leads, deals]);

  const KPIs = useMemo(() => {
    const wonDeals = filteredData.deals.filter(d => d.status === 'Won');
    const lostDeals = filteredData.deals.filter(d => d.status === 'Lost');
    const activeDeals = filteredData.deals.filter(d => d.status === 'Active');
    
    return {
      totalLeads: filteredData.leads.length,
      qualifiedLeads: filteredData.leads.filter(l => l.status === 'Opportunity' || l.status === 'Client').length,
      wonDeals: wonDeals.length,
      lostDeals: lostDeals.length,
      pipelineValue: activeDeals.reduce((sum, d) => sum + d.value, 0),
      totalWonSales: wonDeals.reduce((sum, d) => sum + d.value, 0),
    };
  }, [filteredData]);

  const exportCSV = () => {
    const csvContent = "data:text/csv;charset=utf-8," + 
      "Metric,Value\n" +
      `Total Leads,${KPIs.totalLeads}\n` +
      `Won Sales,${KPIs.totalWonSales}\n` +
      `Pipeline Value,${KPIs.pipelineValue}`;
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

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Card className="p-3.5"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Total Leads</p><p className="mt-1 text-xl font-semibold text-slate-900">{KPIs.totalLeads}</p></Card>
        <Card className="p-3.5"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Won Sales</p><p className="mt-1 text-xl font-semibold text-slate-900">{formatCurrency(KPIs.totalWonSales, settings.currency)}</p></Card>
        <Card className="p-3.5"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Pipeline Value</p><p className="mt-1 text-xl font-semibold text-slate-900">{formatCurrency(KPIs.pipelineValue, settings.currency)}</p></Card>
        <Card className="p-3.5"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">Conversion Rate</p><p className="mt-1 text-xl font-semibold text-slate-900">{(KPIs.totalLeads > 0 ? (KPIs.wonDeals / KPIs.totalLeads * 100).toFixed(1) : 0)}%</p></Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Pipeline Performance (Value)</h3>
            <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                <BarChart data={settings.pipelineStages.map(stage => ({stage: stage.name, value: filteredData.deals.filter(d => d.stage === stage.name).reduce((sum, d) => sum + d.value, 0)}))}>
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
                        <Pie data={[{name: 'Won', value: KPIs.wonDeals}, {name: 'Lost', value: KPIs.lostDeals}]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#8884d8" label>
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
                    <BarChart data={settings.leadSources.map(s => ({source: s.name, count: filteredData.leads.filter(l => l.source === s.name).length}))}>
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
