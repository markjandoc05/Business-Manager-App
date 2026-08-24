'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, Button, Badge } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { useApp } from '@/context/AppContext';
import { 
  Users, 
  TrendingUp, 
  Clock, 
  Check,
  CheckCircle2, 
  DollarSign, 
  Briefcase, 
  Plus,
  Calendar, 
  ArrowRight,
  X,
  GripVertical
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '@/lib/utils';
import { formatCurrency, formatCurrencyParts } from '@/lib/formatting';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { canManageLeads } from '@/lib/permissions';
import { formatCompactDateTime, isFollowUpTask } from '@/lib/task-utils';
import { PipelineFunnel } from '@/components/PipelineFunnel';
import { getDashboardLeadTotal, loadDashboardMetrics, type DashboardMetrics } from '@/lib/repositories/dashboard';
import { IconActionButton } from '@/components/IconActionButton';
import { isToday } from 'date-fns';

type DashboardFollowUpItem =
  | { id: string; source: 'LEAD' | 'CLIENT' | 'DEAL' | 'TASK'; relatedName: string; title: string; description?: string; scheduledAt: string; state: 'SCHEDULED' | 'OVERDUE'; taskId: string; priority: 'Low' | 'Medium' | 'High' };

type PrimaryDashboardCard = 'pipeline' | 'followups';
type SecondaryDashboardCard = 'leads' | 'activity';
type KpiDashboardCard = 'leadsKpi' | 'openDealsKpi' | 'followupsKpi' | 'wonDealsKpi' | 'potentialSalesKpi' | 'salesMonthKpi';
const DASHBOARD_LAYOUT_KEY = 'bsm_dashboard_card_layout';
const DEFAULT_DASHBOARD_LAYOUT = { kpis: ['leadsKpi', 'openDealsKpi', 'followupsKpi', 'wonDealsKpi', 'potentialSalesKpi', 'salesMonthKpi'] as KpiDashboardCard[], primary: ['pipeline', 'followups'] as PrimaryDashboardCard[], secondary: ['leads', 'activity'] as SecondaryDashboardCard[] };

function DashboardCurrencyValue({ value, currency }: { value: number; currency: string }) {
  const parts = formatCurrencyParts(value, currency);
  return <span className="mt-3 inline-flex whitespace-nowrap text-[28px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
    <span>{parts.beforeDecimal}</span>
    {parts.decimal && <span className="text-[18px] font-semibold align-baseline">{parts.decimal}</span>}
    {parts.afterDecimal && <span>{parts.afterDecimal}</span>}
  </span>;
}

function getDashboardLayoutPreference() {
  if (typeof window === 'undefined') return DEFAULT_DASHBOARD_LAYOUT;
  try {
    const saved = JSON.parse(window.localStorage.getItem(DASHBOARD_LAYOUT_KEY) || '{}') as { kpis?: KpiDashboardCard[]; primary?: PrimaryDashboardCard[]; secondary?: SecondaryDashboardCard[] };
    return {
      kpis: saved.kpis?.length === 6 && DEFAULT_DASHBOARD_LAYOUT.kpis.every((card) => saved.kpis?.includes(card)) ? saved.kpis : DEFAULT_DASHBOARD_LAYOUT.kpis,
      primary: saved.primary?.length === 2 && saved.primary.includes('pipeline') && saved.primary.includes('followups') ? saved.primary : DEFAULT_DASHBOARD_LAYOUT.primary,
      secondary: saved.secondary?.length === 2 && saved.secondary.includes('leads') && saved.secondary.includes('activity') ? saved.secondary : DEFAULT_DASHBOARD_LAYOUT.secondary,
    };
  } catch {
    return DEFAULT_DASHBOARD_LAYOUT;
  }
}

export default function DashboardPage() {
  const { leads, clients, deals, tasks, activities, settings, completeTask, addLead, addClient, addTask } = useApp();
  const router = useRouter();
  const { user } = useAuth();
  const { currentOrganizationId, loading: workspaceLoading, ready: workspaceReady, membership, canWrite } = useWorkspace();
  const canManage = canManageLeads(membership) && canWrite;
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [primaryCardOrder, setPrimaryCardOrder] = useState<PrimaryDashboardCard[]>(() => getDashboardLayoutPreference().primary);
  const [secondaryCardOrder, setSecondaryCardOrder] = useState<SecondaryDashboardCard[]>(() => getDashboardLayoutPreference().secondary);
  const [kpiCardOrder, setKpiCardOrder] = useState<KpiDashboardCard[]>(() => getDashboardLayoutPreference().kpis);
  const [draggingCard, setDraggingCard] = useState<string | null>(null);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify({ kpis: kpiCardOrder, primary: primaryCardOrder, secondary: secondaryCardOrder }));
  }, [kpiCardOrder, primaryCardOrder, secondaryCardOrder]);

  useEffect(() => {
    let cancelled = false;
    if (!user || !workspaceReady || !currentOrganizationId || workspaceLoading) {
      setDashboardMetrics(null);
      return () => { cancelled = true; };
    }
    void loadDashboardMetrics(user, currentOrganizationId).then((metrics) => {
      if (!cancelled) setDashboardMetrics(metrics);
    }).catch((error) => {
      console.error('Unable to load dashboard metrics', error);
      if (!cancelled) setDashboardMetrics(null);
    });
    return () => { cancelled = true; };
  }, [currentOrganizationId, user, workspaceLoading, workspaceReady]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const moveDashboardCard = (target: string, group: 'kpis' | 'primary' | 'secondary') => {
    if (!draggingCard || draggingCard === target) return;
    if (group === 'kpis') {
      setKpiCardOrder((current) => reorderCards(current, draggingCard as KpiDashboardCard, target as KpiDashboardCard));
    } else if (group === 'primary') {
      setPrimaryCardOrder((current) => reorderCards(current, draggingCard as PrimaryDashboardCard, target as PrimaryDashboardCard));
    } else {
      setSecondaryCardOrder((current) => reorderCards(current, draggingCard as SecondaryDashboardCard, target as SecondaryDashboardCard));
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Modals state
  const [activeModal, setActiveModal] = useState<'lead' | 'client' | 'task' | null>(null);

  // Form states
  const [leadForm, setLeadForm] = useState({ name: '', email: '', phone: '', company: '', source: settings.leadSources[0]?.name || 'Website' });
  const [clientForm, setClientForm] = useState({ name: '', email: '', phone: '', company: '' });
  const [taskForm, setTaskForm] = useState({ title: '', description: '', dueDate: '', priority: 'Medium' as 'Low' | 'Medium' | 'High' });
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [leadSaving, setLeadSaving] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);

  const handleCompleteDashboardTask = async (taskId: string) => {
    if (!canWrite || completingTaskId === taskId) return;
    setCompletingTaskId(taskId);
    try {
      await completeTask(taskId);
    } finally {
      setCompletingTaskId(null);
    }
  };

  // KPI Calculations
  const totalLeads = getDashboardLeadTotal(dashboardMetrics);
  const openDealStages = new Set(['New', 'Qualified', 'Proposal', 'Negotiation']);
  const openDeals = deals.filter((deal) => openDealStages.has(deal.stage));
  const activeOpportunities = dashboardMetrics?.activeDeals ?? openDeals.length;
  const wonDealsCount = dashboardMetrics?.wonDeals ?? deals.filter(d => d.status === 'Won').length;
  const pipelineValue = dashboardMetrics?.pipelineValue ?? openDeals.reduce((sum, d) => sum + d.value, 0);

  const currentDate = new Date();
  const salesThisMonthFromLoadedDeals = deals
    .filter((deal) => {
      if (deal.status !== 'Won') return false;
      const createdAt = new Date(deal.createdAt);
      return !Number.isNaN(createdAt.getTime())
        && createdAt.getFullYear() === currentDate.getFullYear()
        && createdAt.getMonth() === currentDate.getMonth();
    })
    .reduce((sum, deal) => sum + deal.value, 0);
  const salesThisMonth = dashboardMetrics?.salesThisMonth ?? salesThisMonthFromLoadedDeals;

  const followUpItems = useMemo<DashboardFollowUpItem[]>(() => {
    const now = currentTime;
    const taskItems: DashboardFollowUpItem[] = tasks
      .filter((task) => isFollowUpTask(task) && task.status === 'Pending' && !task.archived && Number.isFinite(Date.parse(task.dueDate)))
      .map((task) => {
        const scheduledAt = task.dueDate;
        const source = task.relatedTo?.type === 'Client' || task.relatedTo?.type === 'Deal' || task.relatedTo?.type === 'Lead'
          ? task.relatedTo.type.toUpperCase() as 'LEAD' | 'CLIENT' | 'DEAL'
          : 'TASK';
        const relatedName = source === 'CLIENT'
          ? clients.find((client) => client.id === task.relatedTo?.id)?.name || 'Client'
          : source === 'DEAL'
            ? deals.find((deal) => deal.id === task.relatedTo?.id)?.title || 'Deal'
            : source === 'LEAD'
              ? leads.find((lead) => lead.id === task.relatedTo?.id)?.name || 'Lead'
              : 'Task';
        return {
          id: `task:${task.id}`,
          source,
          relatedName,
          title: task.title,
          description: task.description,
          scheduledAt,
          state: Date.parse(scheduledAt) <= now ? 'OVERDUE' : 'SCHEDULED',
          taskId: task.id,
          priority: task.priority,
        };
      });
    return taskItems.sort((left, right) => {
      const leftTime = Date.parse(left.scheduledAt);
      const rightTime = Date.parse(right.scheduledAt);
      if (left.state !== right.state) return left.state === 'OVERDUE' ? -1 : 1;
      return left.state === 'OVERDUE' ? leftTime - rightTime : leftTime - rightTime;
    });
  }, [clients, currentTime, deals, leads, tasks]);

  const openLead = (leadId: string) => router.push(`/leads?leadId=${encodeURIComponent(leadId)}`);
  const openFollowUp = (item: DashboardFollowUpItem) => {
    const task = tasks.find((candidate) => candidate.id === item.taskId);
    if (!task) return;
    const related = task.relatedTo;
    if (related?.type === 'Client') {
      router.push(`/clients?clientId=${encodeURIComponent(related.id)}&tab=tasks`);
    } else if (related?.type === 'Deal') {
      router.push(`/pipeline?dealId=${encodeURIComponent(related.id)}`);
    } else if (related?.type === 'Lead') {
      openLead(related.id);
    } else {
      router.push(`/tasks?taskId=${encodeURIComponent(task.id)}`);
    }
  };

  const followUpsDue = followUpItems.length;
  const sourceBadgeVariant = (source: DashboardFollowUpItem['source']) => source === 'LEAD' ? 'blue' : source === 'CLIENT' ? 'green' : source === 'DEAL' ? 'purple' : 'gray';

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadForm.name || !leadForm.email) return;
    if (workspaceLoading) {
      setLeadError('Workspace is still loading. Please wait a moment and try again.');
      return;
    }
    if (!workspaceReady) {
      setLeadError('No active organization is available. Please contact an administrator.');
      return;
    }
    setLeadSaving(true);
    setLeadError(null);
    try {
      await addLead({
        name: leadForm.name,
        email: leadForm.email,
        phone: leadForm.phone,
        company: leadForm.company,
        source: leadForm.source,
      });
      setLeadForm({ name: '', email: '', phone: '', company: '', source: settings.leadSources[0]?.name || 'Website' });
      setActiveModal(null);
    } catch (error) {
      console.error('Unable to create dashboard lead', error);
      setLeadError(error instanceof Error ? error.message : 'Unable to save the lead. Please try again.');
    } finally {
      setLeadSaving(false);
    }
  };

  const handleCreateClient = (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientForm.name || !clientForm.email) return;
    addClient({
      name: clientForm.name,
      email: clientForm.email,
      phone: clientForm.phone,
      company: clientForm.company,
    });
    setClientForm({ name: '', email: '', phone: '', company: '' });
    setActiveModal(null);
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskForm.title) return;
    addTask({
      title: taskForm.title,
      description: taskForm.description,
      type: 'Follow-up',
      dueDate: taskForm.dueDate || new Date().toISOString().split('T')[0],
      priority: taskForm.priority,
    });
    setTaskForm({ title: '', description: '', dueDate: '', priority: 'Medium' });
    setActiveModal(null);
  };

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Dashboard"
        subtitle="Overview of your sales, follow-ups, and activity."
        actions={<>
          {canManage && <Button disabled={!workspaceReady} onClick={() => { setLeadError(null); setActiveModal('lead'); }} className="gap-2"><Plus size={16} /> Add Lead</Button>}
          <Button variant="outline" onClick={() => setActiveModal('client')} className="gap-2"><Plus size={16} /> Add Client</Button>
          <Button variant="outline" onClick={() => setActiveModal('task')} className="gap-2"><Plus size={16} /> Add Task</Button>
        </>}
      />

      {/* KPI Cards Grid (6 cards required) */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="grid min-w-[1120px] grid-cols-6 gap-3">
        <MovableDashboardCard cardId="leadsKpi" order={kpiCardOrder.indexOf('leadsKpi')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('leadsKpi', 'kpis')}>
        <Card className="flex h-full min-h-[128px] flex-col rounded-[14px] p-3.5 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_6px_16px_rgba(15,23,42,0.08)] sm:p-4">
          <div className="flex items-center gap-2 pr-8 text-xs font-semibold text-slate-500"><span className="rounded-md bg-blue-50 p-1 text-blue-600"><Users size={14} /></span><span>Leads</span></div>
          <span className="mt-3 whitespace-nowrap text-[28px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">{totalLeads}</span>
          <p className="mt-2 min-h-[1.25rem] truncate text-xs text-slate-500">Potential customers</p>
        </Card>
        </MovableDashboardCard>

        <MovableDashboardCard cardId="openDealsKpi" order={kpiCardOrder.indexOf('openDealsKpi')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('openDealsKpi', 'kpis')}>
        <Card className="flex h-full min-h-[128px] flex-col rounded-[14px] p-3.5 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_6px_16px_rgba(15,23,42,0.08)] sm:p-4">
          <div className="flex items-center gap-2 pr-8 text-xs font-semibold text-slate-500"><span className="rounded-md bg-indigo-50 p-1 text-indigo-600"><TrendingUp size={14} /></span><span>Open Deals</span></div>
          <span className="mt-3 whitespace-nowrap text-[28px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">{activeOpportunities}</span>
          <p className="mt-2 min-h-[1.25rem] truncate text-xs text-slate-500">Deals currently in progress</p>
        </Card>
        </MovableDashboardCard>

        <MovableDashboardCard cardId="followupsKpi" order={kpiCardOrder.indexOf('followupsKpi')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('followupsKpi', 'kpis')}>
        <Card className="flex h-full min-h-[128px] flex-col rounded-[14px] p-3.5 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_6px_16px_rgba(15,23,42,0.08)] sm:p-4">
          <div className="flex items-center gap-2 pr-8 text-xs font-semibold text-slate-500"><span className="rounded-md bg-orange-50 p-1 text-orange-600"><Clock size={14} /></span><span>Follow-ups Due</span></div>
          <span className="mt-3 whitespace-nowrap text-[28px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">{followUpsDue}</span>
          <p className="mt-2 min-h-[1.25rem] truncate text-xs text-slate-500">Tasks needing your attention</p>
        </Card>
        </MovableDashboardCard>

        <MovableDashboardCard cardId="wonDealsKpi" order={kpiCardOrder.indexOf('wonDealsKpi')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('wonDealsKpi', 'kpis')}>
        <Card className="flex h-full min-h-[128px] flex-col rounded-[14px] p-3.5 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_6px_16px_rgba(15,23,42,0.08)] sm:p-4">
          <div className="flex items-center gap-2 pr-8 text-xs font-semibold text-slate-500"><span className="rounded-md bg-green-50 p-1 text-green-600"><CheckCircle2 size={14} /></span><span>Won Deals</span></div>
          <span className="mt-3 whitespace-nowrap text-[28px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">{wonDealsCount}</span>
          <p className="mt-2 min-h-[1.25rem] truncate text-xs text-slate-500">Successfully closed deals</p>
        </Card>
        </MovableDashboardCard>

        <MovableDashboardCard cardId="potentialSalesKpi" order={kpiCardOrder.indexOf('potentialSalesKpi')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('potentialSalesKpi', 'kpis')}>
        <Card className="flex h-full min-h-[128px] flex-col rounded-[14px] p-3.5 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_6px_16px_rgba(15,23,42,0.08)] sm:p-4">
          <div className="flex items-center gap-2 pr-8 text-xs font-semibold text-slate-500"><span className="rounded-md bg-purple-50 p-1 text-purple-600"><DollarSign size={14} /></span><span>Potential Sales</span></div>
          <DashboardCurrencyValue value={pipelineValue} currency={settings.currency} />
          <p className="mt-2 min-h-[1.25rem] truncate text-xs text-slate-500">Total value of open deals</p>
        </Card>
        </MovableDashboardCard>

        <MovableDashboardCard cardId="salesMonthKpi" order={kpiCardOrder.indexOf('salesMonthKpi')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('salesMonthKpi', 'kpis')}>
        <Card className="flex h-full min-h-[128px] flex-col rounded-[14px] p-3.5 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_6px_16px_rgba(15,23,42,0.08)] sm:p-4">
          <div className="flex items-center gap-2 pr-8 text-xs font-semibold text-slate-500"><span className="rounded-md bg-blue-50 p-1 text-blue-600"><Briefcase size={14} /></span><span>Sales This Month</span></div>
          <DashboardCurrencyValue value={salesThisMonth} currency={settings.currency} />
          <p className="mt-2 min-h-[1.25rem] truncate text-xs text-slate-500">Sales closed this month</p>
        </Card>
        </MovableDashboardCard>
        </div>
      </div>

      {/* Main Grid: Follow-ups Due & Pipeline Overview */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <MovableDashboardCard cardId="pipeline" order={primaryCardOrder.indexOf('pipeline')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('pipeline', 'primary')}>
          <PipelineFunnel deals={deals} currency={settings.currency} stageSummary={dashboardMetrics?.pipelineByStage} />
        </MovableDashboardCard>

        {/* Follow-ups Due */}
        <MovableDashboardCard cardId="followups" order={primaryCardOrder.indexOf('followups')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('followups', 'primary')}>
        <Card className="flex h-full flex-col space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Follow-ups &amp; Tasks</h3>
              <p className="text-xs text-slate-500">Upcoming and overdue actions</p>
            </div>
            <Badge variant="gray">{followUpItems.length} open</Badge>
          </div>

          <div className="max-h-[350px] flex-1 space-y-3 overflow-y-auto">
            {followUpItems.map((item) => (
              <div key={item.id} role="button" tabIndex={0} onClick={() => openFollowUp(item)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFollowUp(item); } }} className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border-b border-slate-100 p-3 transition-colors duration-150 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 last:border-b-0">
                <div className="w-full min-w-0 flex-1 space-y-1 text-left">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Badge variant={sourceBadgeVariant(item.source)}>{item.source}</Badge>
                      <Badge variant={item.state === 'OVERDUE' ? 'red' : 'blue'}>{item.state === 'OVERDUE' ? 'OVERDUE' : isToday(new Date(item.scheduledAt)) ? 'DUE TODAY' : 'SCHEDULED'}</Badge>
                      <span className="truncate text-xs font-medium text-slate-700">{item.relatedName}</span>
                    </div>
                    <p className="min-w-0 truncate text-sm font-medium text-slate-900">{item.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span className="flex items-center gap-1"><Calendar size={12} /> {formatCompactDateTime(item.scheduledAt, settings.timezone)}</span>
                      <span>· {item.priority} Priority</span>
                    </div>
                </div>
                <div className="shrink-0">
                  <IconActionButton icon={<Check size={15} />} label="Complete Task" variant="success" disabled={!canWrite || completingTaskId === item.taskId} onClick={(event) => { event.stopPropagation(); void handleCompleteDashboardTask(item.taskId); }} />
                </div>
              </div>
            ))}

            {followUpItems.length === 0 && (
              <div className="py-12 text-center text-slate-400 text-sm">
                No pending follow-ups. Great job!
              </div>
            )}
          </div>
        </Card>
        </MovableDashboardCard>

      </div>

      {/* Second Grid: Recent Leads & Recent Activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent Leads */}
        <MovableDashboardCard cardId="leads" order={secondaryCardOrder.indexOf('leads')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('leads', 'secondary')}>
        <Card className="flex flex-col space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-slate-800">Recent Leads</h3>
              <p className="text-xs text-slate-500">Latest prospects registered in the system</p>
            </div>
            <Badge variant="purple">{totalLeads} Total</Badge>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-[350px]">
            {leads.slice(0, 5).map((lead) => (
              <div key={lead.id} role="button" tabIndex={0} onClick={() => openLead(lead.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLead(lead.id); } }} className="flex cursor-pointer items-center justify-between rounded-lg border-b border-slate-100 p-3 transition-colors hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 last:border-b-0">
                <div>
                  <p className="font-semibold text-sm text-slate-900">{lead.name}</p>
                  <p className="text-xs text-slate-500">{lead.company || 'Independent'} • Source: {lead.source}</p>
                </div>
                <div className="text-right space-y-1">
                  <Badge variant={lead.status === 'New' ? 'blue' : lead.status === 'Opportunity' ? 'purple' : 'gray'}>
                    {lead.status}
                  </Badge>
                  <p className="text-[10px] text-slate-400">{new Date(lead.createdAt).toISOString().split('T')[0]}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
        </MovableDashboardCard>

        {/* Recent Activity */}
        <MovableDashboardCard cardId="activity" order={secondaryCardOrder.indexOf('activity')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('activity', 'secondary')}>
        <Card className="flex flex-col space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="font-bold text-slate-800">Recent Activity</h3>
              <p className="text-xs text-slate-500">System audit log of sales operations</p>
            </div>
            <Badge variant="gray">{activities.length} Events</Badge>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-[350px]">
            {activities.map((act) => (
              <div key={act.id} className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900">{act.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-slate-400">{new Date(act.timestamp).toISOString().replace('T', ' ').substring(0, 16)}</span>
                    {act.meta && <span className="text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded">{act.meta}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        </MovableDashboardCard>
      </div>

      {/* Modals for Quick Actions */}
      <AnimatePresence>
        {activeModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-lg space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-[0_18px_55px_rgba(15,23,42,0.14)]"
            >
              <button 
                onClick={() => setActiveModal(null)}
                className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X size={20} />
              </button>

              {activeModal === 'lead' && (
                <form onSubmit={handleCreateLead} className="space-y-4">
                  <h3 className="text-lg font-bold text-slate-900">Add New Lead</h3>
                  {(leadError || workspaceLoading) && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700" role="alert">{leadError || 'Workspace is still loading. Please wait a moment.'}</p>}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Full Name</label>
                    <input 
                      type="text" 
                      required 
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={leadForm.name}
                      onChange={e => setLeadForm({...leadForm, name: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Email</label>
                      <input 
                        type="email" 
                        required 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={leadForm.email}
                        onChange={e => setLeadForm({...leadForm, email: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Phone</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={leadForm.phone}
                        onChange={e => setLeadForm({...leadForm, phone: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Company</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={leadForm.company}
                        onChange={e => setLeadForm({...leadForm, company: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Source</label>
                      <select 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        value={leadForm.source}
                        onChange={e => setLeadForm({...leadForm, source: e.target.value})}
                      >
                        {settings.leadSources.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                    <Button type="submit" disabled={leadSaving || !workspaceReady}>{leadSaving ? 'Saving…' : 'Save Lead'}</Button>
                  </div>
                </form>
              )}

              {activeModal === 'client' && (
                <form onSubmit={handleCreateClient} className="space-y-4">
                  <h3 className="text-lg font-bold text-slate-900">Add New Client</h3>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Client Name</label>
                    <input 
                      type="text" 
                      required 
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={clientForm.name}
                      onChange={e => setClientForm({...clientForm, name: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Email</label>
                      <input 
                        type="email" 
                        required 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={clientForm.email}
                        onChange={e => setClientForm({...clientForm, email: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Phone</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={clientForm.phone}
                        onChange={e => setClientForm({...clientForm, phone: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Company</label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={clientForm.company}
                      onChange={e => setClientForm({...clientForm, company: e.target.value})}
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                    <Button type="submit">Save Client</Button>
                  </div>
                </form>
              )}

              {activeModal === 'task' && (
                <form onSubmit={handleCreateTask} className="space-y-4">
                  <h3 className="text-lg font-bold text-slate-900">Create Task & Follow-up</h3>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Task Title</label>
                    <input 
                      type="text" 
                      required 
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={taskForm.title}
                      onChange={e => setTaskForm({...taskForm, title: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Due Date</label>
                      <input 
                        type="date" 
                        required 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={taskForm.dueDate}
                        onChange={e => setTaskForm({...taskForm, dueDate: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-500 uppercase">Priority</label>
                      <select 
                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        value={taskForm.priority}
                        onChange={e => setTaskForm({...taskForm, priority: e.target.value as any})}
                      >
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase">Description</label>
                    <textarea 
                      className="w-full px-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      rows={3}
                      value={taskForm.description}
                      onChange={e => setTaskForm({...taskForm, description: e.target.value})}
                    />
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                    <Button type="submit">Create Task</Button>
                  </div>
                </form>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function reorderCards<T extends string>(cards: T[], source: T, target: T) {
  const next = [...cards];
  const sourceIndex = next.indexOf(source);
  const targetIndex = next.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) return cards;
  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, source);
  return next;
}

function MovableDashboardCard({ cardId, order, onDragStart, onDragEnd, onDrop, children }: { cardId: string; order: number; onDragStart: (cardId: string) => void; onDragEnd: () => void; onDrop: () => void; children: React.ReactNode }) {
  return <div style={{ order }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(); }} className="relative min-w-0">
    <button type="button" draggable aria-label={`Move ${cardId} dashboard card`} title="Drag to move card" onDragStart={() => onDragStart(cardId)} onDragEnd={onDragEnd} className="absolute right-3 top-3 z-20 rounded-md p-1 text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-500 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 group-hover:opacity-100 sm:opacity-60">
      <GripVertical size={16} />
    </button>
    {children}
  </div>;
}
