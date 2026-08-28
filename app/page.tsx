'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  ChevronDown,
  ArrowRight,
  GripVertical
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency, formatCurrencyParts } from '@/lib/formatting';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { canManageClients, canManageLeads, canManageTasks } from '@/lib/permissions';
import { formatCompactDateTime, isFollowUpTask } from '@/lib/task-utils';
import { PipelineFunnel } from '@/components/PipelineFunnel';
import { loadDashboardMetrics, type DashboardDateRange, type DashboardMetrics } from '@/lib/repositories/dashboard';
import { IconActionButton } from '@/components/IconActionButton';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { endOfDay, format, isToday, startOfDay, subDays } from 'date-fns';
import { emitStartupTiming, markStartup, observeStartupLcp } from '@/lib/startupTiming';

type DashboardFollowUpItem =
  | { id: string; source: 'LEAD' | 'CLIENT' | 'DEAL' | 'TASK'; relatedName: string; title: string; description?: string; scheduledAt: string; state: 'SCHEDULED' | 'OVERDUE'; taskId: string; priority: 'Low' | 'Medium' | 'High' };

type PrimaryDashboardCard = 'pipeline' | 'followups';
type SecondaryDashboardCard = 'leads' | 'clients' | 'deals' | 'activity';
type KpiDashboardCard = 'leadsKpi' | 'openDealsKpi' | 'followupsKpi' | 'wonDealsKpi' | 'potentialSalesKpi' | 'salesMonthKpi';
type DashboardRangePreset = '7' | '28' | '60' | '365' | 'custom';
const DASHBOARD_LAYOUT_KEY = 'bsm_dashboard_card_layout';
const DEFAULT_DASHBOARD_LAYOUT = { kpis: ['potentialSalesKpi', 'leadsKpi', 'openDealsKpi', 'followupsKpi', 'wonDealsKpi', 'salesMonthKpi'] as KpiDashboardCard[], primary: ['pipeline', 'followups'] as PrimaryDashboardCard[], secondary: ['leads', 'clients', 'deals', 'activity'] as SecondaryDashboardCard[] };
const DASHBOARD_RANGE_OPTIONS: Array<{ value: DashboardRangePreset; label: string; days?: number }> = [
  { value: '7', label: '7 Days', days: 7 },
  { value: '28', label: '28 Days', days: 28 },
  { value: '60', label: '60 Days', days: 60 },
  { value: '365', label: '365 Days', days: 365 },
  { value: 'custom', label: 'Custom' },
];

function DashboardCurrencyValue({ value, currency, className }: { value: number; currency: string; className?: string }) {
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  const compactValue = Math.abs(value) >= 1_000_000
    ? new Intl.NumberFormat(undefined, { style: 'currency', currency: safeCurrency, notation: 'compact', maximumFractionDigits: 2 }).format(value)
    : null;
  if (compactValue) return <span className={cn('dashboard-currency-value mt-3 inline-block max-w-full truncate text-2xl font-semibold leading-none tracking-tight text-[var(--app-text)] tabular-nums sm:text-[28px]', className)} title={formatCurrency(value, currency)}>{compactValue}</span>;
  const parts = formatCurrencyParts(value, currency);
  return <span className={cn('dashboard-currency-value mt-3 inline-flex max-w-full whitespace-nowrap text-2xl font-semibold leading-none tracking-tight text-[var(--app-text)] tabular-nums sm:text-[28px]', className)}>
    <span>{parts.beforeDecimal}</span>
    {parts.decimal && <span className="text-[18px] font-semibold align-baseline">{parts.decimal}</span>}
    {parts.afterDecimal && <span>{parts.afterDecimal}</span>}
  </span>;
}

function getDashboardDateRange(preset: DashboardRangePreset, customStartDate: string, customEndDate: string): DashboardDateRange | null {
  if (preset === 'custom') {
    if (!customStartDate || !customEndDate) return null;
    const start = startOfDay(new Date(`${customStartDate}T00:00:00`));
    const end = endOfDay(new Date(`${customEndDate}T00:00:00`));
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return null;
    return { start, end };
  }

  const days = DASHBOARD_RANGE_OPTIONS.find((option) => option.value === preset)?.days || 28;
  const end = endOfDay(new Date());
  return { start: startOfDay(subDays(end, days - 1)), end };
}

