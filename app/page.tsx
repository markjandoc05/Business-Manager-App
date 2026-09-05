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
  GripVertical,
  Settings2,
  ArrowUp,
  ArrowDown,
  Info
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatCurrency, formatCurrencyParts } from '@/lib/formatting';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { canManageClients, canManageLeads, canManageTasks } from '@/lib/permissions';
import { formatCompactDateTime, isFollowUpTask } from '@/lib/task-utils';
import { PipelineFunnel } from '@/components/PipelineFunnel';
import { loadDashboardMetrics, type DashboardDateRange, type DashboardMetrics } from '@/lib/repositories/dashboard';
import { userFacingErrorMessage } from '@/lib/repositories/pagination';
import { getPipelineStageSummaries, invalidatePipelineStageSummaryRequests, type PipelineStageSummary } from '@/lib/repositories/deals';
import { DASHBOARD_KPI_STORAGE_KEY, DEFAULT_DASHBOARD_KPI_IDS, getKpiDefinition, KPI_REGISTRY, MAX_DASHBOARD_KPIS, MIN_DASHBOARD_KPIS, normalizeDashboardKpiIds, readDashboardKpiPreference, type DashboardKpiId } from '@/lib/dashboard-kpis';
import { DEAL_ACTIVE_STAGES } from '@/lib/deal-workflow';
import { IconActionButton } from '@/components/IconActionButton';
import { ModalCloseButton } from '@/components/ModalCloseButton';
import { endOfDay, format, isToday, startOfDay, subDays } from 'date-fns';
import { emitStartupTiming, finishStartupStage, markStartup, markStartupEvent, observeStartupLcp, startStartupStage } from '@/lib/startupTiming';
import { MovableKpiCard } from '@/components/KpiCard';

type DashboardFollowUpItem =
  | { id: string; source: 'LEAD' | 'CLIENT' | 'DEAL' | 'TASK'; relatedName: string; title: string; description?: string; scheduledAt: string; state: 'SCHEDULED' | 'OVERDUE'; taskId: string; priority: 'Low' | 'Medium' | 'High' };

type PrimaryDashboardCard = 'pipeline' | 'followups';
type SecondaryDashboardCard = 'leads' | 'clients' | 'deals' | 'activity';
type DashboardRangePreset = '7' | '28' | '60' | '365' | 'custom';
const DASHBOARD_LAYOUT_KEY = 'bsm_dashboard_card_layout';
const DEFAULT_DASHBOARD_LAYOUT = { primary: ['pipeline', 'followups'] as PrimaryDashboardCard[], secondary: ['leads', 'clients', 'deals', 'activity'] as SecondaryDashboardCard[] };
const PIPELINE_FOCUS_REFRESH_GUARD_MS = 1_000;
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
    const saved = JSON.parse(window.localStorage.getItem(DASHBOARD_LAYOUT_KEY) || '{}') as { primary?: PrimaryDashboardCard[]; secondary?: SecondaryDashboardCard[] };
    return {
      primary: saved.primary?.length === 2 && saved.primary.includes('pipeline') && saved.primary.includes('followups') ? saved.primary : DEFAULT_DASHBOARD_LAYOUT.primary,
      secondary: saved.secondary?.length === 4 && DEFAULT_DASHBOARD_LAYOUT.secondary.every((card) => saved.secondary?.includes(card)) ? saved.secondary : DEFAULT_DASHBOARD_LAYOUT.secondary,
    };
  } catch {
    return DEFAULT_DASHBOARD_LAYOUT;
  }
}

