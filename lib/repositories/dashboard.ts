import { count, getAggregateFromServer, query, sum, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser } from '@/types/auth';
import { requireOrganizationAccess } from '@/lib/permissions';
import { organizationCollection } from '@/lib/organizations/paths';
import { cachedRequest, invalidateCachedRequest } from '@/lib/repositories/requestCache';
import { DEAL_ACTIVE_STAGES, DEAL_STAGES } from '@/lib/deal-workflow';
import { getDashboardLeadTotal } from '@/lib/dashboard-metrics';

export { getDashboardLeadTotal } from '@/lib/dashboard-metrics';

const OPEN_STAGES = DEAL_ACTIVE_STAGES;

export type DashboardMetrics = {
  totalLeads: number;
  activeLeads: number;
  convertedLeads: number;
  clients: number;
  activeDeals: number;
  wonDeals: number;
  lostDeals: number;
  pendingTasks: number;
  overdueTasks: number;
  pendingFollowUps: number;
  overdueFollowUps: number;
  pipelineValue: number;
  salesThisMonth: number;
  pipelineByStage: Record<string, { count: number; value: number }>;
};

export type DashboardDateRange = {
  start: Date;
  end: Date;
};

export function getDefaultDashboardDateRange(now = new Date()): DashboardDateRange {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - 27);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

export async function loadDashboardMetrics(user: AppUser | null, organizationId: string, range = getDefaultDashboardDateRange()): Promise<DashboardMetrics> {
  const cacheKey = `dashboard-metrics:${user?.uid || 'anonymous'}:${organizationId}:${range.start.toISOString()}-${range.end.toISOString()}`;
  return cachedRequest(cacheKey, 60_000, () => loadDashboardMetricsUncached(user, organizationId, range));
}

async function loadDashboardMetricsUncached(user: AppUser | null, organizationId: string, range: DashboardDateRange): Promise<DashboardMetrics> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const leads = organizationCollection(db, organizationId, 'leads');
  const clients = organizationCollection(db, organizationId, 'clients');
  const deals = organizationCollection(db, organizationId, 'deals');
  const tasks = organizationCollection(db, organizationId, 'tasks');
  const now = new Date();
  const dueDateStart = range.start.toISOString();
  const dueDateEnd = range.end.toISOString();
  const dueDateNow = now.toISOString();
  const assignedDeal = membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : [];
  const assignedTask = membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : [];
  const assignedLead = membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : [];
  const createdAtRange = [where('createdAt', '>=', range.start), where('createdAt', '<=', range.end)] as const;
  const wonAtRange = [where('wonAt', '>=', range.start), where('wonAt', '<=', range.end)] as const;
  const lostAtRange = [where('lostAt', '>=', range.start), where('lostAt', '<=', range.end)] as const;
  const dueDateRange = [where('dueDate', '>=', dueDateStart), where('dueDate', '<=', dueDateEnd)] as const;
  const overdueDueDateRange = [where('dueDate', '>=', dueDateStart), where('dueDate', '<=', dueDateNow)] as const;

  const [leadTotals, activeLeadTotals, convertedLeadTotals, clientTotals, wonDealTotals, lostDealTotals, pendingTaskTotals, overdueTaskTotals, pendingFollowUpTotals, overdueFollowUpTotals, salesTotals, rangePipelineTotals, pipelineStageTotals] = await Promise.all([
    getAggregateFromServer(query(leads, where('archived', '==', false), ...assignedLead, ...createdAtRange), { count: count() }),
    getAggregateFromServer(query(leads, where('archived', '==', false), ...assignedLead, where('status', 'in', ['New', 'Follow-up', 'Opportunity']), ...createdAtRange), { count: count() }),
    getAggregateFromServer(query(leads, where('archived', '==', false), ...assignedLead, where('status', '==', 'Client'), ...createdAtRange), { count: count() }),
    getAggregateFromServer(query(clients, where('archived', '==', false), ...createdAtRange), { count: count() }),
    getAggregateFromServer(query(deals, where('archived', '==', false), ...assignedDeal, where('status', '==', 'Won'), ...wonAtRange), { count: count() }),
    getAggregateFromServer(query(deals, where('archived', '==', false), ...assignedDeal, where('status', '==', 'Lost'), ...lostAtRange), { count: count() }),
    getAggregateFromServer(query(tasks, where('archived', '==', false), ...assignedTask, where('status', '==', 'Pending'), ...dueDateRange), { count: count() }),
    getAggregateFromServer(query(tasks, where('archived', '==', false), ...assignedTask, where('status', '==', 'Pending'), ...overdueDueDateRange), { count: count() }),
    getAggregateFromServer(query(tasks, where('archived', '==', false), ...assignedTask, where('status', '==', 'Pending'), where('type', '==', 'Follow-up'), ...dueDateRange), { count: count() }),
    getAggregateFromServer(query(tasks, where('archived', '==', false), ...assignedTask, where('status', '==', 'Pending'), where('type', '==', 'Follow-up'), ...overdueDueDateRange), { count: count() }),
    getAggregateFromServer(query(deals, where('archived', '==', false), ...assignedDeal, where('status', '==', 'Won'), ...wonAtRange), { value: sum('value') }),
    getAggregateFromServer(query(deals, where('archived', '==', false), ...assignedDeal, where('stage', 'in', [...OPEN_STAGES]), ...createdAtRange), { count: count(), value: sum('value') }),
    Promise.all(DEAL_STAGES.map((stage) => getAggregateFromServer(
      query(deals, where('archived', '==', false), ...assignedDeal, where('stage', '==', stage)),
      { count: count(), value: sum('value') },
    ))),
  ]);

  const activeDeals = rangePipelineTotals.data().count;
  const pipelineValue = rangePipelineTotals.data().value || 0;

  return {
    totalLeads: leadTotals.data().count,
    activeLeads: activeLeadTotals.data().count,
    convertedLeads: convertedLeadTotals.data().count,
    clients: clientTotals.data().count,
    activeDeals,
    wonDeals: wonDealTotals.data().count,
    lostDeals: lostDealTotals.data().count,
    pendingTasks: pendingTaskTotals.data().count,
    overdueTasks: overdueTaskTotals.data().count,
    pendingFollowUps: pendingFollowUpTotals.data().count,
    overdueFollowUps: overdueFollowUpTotals.data().count,
    pipelineValue,
    salesThisMonth: salesTotals.data().value || 0,
    pipelineByStage: Object.fromEntries(DEAL_STAGES.map((stage, index) => [stage, {
      count: pipelineStageTotals[index].data().count,
      value: pipelineStageTotals[index].data().value || 0,
    }])),
  };
}

export function invalidateDashboardMetrics(organizationId: string) {
  // The organization argument documents the mutation scope; clearing the small dashboard cache
  // globally also prevents a later user switch from observing a prior user's cached metrics.
  void organizationId;
  invalidateCachedRequest('dashboard-metrics:');
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('bsm-dashboard-metrics-invalidated'));
}