function getDashboardLayoutPreference() {
  if (typeof window === 'undefined') return DEFAULT_DASHBOARD_LAYOUT;
  try {
    const saved = JSON.parse(window.localStorage.getItem(DASHBOARD_LAYOUT_KEY) || '{}') as { kpis?: KpiDashboardCard[]; primary?: PrimaryDashboardCard[]; secondary?: SecondaryDashboardCard[] };
    return {
      kpis: saved.kpis?.length === 6 && DEFAULT_DASHBOARD_LAYOUT.kpis.every((card) => saved.kpis?.includes(card)) ? saved.kpis : DEFAULT_DASHBOARD_LAYOUT.kpis,
      primary: saved.primary?.length === 2 && saved.primary.includes('pipeline') && saved.primary.includes('followups') ? saved.primary : DEFAULT_DASHBOARD_LAYOUT.primary,
      secondary: saved.secondary?.length === 4 && DEFAULT_DASHBOARD_LAYOUT.secondary.every((card) => saved.secondary?.includes(card)) ? saved.secondary : DEFAULT_DASHBOARD_LAYOUT.secondary,
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
  const canManageClientsAction = canManageClients(membership) && canWrite;
  const canManageTasksAction = canManageTasks(membership) && canWrite;
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [rangePreset, setRangePreset] = useState<DashboardRangePreset>('28');
  const [customStartDate, setCustomStartDate] = useState(() => format(subDays(new Date(), 27), 'yyyy-MM-dd'));
  const [customEndDate, setCustomEndDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [primaryCardOrder, setPrimaryCardOrder] = useState<PrimaryDashboardCard[]>(() => getDashboardLayoutPreference().primary);
  const [secondaryCardOrder, setSecondaryCardOrder] = useState<SecondaryDashboardCard[]>(() => getDashboardLayoutPreference().secondary);
  const [kpiCardOrder, setKpiCardOrder] = useState<KpiDashboardCard[]>(() => getDashboardLayoutPreference().kpis);
  const [draggingCard, setDraggingCard] = useState<string | null>(null);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);
  const [dashboardMetricsError, setDashboardMetricsError] = useState<string | null>(null);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [dashboardRangeOpen, setDashboardRangeOpen] = useState(false);
  const quickActionsMenuRef = useRef<HTMLDivElement>(null);
  const dashboardRangeMenuRef = useRef<HTMLDivElement>(null);
  const dashboardPaintMeasured = useRef(false);
  const dashboardDateRange = useMemo(() => getDashboardDateRange(rangePreset, customStartDate, customEndDate), [customEndDate, customStartDate, rangePreset]);
  const dashboardRangeLabel = rangePreset === 'custom' ? 'Custom range' : `Last ${rangePreset} days`;
  const dashboardDateRangeLabel = dashboardDateRange ? `${format(dashboardDateRange.start, 'MMM d')} – ${format(dashboardDateRange.end, 'MMM d, yyyy')}` : 'Choose a valid range';

  useEffect(() => {
    if (!quickActionsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!quickActionsMenuRef.current?.contains(event.target as Node)) setQuickActionsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setQuickActionsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [quickActionsOpen]);

  useEffect(() => {
    if (!dashboardRangeOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!dashboardRangeMenuRef.current?.contains(event.target as Node)) setDashboardRangeOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDashboardRangeOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [dashboardRangeOpen]);

  useEffect(() => {
    window.localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify({ kpis: kpiCardOrder, primary: primaryCardOrder, secondary: secondaryCardOrder }));
  }, [kpiCardOrder, primaryCardOrder, secondaryCardOrder]);

  const reloadDashboardMetrics = useCallback(async () => {
    if (!user || !workspaceReady || !currentOrganizationId || workspaceLoading) {
      setDashboardMetrics(null);
      return;
    }
    if (!dashboardDateRange) {
      setDashboardMetrics(null);
      setDashboardMetricsError('Select a valid custom date range to load Dashboard metrics.');
      return;
    }
    setDashboardMetricsError(null);
    try {
      const metrics = await loadDashboardMetrics(user, currentOrganizationId, dashboardDateRange);
      setDashboardMetrics(metrics);
      markStartup('dashboard-data-ready');
      emitStartupTiming();
    } catch (error) {
      console.error('Unable to load dashboard metrics', error);
      setDashboardMetrics(null);
      setDashboardMetricsError('Dashboard metrics could not be loaded. Please refresh and try again.');
    } finally {
    }
  }, [currentOrganizationId, dashboardDateRange, user, workspaceLoading, workspaceReady]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (cancelled) return;
      await reloadDashboardMetrics();
    };
    void load();
    const handleInvalidation = () => { void reloadDashboardMetrics(); };
    window.addEventListener('bsm-dashboard-metrics-invalidated', handleInvalidation);
    return () => {
      cancelled = true;
      window.removeEventListener('bsm-dashboard-metrics-invalidated', handleInvalidation);
    };
  }, [reloadDashboardMetrics]);
  useEffect(() => {
    const stopObservingLcp = observeStartupLcp('[data-startup-lcp="dashboard-kpi"]');
    const frame = window.requestAnimationFrame(() => {
      if (dashboardPaintMeasured.current) return;
      dashboardPaintMeasured.current = true;
      markStartup('dashboard-first-paint');
      emitStartupTiming();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      stopObservingLcp?.();
    };
  }, []);

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

  const openQuickAction = (modal: 'lead' | 'client' | 'task') => {
    setQuickActionsOpen(false);
    if (modal === 'lead') setLeadError(null);
    setActiveModal(modal);
  };

  // KPI Calculations
  const isWithinDashboardRange = (value?: string) => {
    if (!dashboardDateRange || !value) return false;
    const time = Date.parse(value);
    return Number.isFinite(time) && time >= dashboardDateRange.start.getTime() && time <= dashboardDateRange.end.getTime();
  };
  const totalLeads = dashboardMetrics?.totalLeads ?? leads.filter((lead) => !lead.archived && isWithinDashboardRange(lead.createdAt)).length;
  const openDealStages = new Set(['New', 'Qualified', 'Proposal', 'Negotiation']);
  const openDeals = deals.filter((deal) => !deal.archived && openDealStages.has(deal.stage) && isWithinDashboardRange(deal.createdAt));
  const activeOpportunities = dashboardMetrics?.activeDeals ?? openDeals.length;
  const wonDealsCount = dashboardMetrics?.wonDeals ?? deals.filter((deal) => deal.status === 'Won' && isWithinDashboardRange(deal.wonAt)).length;
  const pipelineValue = dashboardMetrics?.pipelineValue ?? openDeals.reduce((sum, d) => sum + d.value, 0);

  const salesThisMonthFromLoadedDeals = deals
    .filter((deal) => {
      if (deal.status !== 'Won') return false;
      return isWithinDashboardRange(deal.wonAt);
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
  const openClient = (clientId: string) => router.push(`/clients?clientId=${encodeURIComponent(clientId)}`);
  const openDeal = (dealId: string) => router.push(`/pipeline?dealId=${encodeURIComponent(dealId)}`);
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

  const followUpsDue = dashboardMetrics?.pendingFollowUps ?? followUpItems.filter((item) => isWithinDashboardRange(item.scheduledAt)).length;
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
    <div className="dashboard-page space-y-3 pb-8 sm:space-y-6">
      <div className="dashboard-top">
        <PageHeader
          title="Dashboard"
          subtitle="Overview of your sales, follow-ups, and activity."
          actions={<>
            <div className="dashboard-desktop-actions hidden w-full gap-2 sm:flex sm:w-auto">
              {canManage && <Button disabled={!workspaceReady} onClick={() => { setLeadError(null); setActiveModal('lead'); }} className="gap-2"><Plus size={16} /> Add Lead</Button>}
              <Button variant="outline" disabled={!canManageClientsAction} onClick={() => setActiveModal('client')} className="gap-2"><Plus size={16} /> Add Client</Button>
              <Button variant="outline" disabled={!canManageTasksAction} onClick={() => setActiveModal('task')} className="gap-2"><Plus size={16} /> Add Task</Button>
            </div>
            <div ref={quickActionsMenuRef} className="dashboard-mobile-quick-action hidden">
              <button
                type="button"
                aria-label="Quick actions"
                aria-controls="dashboard-quick-actions-menu"
                aria-expanded={quickActionsOpen}
                aria-haspopup="menu"
                onClick={() => setQuickActionsOpen((open) => !open)}
                className="dashboard-mobile-quick-action-trigger flex items-center justify-center rounded-lg bg-[var(--app-primary)] text-white shadow-sm transition-colors hover:bg-[var(--app-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30"
              >
                <Plus size={20} />
              </button>
              {quickActionsOpen && <div id="dashboard-quick-actions-menu" role="menu" aria-label="Quick actions menu" className="dashboard-quick-actions-menu">
                <button type="button" role="menuitem" onClick={() => openQuickAction('lead')} disabled={!canManage || !workspaceReady}>Add Lead</button>
                <button type="button" role="menuitem" onClick={() => openQuickAction('client')} disabled={!canManageClientsAction}>Add Client</button>
                <button type="button" role="menuitem" onClick={() => openQuickAction('task')} disabled={!canManageTasksAction}>Add Task</button>
              </div>}
            </div>
          </>}
        />
      </div>

      {/* KPI Cards Grid (6 cards required) */}
      <div className="space-y-3">
        <div className="dashboard-key-metrics-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="dashboard-key-metrics-title">
            <h2 className="text-sm font-semibold text-[var(--app-text)]">Key Metrics</h2>
            <p className="sr-only">{dashboardDateRangeLabel}</p>
          </div>
          <div ref={dashboardRangeMenuRef} className="dashboard-range-selector">
            <button type="button" className="dashboard-range-trigger" aria-haspopup="listbox" aria-expanded={dashboardRangeOpen} aria-label={`Dashboard time range: ${dashboardRangeLabel}, ${dashboardDateRangeLabel}`} onClick={() => setDashboardRangeOpen((open) => !open)}>
              <span className="dashboard-range-trigger-preset">{dashboardRangeLabel}</span>
              <span className="dashboard-range-trigger-date">{dashboardDateRangeLabel}</span>
              <ChevronDown size={18} aria-hidden="true" className={`dashboard-range-select-chevron transition-transform ${dashboardRangeOpen ? 'rotate-180' : ''}`} />
            </button>
            {dashboardRangeOpen && <div className={`dashboard-range-menu ${rangePreset === 'custom' ? 'dashboard-range-menu-with-custom' : 'dashboard-range-menu-simple'}`} role="listbox" aria-label="Dashboard time range options">
              <div className="dashboard-range-menu-options">
                {DASHBOARD_RANGE_OPTIONS.map((option) => {
                  const optionLabel = option.value === 'custom' ? 'Custom range' : `Last ${option.label.toLowerCase()}`;
                  return <button key={option.value} type="button" role="option" aria-selected={rangePreset === option.value} className={`dashboard-range-option ${rangePreset === option.value ? 'dashboard-range-option-active' : ''}`} onClick={() => { setRangePreset(option.value); if (option.value !== 'custom') setDashboardRangeOpen(false); }}>
                    <span>{optionLabel}</span>
                    {rangePreset === option.value && <Check size={16} aria-hidden="true" />}
                  </button>;
                })}
              </div>
              {rangePreset === 'custom' && <div className="dashboard-range-custom-panel">
                <label>
                  Start date
                  <input type="date" value={customStartDate} onChange={(event) => setCustomStartDate(event.target.value)} />
                </label>
                <label>
                  End date
                  <input type="date" value={customEndDate} onChange={(event) => setCustomEndDate(event.target.value)} />
                </label>
              </div>}
            </div>}
          </div>
        </div>
      </div>
      <div data-startup-lcp="dashboard-kpi" className="dashboard-kpi-grid grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-6">
        <MovableDashboardCard cardId="leadsKpi" order={kpiCardOrder.indexOf('leadsKpi')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('leadsKpi', 'kpis')}>
        <Card className="dashboard-kpi-card flex h-full min-h-[118px] flex-col rounded-[var(--app-radius-card)] p-3 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-[var(--app-border)] hover:shadow-[var(--app-shadow-sm)] sm:min-h-[128px] sm:p-4">
          <div className="dashboard-kpi-heading flex items-center gap-2 pr-8 text-xs font-semibold text-[var(--app-muted)]"><span className="rounded-md bg-[var(--app-accent-soft)] p-1 text-[var(--app-primary)]"><Users size={14} /></span><span>Leads</span></div>
          <span className="mt-3 whitespace-nowrap text-2xl font-semibold leading-none tracking-tight text-[var(--app-text)] tabular-nums sm:text-[28px]">{totalLeads}</span>
          <p className="mt-2 min-h-[1.25rem] truncate text-xs text-[var(--app-muted)]">Potential customers</p>
        </Card>
        </MovableDashboardCard>

        <MovableDashboardCard cardId="openDealsKpi" order={kpiCardOrder.indexOf('openDealsKpi')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('openDealsKpi', 'kpis')}>
        <Card className="dashboard-kpi-card flex h-full min-h-[118px] flex-col rounded-[var(--app-radius-card)] p-3 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-[var(--app-border)] hover:shadow-[var(--app-shadow-sm)] sm:min-h-[128px] sm:p-4">
          <div className="dashboard-kpi-heading flex items-center gap-2 pr-8 text-xs font-semibold text-[var(--app-muted)]"><span className="rounded-md bg-[var(--app-accent-soft)] p-1 text-[var(--app-primary)]"><TrendingUp size={14} /></span><span>Open Deals</span></div>
          <span className="mt-3 whitespace-nowrap text-2xl font-semibold leading-none tracking-tight text-[var(--app-text)] tabular-nums sm:text-[28px]">{activeOpportunities}</span>
          <p className="mt-2 min-h-[1.25rem] truncate text-xs text-[var(--app-muted)]">Deals currently in progress</p>
        </Card>
        </MovableDashboardCard>

        <MovableDashboardCard cardId="followupsKpi" order={kpiCardOrder.indexOf('followupsKpi')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('followupsKpi', 'kpis')}>
        <Card className="dashboard-kpi-card flex h-full min-h-[118px] flex-col rounded-[var(--app-radius-card)] p-3 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-[var(--app-border)] hover:shadow-[var(--app-shadow-sm)] sm:min-h-[128px] sm:p-4">
          <div className="dashboard-kpi-heading flex items-center gap-2 pr-8 text-xs font-semibold text-[var(--app-muted)]"><span className="rounded-md bg-[color-mix(in_srgb,var(--app-warning)_14%,white)] p-1 text-[var(--app-warning)]"><Clock size={14} /></span><span>Follow-ups Due</span></div>
          <span className="mt-3 whitespace-nowrap text-2xl font-semibold leading-none tracking-tight text-[var(--app-text)] tabular-nums sm:text-[28px]">{followUpsDue}</span>
          <p className="mt-2 min-h-[1.25rem] truncate text-xs text-[var(--app-muted)]">Tasks needing your attention</p>
        </Card>
        </MovableDashboardCard>

        <MovableDashboardCard cardId="wonDealsKpi" order={kpiCardOrder.indexOf('wonDealsKpi')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('wonDealsKpi', 'kpis')}>
        <Card className="dashboard-kpi-card flex h-full min-h-[118px] flex-col rounded-[var(--app-radius-card)] p-3 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-[var(--app-border)] hover:shadow-[var(--app-shadow-sm)] sm:min-h-[128px] sm:p-4">
          <div className="dashboard-kpi-heading flex items-center gap-2 pr-8 text-xs font-semibold text-[var(--app-muted)]"><span className="rounded-md bg-[var(--app-accent-soft)] p-1 text-[var(--app-primary)]"><CheckCircle2 size={14} /></span><span>Won Deals</span></div>
          <span className="mt-3 whitespace-nowrap text-2xl font-semibold leading-none tracking-tight text-[var(--app-text)] tabular-nums sm:text-[28px]">{wonDealsCount}</span>
          <p className="mt-2 min-h-[1.25rem] truncate text-xs text-[var(--app-muted)]">Successfully closed deals</p>
        </Card>
        </MovableDashboardCard>

        <MovableDashboardCard cardId="potentialSalesKpi" order={kpiCardOrder.indexOf('potentialSalesKpi')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('potentialSalesKpi', 'kpis')}>
        <Card className="dashboard-kpi-card dashboard-potential-sales-card flex h-full min-h-[118px] flex-col rounded-[var(--app-radius-card)] p-3 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-[var(--app-accent)] hover:shadow-[var(--app-shadow-sm)] sm:min-h-[128px] sm:p-4">
          <div className="dashboard-kpi-heading dashboard-potential-sales-label flex items-center gap-2 pr-8 text-xs font-semibold text-[var(--app-muted)]"><span className="dashboard-potential-sales-icon rounded-md bg-[var(--app-accent-soft)] p-1 text-[var(--app-primary)]"><DollarSign size={14} /></span><span>Potential Sales</span></div>
          <DashboardCurrencyValue value={pipelineValue} currency={settings.currency} className="dashboard-potential-sales-value" />
          <p className="dashboard-potential-sales-description mt-2 min-h-[1.25rem] truncate text-xs text-[var(--app-muted)]">Total value of open deals</p>
        </Card>
        </MovableDashboardCard>

        <MovableDashboardCard cardId="salesMonthKpi" order={kpiCardOrder.indexOf('salesMonthKpi')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('salesMonthKpi', 'kpis')}>
        <Card className="dashboard-kpi-card flex h-full min-h-[118px] flex-col rounded-[var(--app-radius-card)] p-3 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-[var(--app-border)] hover:shadow-[var(--app-shadow-sm)] sm:min-h-[128px] sm:p-4">
          <div className="dashboard-kpi-heading flex items-center gap-2 pr-8 text-xs font-semibold text-[var(--app-muted)]"><span className="rounded-md bg-[var(--app-accent-soft)] p-1 text-[var(--app-primary)]"><Briefcase size={14} /></span><span>Sales This Month</span></div>
          <DashboardCurrencyValue value={salesThisMonth} currency={settings.currency} />
          <p className="mt-2 min-h-[1.25rem] truncate text-xs text-[var(--app-muted)]">Sales closed this month</p>
        </Card>
        </MovableDashboardCard>
      </div>

      {/* Main Grid: Follow-ups Due & Pipeline Overview */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <MovableDashboardCard cardId="pipeline" order={primaryCardOrder.indexOf('pipeline')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('pipeline', 'primary')}>
          <PipelineFunnel deals={deals} currency={settings.currency} stageSummary={dashboardMetrics?.pipelineByStage} />
        </MovableDashboardCard>

        {/* Follow-ups Due */}
        <MovableDashboardCard cardId="followups" order={primaryCardOrder.indexOf('followups')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('followups', 'primary')}>
        <Card className="flex h-full flex-col space-y-3">
          <div className="flex items-center justify-between border-b border-[var(--app-border-subtle)] pb-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--app-text)]">Follow-ups &amp; Tasks</h3>
              <p className="text-xs text-[var(--app-muted)]">Upcoming and overdue actions</p>
            </div>
            <Badge variant="gray">{followUpItems.length} open</Badge>
          </div>

          <div className="max-h-[350px] flex-1 space-y-3 overflow-y-auto">
            {followUpItems.map((item) => (
              <div key={item.id} role="button" tabIndex={0} onClick={() => openFollowUp(item)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openFollowUp(item); } }} className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border-b border-[var(--app-border-subtle)] p-3 transition-colors duration-150 hover:bg-[var(--app-surface-subtle)] focus-visible:bg-[var(--app-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30 last:border-b-0">
                <div className="w-full min-w-0 flex-1 space-y-1 text-left">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Badge variant={sourceBadgeVariant(item.source)}>{item.source}</Badge>
                      <Badge variant={item.state === 'OVERDUE' ? 'red' : 'blue'}>{item.state === 'OVERDUE' ? 'OVERDUE' : isToday(new Date(item.scheduledAt)) ? 'DUE TODAY' : 'SCHEDULED'}</Badge>
                      <span className="truncate text-xs font-medium text-[var(--app-text)]">{item.relatedName}</span>
                    </div>
                    <p className="min-w-0 truncate text-sm font-medium text-[var(--app-text)]">{item.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-[var(--app-muted)]">
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
              <div className="py-12 text-center text-[var(--app-tertiary)] text-sm">
                No pending follow-ups. Great job!
              </div>
            )}
          </div>
        </Card>
        </MovableDashboardCard>

      </div>

      {/* Second Grid: Recent Records & Recent Activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent Leads */}
        <MovableDashboardCard cardId="leads" order={secondaryCardOrder.indexOf('leads')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('leads', 'secondary')}>
        <Card className="flex flex-col space-y-3">
          <div className="flex items-center justify-between border-b border-[var(--app-border-subtle)] pb-3">
            <div>
              <h3 className="font-bold text-[var(--app-text)]">Recent Leads</h3>
              <p className="text-xs text-[var(--app-muted)]">Latest prospects registered in the system</p>
            </div>
            <Badge variant="purple">{totalLeads} Total</Badge>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-[350px]">
            {leads.slice(0, 5).map((lead) => (
              <div key={lead.id} role="button" tabIndex={0} onClick={() => openLead(lead.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLead(lead.id); } }} className="flex cursor-pointer items-center justify-between rounded-lg border-b border-[var(--app-border-subtle)] p-3 transition-colors hover:bg-[var(--app-surface-subtle)] focus-visible:bg-[var(--app-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30 last:border-b-0">
                <div>
                  <p className="font-semibold text-sm text-[var(--app-text)]">{lead.name}</p>
                  <p className="text-xs text-[var(--app-muted)]">{lead.company || 'Independent'} • Source: {lead.source}</p>
                </div>
                <div className="text-right space-y-1">
                  <Badge variant={lead.status === 'New' ? 'blue' : lead.status === 'Opportunity' ? 'purple' : 'gray'}>
                    {lead.status}
                  </Badge>
                  <p className="text-[10px] text-[var(--app-tertiary)]">{new Date(lead.createdAt).toISOString().split('T')[0]}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
        </MovableDashboardCard>

        <MovableDashboardCard cardId="clients" order={secondaryCardOrder.indexOf('clients')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('clients', 'secondary')}>
        <Card className="flex flex-col space-y-3">
          <div className="flex items-center justify-between border-b border-[var(--app-border-subtle)] pb-3">
            <div>
              <h3 className="font-bold text-[var(--app-text)]">Recent Clients</h3>
              <p className="text-xs text-[var(--app-muted)]">Latest active client records</p>
            </div>
            <Badge variant="green">{clients.length} Loaded</Badge>
          </div>
          <div className="max-h-[350px] flex-1 space-y-3 overflow-y-auto">
            {clients.slice(0, 5).map((client) => (
              <div key={client.id} role="button" tabIndex={0} onClick={() => openClient(client.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openClient(client.id); } }} className="flex cursor-pointer items-center justify-between rounded-lg border-b border-[var(--app-border-subtle)] p-3 transition-colors hover:bg-[var(--app-surface-subtle)] focus-visible:bg-[var(--app-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30 last:border-b-0">
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-[var(--app-text)]">{client.name}</p><p className="truncate text-xs text-[var(--app-muted)]">{client.company || client.email}</p></div>
                <p className="shrink-0 text-[10px] text-[var(--app-tertiary)]">{new Date(client.createdAt).toLocaleDateString()}</p>
              </div>
            ))}
            {clients.length === 0 && <div className="py-12 text-center text-sm text-[var(--app-tertiary)]">No clients yet.</div>}
          </div>
        </Card>
        </MovableDashboardCard>

        <MovableDashboardCard cardId="deals" order={secondaryCardOrder.indexOf('deals')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('deals', 'secondary')}>
        <Card className="flex flex-col space-y-3">
          <div className="flex items-center justify-between border-b border-[var(--app-border-subtle)] pb-3">
            <div>
              <h3 className="font-bold text-[var(--app-text)]">Recent Deals</h3>
              <p className="text-xs text-[var(--app-muted)]">Latest opportunities and closed deals</p>
            </div>
            <Badge variant="purple">{deals.length} Loaded</Badge>
          </div>
          <div className="max-h-[350px] flex-1 space-y-3 overflow-y-auto">
            {deals.slice(0, 5).map((deal) => (
              <div key={deal.id} role="button" tabIndex={0} onClick={() => openDeal(deal.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openDeal(deal.id); } }} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border-b border-[var(--app-border-subtle)] p-3 transition-colors hover:bg-[var(--app-surface-subtle)] focus-visible:bg-[var(--app-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30 last:border-b-0">
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-[var(--app-text)]">{deal.title}</p><p className="truncate text-xs text-[var(--app-muted)]">{deal.stage} · {formatCurrency(deal.value, settings.currency)}</p></div>
                <Badge variant={deal.status === 'Won' ? 'green' : deal.status === 'Lost' ? 'red' : 'blue'}>{deal.status}</Badge>
              </div>
            ))}
            {deals.length === 0 && <div className="py-12 text-center text-sm text-[var(--app-tertiary)]">No deals yet.</div>}
          </div>
        </Card>
        </MovableDashboardCard>

        {/* Recent Activity */}
        <MovableDashboardCard cardId="activity" order={secondaryCardOrder.indexOf('activity')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('activity', 'secondary')}>
        <Card className="flex flex-col space-y-3">
          <div className="flex items-center justify-between border-b border-[var(--app-border-subtle)] pb-3">
            <div>
              <h3 className="font-bold text-[var(--app-text)]">Recent Activity</h3>
              <p className="text-xs text-[var(--app-muted)]">System audit log of sales operations</p>
            </div>
            <Badge variant="gray">{activities.length} Events</Badge>
          </div>

          <div className="space-y-3 flex-1 overflow-y-auto max-h-[350px]">
            {activities.map((act) => (
              <div key={act.id} className="flex items-start gap-3 p-3 bg-[var(--app-surface-subtle)] border border-[var(--app-border-subtle)] rounded-xl">
                <div className="w-2 h-2 mt-1.5 rounded-full bg-[var(--app-primary)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--app-text)]">{act.description}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-[var(--app-tertiary)]">{new Date(act.timestamp).toISOString().replace('T', ' ').substring(0, 16)}</span>
                    {act.meta && <span className="text-[10px] font-bold text-[var(--app-primary)] bg-[var(--app-accent-soft)] px-1.5 py-0.5 rounded">{act.meta}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        </MovableDashboardCard>
      </div>

      {/* Modals for Quick Actions */}
      {dashboardMetricsError && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-warning)_13%,white)] p-3 text-sm text-[var(--app-text)]" role="status">{dashboardMetricsError}</p>}
      {activeModal && (
        <div className="app-modal fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-4">
          <div className="app-modal-panel relative w-full max-w-lg space-y-5 p-5" role="dialog" aria-modal="true" aria-label={`${activeModal === 'lead' ? 'Add Lead' : activeModal === 'client' ? 'Add Client' : 'Add Task'} dialog`}>
              <div className="absolute right-3 top-3"><ModalCloseButton onClose={() => setActiveModal(null)} /></div>

              {activeModal === 'lead' && (
                <form onSubmit={handleCreateLead} className="space-y-4">
                  <h3 className="text-lg font-bold text-[var(--app-text)]">Add New Lead</h3>
                  {(leadError || workspaceLoading) && <p className="rounded-lg bg-[color-mix(in_srgb,var(--app-warning)_13%,white)] p-3 text-sm text-[var(--app-text)]" role="alert">{leadError || 'Workspace is still loading. Please wait a moment.'}</p>}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Full Name</label>
                    <input 
                      type="text" 
                      required 
                      className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]"
                      value={leadForm.name}
                      onChange={e => setLeadForm({...leadForm, name: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Email</label>
                      <input 
                        type="email" 
                        required 
                        className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]"
                        value={leadForm.email}
                        onChange={e => setLeadForm({...leadForm, email: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Phone</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]"
                        value={leadForm.phone}
                        onChange={e => setLeadForm({...leadForm, phone: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Company</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]"
                        value={leadForm.company}
                        onChange={e => setLeadForm({...leadForm, company: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Source</label>
                      <select 
                        className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)] bg-white"
                        value={leadForm.source}
                        onChange={e => setLeadForm({...leadForm, source: e.target.value})}
                      >
                        {settings.leadSources.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="app-modal-footer">
                    <Button type="button" variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                    <Button type="submit" disabled={leadSaving || !workspaceReady}>{leadSaving ? 'Saving…' : 'Save Lead'}</Button>
                  </div>
                </form>
              )}

              {activeModal === 'client' && (
                <form onSubmit={handleCreateClient} className="space-y-4">
                  <h3 className="text-lg font-bold text-[var(--app-text)]">Add New Client</h3>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Client Name</label>
                    <input 
                      type="text" 
                      required 
                      className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]"
                      value={clientForm.name}
                      onChange={e => setClientForm({...clientForm, name: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Email</label>
                      <input 
                        type="email" 
                        required 
                        className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]"
                        value={clientForm.email}
                        onChange={e => setClientForm({...clientForm, email: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Phone</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]"
                        value={clientForm.phone}
                        onChange={e => setClientForm({...clientForm, phone: e.target.value})}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Company</label>
                    <input 
                      type="text" 
                      className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]"
                      value={clientForm.company}
                      onChange={e => setClientForm({...clientForm, company: e.target.value})}
                    />
                  </div>
                  <div className="app-modal-footer">
                    <Button type="button" variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                    <Button type="submit">Save Client</Button>
                  </div>
                </form>
              )}

              {activeModal === 'task' && (
                <form onSubmit={handleCreateTask} className="space-y-4">
                  <h3 className="text-lg font-bold text-[var(--app-text)]">Create Task & Follow-up</h3>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Task Title</label>
                    <input 
                      type="text" 
                      required 
                      className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]"
                      value={taskForm.title}
                      onChange={e => setTaskForm({...taskForm, title: e.target.value})}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Due Date</label>
                      <input 
                        type="date" 
                        required 
                        className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]"
                        value={taskForm.dueDate}
                        onChange={e => setTaskForm({...taskForm, dueDate: e.target.value})}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Priority</label>
                      <select 
                        className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)] bg-white"
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
                    <label className="text-xs font-bold text-[var(--app-muted)] uppercase">Description</label>
                    <textarea 
                      className="w-full px-4 py-2 border border-[var(--app-border)] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-primary)]"
                      rows={3}
                      value={taskForm.description}
                      onChange={e => setTaskForm({...taskForm, description: e.target.value})}
                    />
                  </div>
                  <div className="app-modal-footer">
                    <Button type="button" variant="outline" onClick={() => setActiveModal(null)}>Cancel</Button>
                    <Button type="submit">Create Task</Button>
                  </div>
                </form>
              )}
          </div>
          </div>
      )}
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
    <button type="button" draggable aria-label={`Move ${cardId} dashboard card`} title="Drag to move card" onDragStart={() => onDragStart(cardId)} onDragEnd={onDragEnd} className="absolute right-3 top-3 z-20 rounded-md p-1 text-[var(--app-tertiary)] opacity-0 transition-opacity hover:bg-[var(--app-surface-subtle)] hover:text-[var(--app-muted)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30 group-hover:opacity-100 sm:opacity-60">
      <GripVertical size={16} />
    </button>
    {children}
  </div>;
}