export default function DashboardPage() {
  const { leads, clients, deals, tasks, activities, settings, leadsLoading, clientsLoading, dealsLoading, tasksLoading, settingsLoading, completeTask, addLead, addClient, addTask } = useApp();
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
  const [selectedKpis, setSelectedKpis] = useState<DashboardKpiId[]>(() => readDashboardKpiPreference(typeof window === 'undefined' ? null : window.localStorage));
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [draftKpis, setDraftKpis] = useState<DashboardKpiId[]>([]);
  const [openKpiModules, setOpenKpiModules] = useState<Set<string>>(new Set(['Sales', 'Deals']));
  const [savingKpis, setSavingKpis] = useState(false);
  const [customizeMessage, setCustomizeMessage] = useState<string | null>(null);
  const [draggingCard, setDraggingCard] = useState<string | null>(null);
  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);
  const [dashboardMetricsError, setDashboardMetricsError] = useState<string | null>(null);
  const [pipelineStageSummary, setPipelineStageSummary] = useState<PipelineStageSummary | null>(null);
  const [pipelineMetricsError, setPipelineMetricsError] = useState<string | null>(null);
  const pipelineRequestVersion = useRef(0);
  const pipelineLastRequestAt = useRef(0);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [dashboardRangeOpen, setDashboardRangeOpen] = useState(false);
  const quickActionsMenuRef = useRef<HTMLDivElement>(null);
  const dashboardRangeMenuRef = useRef<HTMLDivElement>(null);
  const dashboardPaintMeasured = useRef(false);
  const dashboardStarted = useRef(false);
  const dashboardDataStarted = useRef(false);
  const dashboardCriticalReady = useRef(false);
  const dashboardComplete = useRef(false);
  const dashboardRequestVersion = useRef(0);
  const dashboardDateRange = useMemo(() => getDashboardDateRange(rangePreset, customStartDate, customEndDate), [customEndDate, customStartDate, rangePreset]);
  const selectedKpiMetricKey = useMemo(() => [...selectedKpis].sort().join('|'), [selectedKpis]);
  const selectedKpisForMetrics = useMemo(() => selectedKpiMetricKey.split('|').filter(Boolean) as DashboardKpiId[], [selectedKpiMetricKey]);
  const dashboardRangeLabel = rangePreset === 'custom' ? 'Custom range' : `Last ${rangePreset} days`;
  const dashboardDateRangeLabel = dashboardDateRange ? `${format(dashboardDateRange.start, 'MMM d')} – ${format(dashboardDateRange.end, 'MMM d, yyyy')}` : 'Choose a valid range';

  useEffect(() => {
    if (!dashboardStarted.current) {
      dashboardStarted.current = true;
      markStartupEvent('DASHBOARD_MOUNT');
      markStartup('dashboard-start');
    }
    if (workspaceReady) markStartup('workspace-ready');
    emitStartupTiming();
  }, [workspaceReady]);

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
    window.localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify({ primary: primaryCardOrder, secondary: secondaryCardOrder }));
  }, [primaryCardOrder, secondaryCardOrder]);

  useEffect(() => { window.localStorage.setItem(DASHBOARD_KPI_STORAGE_KEY, JSON.stringify(selectedKpis)); }, [selectedKpis]);

  useEffect(() => {
    if (!customizeOpen) return;
    const originalOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setCustomizeOpen(false); };
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = originalOverflow; document.removeEventListener('keydown', onKeyDown); };
  }, [customizeOpen]);

  const reloadDashboardMetrics = useCallback(async () => {
    const requestVersion = ++dashboardRequestVersion.current;
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
    if (!dashboardDataStarted.current) {
      dashboardDataStarted.current = true;
      markStartupEvent('DASHBOARD_DATA_START');
      markStartup('dashboard-data-start');
    }
    startStartupStage('dashboard-kpi-metrics');
    try {
      const metrics = await loadDashboardMetrics(user, currentOrganizationId, selectedKpisForMetrics, dashboardDateRange);
      if (requestVersion !== dashboardRequestVersion.current) return;
      setDashboardMetrics(metrics);
      markStartup('dashboard-data-ready');
      emitStartupTiming();
    } catch (error) {
      if (requestVersion !== dashboardRequestVersion.current) return;
      console.error('Unable to load dashboard metrics', error);
      setDashboardMetrics(null);
      setDashboardMetricsError('Dashboard metrics could not be loaded. Please refresh and try again.');
    } finally {
      finishStartupStage('dashboard-kpi-metrics');
    }
  }, [currentOrganizationId, dashboardDateRange, selectedKpisForMetrics, user, workspaceLoading, workspaceReady]);

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

  const reloadPipelineStageSummary = useCallback(async () => {
    const requestVersion = ++pipelineRequestVersion.current;
    if (!user || !workspaceReady || !currentOrganizationId || workspaceLoading) {
      setPipelineStageSummary(null);
      return;
    }
    pipelineLastRequestAt.current = Date.now();
    setPipelineMetricsError(null);
    startStartupStage('dashboard-pipeline-aggregates');
    try {
      const summary = await getPipelineStageSummaries(user, currentOrganizationId);
      if (requestVersion !== pipelineRequestVersion.current) return;
      setPipelineStageSummary(summary);
    } catch (error) {
      if (requestVersion !== pipelineRequestVersion.current) return;
      console.error('Unable to load Pipeline Overview aggregates', error);
      setPipelineMetricsError('Pipeline Overview could not be refreshed. Please try again.');
    } finally {
      finishStartupStage('dashboard-pipeline-aggregates');
    }
  }, [currentOrganizationId, user, workspaceLoading, workspaceReady]);

  useEffect(() => {
    void reloadPipelineStageSummary();
    const handleInvalidation = () => {
      invalidatePipelineStageSummaryRequests();
      void reloadPipelineStageSummary();
    };
    const handleFocus = () => {
      // Google/Firebase sign-in commonly restores focus as the Dashboard is
      // mounting. Avoid immediately repeating the just-started aggregate
      // batch; later focus events still refresh the authoritative summary.
      if (Date.now() - pipelineLastRequestAt.current < PIPELINE_FOCUS_REFRESH_GUARD_MS) return;
      void reloadPipelineStageSummary();
    };
    window.addEventListener('bsm-dashboard-metrics-invalidated', handleInvalidation);
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('bsm-dashboard-metrics-invalidated', handleInvalidation);
      window.removeEventListener('focus', handleFocus);
      pipelineRequestVersion.current += 1;
    };
  }, [reloadPipelineStageSummary]);

  useEffect(() => {
    if (dashboardCriticalReady.current || !dashboardMetrics || !pipelineStageSummary) return;
    dashboardCriticalReady.current = true;
    markStartupEvent('DASHBOARD_CRITICAL_DATA_READY');
    markStartup('dashboard-critical-data-ready');
    emitStartupTiming();
  }, [dashboardMetrics, pipelineStageSummary]);

  useEffect(() => {
    if (dashboardComplete.current || !dashboardMetrics || !pipelineStageSummary || leadsLoading || clientsLoading || dealsLoading || tasksLoading || settingsLoading) return;
    dashboardComplete.current = true;
    markStartupEvent('DASHBOARD_COMPLETE');
    markStartup('dashboard-complete');
    emitStartupTiming();
  }, [clientsLoading, dashboardMetrics, dealsLoading, leadsLoading, pipelineStageSummary, settingsLoading, tasksLoading]);

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
      setSelectedKpis((current) => reorderCards(current, draggingCard as DashboardKpiId, target as DashboardKpiId));
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
  const totalLeads = leads.filter((lead) => !lead.archived).length;

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

  const sourceBadgeVariant = (source: DashboardFollowUpItem['source']) => source === 'LEAD' ? 'blue' : source === 'CLIENT' ? 'green' : source === 'DEAL' ? 'purple' : 'gray';
  const openCustomize = () => { setDraftKpis(selectedKpis); setOpenKpiModules(new Set(['Sales', 'Deals'])); setCustomizeMessage(null); setCustomizeOpen(true); };
  const toggleDraftKpi = (id: DashboardKpiId) => {
    setDraftKpis((current) => {
      if (current.includes(id)) return current.length <= MIN_DASHBOARD_KPIS ? current : current.filter((item) => item !== id);
      if (current.length >= MAX_DASHBOARD_KPIS) { setCustomizeMessage(`You can display up to ${MAX_DASHBOARD_KPIS} KPI cards.`); return current; }
      setCustomizeMessage(null); return [...current, id];
    });
  };

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
      setLeadError(userFacingErrorMessage(error, 'Unable to save the lead. Please try again.'));
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

      {/* KPI cards are selected and ordered independently from the rest of the dashboard. */}
      <div className="space-y-3">
        <div className="dashboard-key-metrics-header flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="dashboard-key-metrics-title">
            <h2 className="text-sm font-semibold text-[var(--app-text)]">Key Metrics</h2>
            <p className="sr-only">{dashboardDateRangeLabel}</p>
          </div>
          <div className="dashboard-key-metrics-controls flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={openCustomize} className="gap-2"><Settings2 size={16} /> Customize Dashboard</Button>
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
      </div>
      <div data-startup-lcp="dashboard-kpi" className="bsm-kpi-grid dashboard-kpi-grid grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-6">
        {selectedKpis.map((id, index) => <MovableKpiCard key={id} cardId={id} order={index} className="dashboard-kpi-drag-container" onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard(id, 'kpis')}><DashboardKpiCard id={id} value={dashboardMetrics?.values[id]} failed={dashboardMetrics?.failedKpis.includes(id) || false} currency={settings.currency} /></MovableKpiCard>)}
      </div>

      {/* Main Grid: Follow-ups Due & Pipeline Overview */}
      <div className="grid items-stretch gap-4 lg:grid-cols-2">
        <MovableDashboardCard cardId="pipeline" order={primaryCardOrder.indexOf('pipeline')} onDragStart={setDraggingCard} onDragEnd={() => setDraggingCard(null)} onDrop={() => moveDashboardCard('pipeline', 'primary')}>
          {pipelineMetricsError && <p className="mb-2 rounded-lg bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] p-2 text-xs text-[var(--app-danger)]" role="alert">{pipelineMetricsError} <button type="button" className="font-semibold underline" onClick={() => void reloadPipelineStageSummary()}>Retry</button></p>}
          <PipelineFunnel deals={deals} currency={settings.currency} stageSummary={pipelineStageSummary ?? {}} />
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

      {customizeOpen && <div className="app-modal customize-dashboard-overlay fixed inset-0 z-50 flex items-center justify-center bg-[var(--app-primary)]/45 p-3 sm:p-6">
        <div className="app-modal-panel customize-dashboard-modal relative flex w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] max-w-[780px] flex-col overflow-hidden p-0 sm:w-[calc(100vw-3rem)] sm:max-h-[calc(100dvh-3rem)]" role="dialog" aria-modal="true" aria-label="Customize Dashboard">
          <header className="shrink-0 border-b border-[var(--app-border-subtle)] px-4 py-4 sm:px-6">
            <div className="absolute right-2 top-2"><ModalCloseButton onClose={() => setCustomizeOpen(false)} /></div>
            <h3 className="pr-10 text-lg font-bold text-[var(--app-text)]">Customize Dashboard</h3>
            <p className="mt-1 text-sm text-[var(--app-muted)]">Choose the metrics you want to see on your dashboard.</p>
            <p className="mt-1 text-sm font-medium text-[var(--app-text)]">Selected {draftKpis.length} of {MAX_DASHBOARD_KPIS}</p>
            {draftKpis.length === MAX_DASHBOARD_KPIS && <p className="mt-1 text-xs text-[var(--app-tertiary)]">Maximum {MAX_DASHBOARD_KPIS} KPI cards.</p>}
            {draftKpis.length < MIN_DASHBOARD_KPIS && <p className="mt-1 text-xs text-[var(--app-warning)]">Select at least {MIN_DASHBOARD_KPIS} KPI cards.</p>}
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {customizeMessage && <p role="status" className="mb-3 rounded-lg bg-[var(--app-accent-soft)] p-2 text-sm text-[var(--app-text)]">{customizeMessage}</p>}
            <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
              <section aria-label="KPI cards" className="min-w-0 space-y-2">
                {(['Sales', 'Deals', 'Leads', 'Clients', 'Tasks'] as const).map((module) => {
                  const moduleKpis = KPI_REGISTRY.filter((kpi) => kpi.module === module);
                  const selectedCount = moduleKpis.filter((kpi) => draftKpis.includes(kpi.id)).length;
                  const isOpen = openKpiModules.has(module);
                  const subtitle = module === 'Sales' ? 'Actual sales and payment metrics' : module === 'Deals' ? 'Sales opportunities and pipeline performance' : module === 'Leads' ? 'Lead activity and acquisition' : module === 'Clients' ? 'Customer growth and activity' : 'Follow-ups and actions requiring attention';
                  return <section key={module} className="overflow-hidden rounded-lg border border-[var(--app-border-subtle)]">
                    <button type="button" aria-expanded={isOpen} aria-controls={`dashboard-kpis-${module}`} onClick={() => setOpenKpiModules((current) => { const next = new Set(current); if (next.has(module)) next.delete(module); else next.add(module); return next; })} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--app-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-primary)]/30">
                      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-[var(--app-text)]">{module}</span><span className="block text-xs text-[var(--app-muted)]">{subtitle}</span></span>
                      <span className="text-xs font-medium text-[var(--app-muted)]">{selectedCount}/{moduleKpis.length}</span><ChevronDown size={16} aria-hidden="true" className={isOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                    </button>
                    {isOpen && <div id={`dashboard-kpis-${module}`} className="border-t border-[var(--app-border-subtle)] px-2 py-1">
                      {moduleKpis.map((kpi) => { const checked = draftKpis.includes(kpi.id); const atMaximum = !checked && draftKpis.length >= MAX_DASHBOARD_KPIS; return <label key={kpi.id} className={`flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2.5 hover:bg-[var(--app-surface-subtle)] ${atMaximum ? 'cursor-not-allowed opacity-55' : ''}`}><input type="checkbox" className="mt-0.5 shrink-0" checked={checked} disabled={atMaximum} onChange={() => toggleDraftKpi(kpi.id)} /><span className="min-w-0"><span className="block text-sm font-medium text-[var(--app-text)]">{kpi.label}</span><span className="mt-0.5 block text-xs leading-5 text-[var(--app-muted)]">{kpi.description}</span><span className="mt-1 block text-[11px] text-[var(--app-tertiary)]">{kpi.dateBehavior === 'RANGE' ? 'Selected period' : 'Current'}</span></span></label>; })}
                    </div>}
                  </section>;
                })}
              </section>
              <section aria-label="Card order" className="min-w-0 border-t border-[var(--app-border-subtle)] pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
                <h4 className="text-sm font-semibold text-[var(--app-text)]">Card Order</h4><p className="mb-3 text-xs text-[var(--app-muted)]">Choose the order your KPI cards appear.</p>
                <div className="space-y-1">
                  {draftKpis.map((id, index) => <div key={id} className="flex min-h-10 items-center gap-2 rounded-md bg-[var(--app-surface-subtle)] px-2"><span className="w-4 text-xs font-semibold text-[var(--app-tertiary)]">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm text-[var(--app-text)]">{getKpiDefinition(id)?.label}</span><span className="flex shrink-0 gap-1"><button type="button" aria-label={`Move ${getKpiDefinition(id)?.label} up`} disabled={index === 0} onClick={() => setDraftKpis((items) => reorderCards(items, id, items[index - 1]))} className="rounded p-1.5 text-[var(--app-muted)] hover:bg-[var(--app-surface)] disabled:cursor-not-allowed disabled:opacity-30"><ArrowUp size={16} /></button><button type="button" aria-label={`Move ${getKpiDefinition(id)?.label} down`} disabled={index === draftKpis.length - 1} onClick={() => setDraftKpis((items) => reorderCards(items, id, items[index + 1]))} className="rounded p-1.5 text-[var(--app-muted)] hover:bg-[var(--app-surface)] disabled:cursor-not-allowed disabled:opacity-30"><ArrowDown size={16} /></button></span></div>)}
                </div>
              </section>
            </div>
          </div>
          <footer className="app-modal-footer shrink-0 justify-between border-t border-[var(--app-border-subtle)] bg-[var(--app-surface)] px-4 py-3 sm:px-6"><Button type="button" variant="outline" onClick={() => { setDraftKpis([...DEFAULT_DASHBOARD_KPI_IDS]); setCustomizeMessage(null); }}>Reset to Default</Button><span className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCustomizeOpen(false)}>Cancel</Button><Button type="button" disabled={savingKpis || draftKpis.length < MIN_DASHBOARD_KPIS} onClick={() => { if (savingKpis) return; setSavingKpis(true); setSelectedKpis(normalizeDashboardKpiIds(draftKpis)); setCustomizeOpen(false); setSavingKpis(false); }}>{savingKpis ? 'Saving…' : 'Save Changes'}</Button></span></footer>
        </div>
      </div>}

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

