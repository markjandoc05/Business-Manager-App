import { count, getAggregateFromServer, query, sum, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import { requireOrganizationAccess } from '@/lib/permissions';
import { organizationCollection } from '@/lib/organizations/paths';
import { cachedRequest, invalidateCachedRequest } from '@/lib/repositories/requestCache';
import { DEAL_ACTIVE_STAGES } from '@/lib/deal-workflow';
import { getLocalCalendarDate } from '@/lib/sale-workflow';
import type { DashboardKpiId } from '@/lib/dashboard-kpis';
import { finishStartupStage, incrementStartupCounter, startStartupStage } from '@/lib/startupTiming';

export type DashboardDateRange = { start: Date; end: Date };
export type DashboardMetricValues = Partial<Record<DashboardKpiId, number>>;
export type DashboardMetrics = { values: DashboardMetricValues; failedKpis: DashboardKpiId[] };
type QueryGroup = 'salesRange' | 'salesOutstanding' | 'dealsOpen' | 'dealsWon' | 'dealsLost' | 'leadsTotal' | 'leadsNew' | 'leadsFollowup' | 'clientsTotal' | 'clientsNew' | 'tasksFollowups' | 'tasksOverdue';

const GROUPS: Record<QueryGroup, DashboardKpiId[]> = {
  salesRange: ['sales.total', 'sales.transactions', 'sales.collected'], salesOutstanding: ['sales.outstanding'],
  dealsOpen: ['deals.open', 'deals.potentialSales'], dealsWon: ['deals.won', 'deals.winRate'], dealsLost: ['deals.lost', 'deals.winRate'],
  leadsTotal: ['leads.total'], leadsNew: ['leads.new'], leadsFollowup: ['leads.followup'],
  clientsTotal: ['clients.total'], clientsNew: ['clients.new'], tasksFollowups: ['tasks.followupsDue'], tasksOverdue: ['tasks.overdue'],
};

export function planDashboardQueryGroups(selected: readonly DashboardKpiId[]): QueryGroup[] {
  const wanted = new Set(selected);
  return (Object.keys(GROUPS) as QueryGroup[]).filter((group) => GROUPS[group].some((id) => wanted.has(id)));
}

export function getDefaultDashboardDateRange(now = new Date()): DashboardDateRange {
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const start = new Date(end); start.setDate(start.getDate() - 27); start.setHours(0, 0, 0, 0);
  return { start, end };
}

async function loadDashboardAggregate<T>(group: QueryGroup, loader: () => Promise<T>): Promise<T> {
  incrementStartupCounter('dashboard-aggregate-queries');
  startStartupStage(`dashboard-kpi-${group}`);
  try {
    return await loader();
  } finally {
    finishStartupStage(`dashboard-kpi-${group}`);
  }
}

export async function loadDashboardMetrics(user: AppUser | null, organizationId: string, selected: readonly DashboardKpiId[], range = getDefaultDashboardDateRange()): Promise<DashboardMetrics> {
  const groups = planDashboardQueryGroups(selected);
  const rangeGroups: QueryGroup[] = ['salesRange', 'dealsWon', 'dealsLost', 'leadsNew', 'clientsNew'];
  const current = groups.filter((group) => !rangeGroups.includes(group));
  const ranged = groups.filter((group) => rangeGroups.includes(group));
  const prefix = `dashboard-metrics-v2:${user?.uid || 'anonymous'}:${organizationId}`;
  const [currentMetrics, rangeMetrics] = await Promise.all([
    current.length ? cachedRequest(`${prefix}:current:${current.join(',')}`, 60_000, () => loadDashboardMetricsUncached(user, organizationId, current, range)) : Promise.resolve({ values: {}, failedKpis: [] }),
    ranged.length ? cachedRequest(`${prefix}:range:${ranged.join(',')}:${range.start.toISOString()}-${range.end.toISOString()}`, 60_000, () => loadDashboardMetricsUncached(user, organizationId, ranged, range)) : Promise.resolve({ values: {}, failedKpis: [] }),
  ]);
  return { values: { ...currentMetrics.values, ...rangeMetrics.values }, failedKpis: [...currentMetrics.failedKpis, ...rangeMetrics.failedKpis] };
}

async function loadDashboardMetricsUncached(user: AppUser | null, organizationId: string, groups: QueryGroup[], range: DashboardDateRange): Promise<DashboardMetrics> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const assigned = membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : [];
  const c = { leads: organizationCollection(db, organizationId, 'leads'), clients: organizationCollection(db, organizationId, 'clients'), deals: organizationCollection(db, organizationId, 'deals'), sales: organizationCollection(db, organizationId, 'sales'), tasks: organizationCollection(db, organizationId, 'tasks') };
  const saleRange = [where('saleDate', '>=', getLocalCalendarDate(range.start)), where('saleDate', '<=', getLocalCalendarDate(range.end))] as const;
  const createdRange = [where('createdAt', '>=', range.start), where('createdAt', '<=', range.end)] as const;
  const dueNow = new Date().toISOString();
  const results = await Promise.allSettled(groups.map(async (group) => {
    switch (group) {
      case 'salesRange': { const d = (await loadDashboardAggregate(group, () => getAggregateFromServer(query(c.sales, where('status', '==', 'ACTIVE'), ...saleRange), { count: count(), total: sum('total'), paid: sum('amountPaid') }))).data(); return [group, { 'sales.transactions': d.count, 'sales.total': d.total || 0, 'sales.collected': d.paid || 0 }] as const; }
      case 'salesOutstanding': { const d = (await loadDashboardAggregate(group, () => getAggregateFromServer(query(c.sales, where('status', '==', 'ACTIVE')), { balance: sum('balance') }))).data(); return [group, { 'sales.outstanding': d.balance || 0 }] as const; }
      case 'dealsOpen': { const d = (await loadDashboardAggregate(group, () => getAggregateFromServer(query(c.deals, where('archived', '==', false), ...assigned, where('stage', 'in', [...DEAL_ACTIVE_STAGES])), { count: count(), value: sum('value') }))).data(); return [group, { 'deals.open': d.count, 'deals.potentialSales': d.value || 0 }] as const; }
      case 'dealsWon': { const d = (await loadDashboardAggregate(group, () => getAggregateFromServer(query(c.deals, where('archived', '==', false), ...assigned, where('status', '==', 'Won'), where('wonAt', '>=', range.start), where('wonAt', '<=', range.end)), { count: count() }))).data(); return [group, { 'deals.won': d.count }] as const; }
      case 'dealsLost': { const d = (await loadDashboardAggregate(group, () => getAggregateFromServer(query(c.deals, where('archived', '==', false), ...assigned, where('status', '==', 'Lost'), where('lostAt', '>=', range.start), where('lostAt', '<=', range.end)), { count: count() }))).data(); return [group, { 'deals.lost': d.count }] as const; }
      case 'leadsTotal': { const d = (await loadDashboardAggregate(group, () => getAggregateFromServer(query(c.leads, where('archived', '==', false), ...assigned), { count: count() }))).data(); return [group, { 'leads.total': d.count }] as const; }
      case 'leadsNew': { const d = (await loadDashboardAggregate(group, () => getAggregateFromServer(query(c.leads, where('archived', '==', false), ...assigned, ...createdRange), { count: count() }))).data(); return [group, { 'leads.new': d.count }] as const; }
      case 'leadsFollowup': { const d = (await loadDashboardAggregate(group, () => getAggregateFromServer(query(c.leads, where('archived', '==', false), ...assigned, where('status', '==', 'Follow-up')), { count: count() }))).data(); return [group, { 'leads.followup': d.count }] as const; }
      case 'clientsTotal': { const d = (await loadDashboardAggregate(group, () => getAggregateFromServer(query(c.clients, where('archived', '==', false)), { count: count() }))).data(); return [group, { 'clients.total': d.count }] as const; }
      case 'clientsNew': { const d = (await loadDashboardAggregate(group, () => getAggregateFromServer(query(c.clients, where('archived', '==', false), ...createdRange), { count: count() }))).data(); return [group, { 'clients.new': d.count }] as const; }
      case 'tasksFollowups': { const d = (await loadDashboardAggregate(group, () => getAggregateFromServer(query(c.tasks, where('archived', '==', false), ...assigned, where('status', '==', 'Pending'), where('type', '==', 'Follow-up'), where('dueDate', '<=', dueNow)), { count: count() }))).data(); return [group, { 'tasks.followupsDue': d.count }] as const; }
      case 'tasksOverdue': { const today = new Date(); today.setHours(0, 0, 0, 0); const d = (await loadDashboardAggregate(group, () => getAggregateFromServer(query(c.tasks, where('archived', '==', false), ...assigned, where('status', '==', 'Pending'), where('dueDate', '<', today.toISOString())), { count: count() }))).data(); return [group, { 'tasks.overdue': d.count }] as const; }
    }
  }));
  const values: DashboardMetricValues = {}; const failedKpis: DashboardKpiId[] = [];
  results.forEach((item, index) => { if (item.status === 'fulfilled') Object.assign(values, item.value[1]); else { console.error(`Dashboard metric group ${groups[index]} failed`, item.reason); failedKpis.push(...GROUPS[groups[index]]); } });
  if (groups.includes('dealsWon') && groups.includes('dealsLost')) { const won = values['deals.won'] || 0; const lost = values['deals.lost'] || 0; values['deals.winRate'] = won + lost ? (won / (won + lost)) * 100 : 0; }
  return { values, failedKpis };
}

export function invalidateDashboardMetrics(organizationId: string) { void organizationId; invalidateCachedRequest('dashboard-metrics-v2:'); if (typeof window !== 'undefined') window.dispatchEvent(new Event('bsm-dashboard-metrics-invalidated')); }