function DashboardKpiCard({ id, value, failed, currency }: { id: DashboardKpiId; value: number | undefined; failed: boolean; currency: string }) {
  const definition = getKpiDefinition(id);
  if (!definition) return null;
  const Icon = definition.icon;
  const isPotentialSales = id === 'deals.potentialSales';
  const shownValue = value ?? 0;
  return <Card className={cn('dashboard-kpi-card flex min-h-[118px] min-w-0 flex-col rounded-[var(--app-radius-card)] p-3 sm:min-h-[128px] sm:p-4', isPotentialSales && 'dashboard-potential-sales-card')}>
    <div className="dashboard-kpi-heading relative flex min-w-0 items-center gap-2 pr-5">
      <span className={cn('dashboard-kpi-icon inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--app-accent-soft)] text-[var(--app-primary)]', isPotentialSales && 'dashboard-potential-sales-icon')}><Icon size={18} aria-hidden="true" /></span>
      <span className={cn('min-w-0 flex-1 text-xs font-semibold leading-4', isPotentialSales ? 'dashboard-potential-sales-label' : 'text-[var(--app-muted)]')}>{definition.label}</span>
      <span tabIndex={0} role="img" aria-label={`About ${definition.label}`} className={cn('kpi-info-trigger dashboard-kpi-info absolute right-0 top-1/2 -translate-y-1/2 rounded p-0.5 text-[var(--app-tertiary)] transition-[right,color] duration-150 hover:text-[var(--app-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30', isPotentialSales && 'text-white/75 hover:text-white')}><Info size={14} /><span role="tooltip" className="dashboard-kpi-help absolute right-0 top-9 z-20 w-56 rounded-md border border-[var(--app-border)] bg-[var(--app-surface)] p-2 text-xs font-normal leading-snug text-[var(--app-text)] shadow-[var(--app-shadow-sm)]">{definition.description}</span></span>
    </div>
    {failed ? <span className={cn('mt-3 text-sm', isPotentialSales ? 'text-white/75' : 'text-[var(--app-muted)]')}>Unavailable</span> : definition.format === 'currency' ? <DashboardCurrencyValue value={shownValue} currency={currency} className={isPotentialSales ? 'dashboard-potential-sales-value' : undefined} /> : <span className={cn('mt-3 text-2xl font-semibold leading-none tracking-tight tabular-nums sm:text-[28px]', isPotentialSales ? 'text-white' : 'text-[var(--app-text)]')}>{definition.format === 'percent' ? `${shownValue.toFixed(0)}%` : shownValue}</span>}
    <p className={cn('mt-2 min-h-[1.25rem] text-xs', isPotentialSales ? 'dashboard-potential-sales-description' : 'text-[var(--app-muted)]')}>{definition.cardContext}</p>
  </Card>;
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
  return <div style={{ order }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop(); }} className="kpi-drag-container relative min-w-0">
    <button type="button" draggable aria-label={`Hold and drag ${cardId} to reorder dashboard cards`} title="Hold to reveal, then drag to reorder" onDragStart={() => onDragStart(cardId)} onDragEnd={onDragEnd} className="dashboard-card-drag-handle absolute right-3 top-3 z-20 cursor-grab rounded-md p-1 text-[var(--app-tertiary)] opacity-0 transition-[opacity,background-color,color] duration-150 hover:bg-[var(--app-surface-subtle)] hover:text-[var(--app-muted)] active:cursor-grabbing focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-primary)]/30">
      <GripVertical size={16} />
    </button>
    {children}
  </div>;
}
