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
  pipelineValue: number;
  salesThisMonth: number;
  pipelineByStage: Record<string, { count: number; value: number }>;
};

export async function loadDashboardMetrics(user: AppUser | null, organizationId: string, now = new Date()): Promise<DashboardMetrics> {
  const cacheKey = `dashboard-metrics:${user?.uid || 'anonymous'}:${organizationId}:${now.getFullYear()}-${now.getMonth()}`;
  return cachedRequest(cacheKey, 60_000, () => loadDashboardMetricsUncached(user, organizationId, now));
}

async function loadDashboardMetricsUncached(user: AppUser | null, organizationId: string, now: Date): Promise<DashboardMetrics> {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const leads = organizationCollection(db, organizationId, 'leads');
  const clients = organizationCollection(db, organizationId, 'clients');
  const deals = organizationCollection(db, organizationId, 'deals');
  const tasks = organizationCollection(db, organizationId, 'tasks');
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const assignedDeal = membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : [];
  const assignedTask = membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : [];
  const assignedLead = membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : [];

  const [leadTotals, activeLeadTotals, convertedLeadTotals, clientTotals, wonDealTotals, lostDealTotals, pendingTaskTotals, overdueTaskTotals, salesTotals, pipelineStageTotals] = await Promise.all([
    getAggregateFromServer(query(leads, where('archived', '==', false), ...assignedLead), { count: count() }),
    getAggregateFromServer(query(leads, where('archived', '==', false), ...assignedLead, where('status', 'in', ['New', 'Follow-up', 'Opportunity'])), { count: count() }),
    getAggregateFromServer(query(leads, where('archived', '==', false), ...assignedLead, where('status', '==', 'Client')), { count: count() }),
    getAggregateFromServer(query(clients, where('archived', '==', false)), { count: count() }),
    getAggregateFromServer(query(deals, where('archived', '==', false), ...assignedDeal, where('status', '==', 'Won')), { count: count() }),
    getAggregateFromServer(query(deals, where('archived', '==', false), ...assignedDeal, where('status', '==', 'Lost')), { count: count() }),
    getAggregateFromServer(query(tasks, where('archived', '==', false), ...assignedTask, where('status', '==', 'Pending')), { count: count() }),
    getAggregateFromServer(query(tasks, where('archived', '==', false), ...assignedTask, where('status', '==', 'Pending'), where('dueDate', '<=', now)), { count: count() }),
    getAggregateFromServer(query(deals, where('archived', '==', false), ...assignedDeal, where('status', '==', 'Won'), where('wonAt', '>=', monthStart), where('wonAt', '<', nextMonth)), { value: sum('value') }),
    Promise.all(DEAL_STAGES.map((stage) => getAggregateFromServer(
      query(deals, where('archived', '==', false), ...assignedDeal, where('stage', '==', stage)),
      { count: count(), value: sum('value') },
    ))),
  ]);

  const openPipeline = pipelineStageTotals.slice(0, OPEN_STAGES.length);
  const activeDeals = openPipeline.reduce((total, result) => total + result.data().count, 0);
  const pipelineValue = openPipeline.reduce((total, result) => total + (result.data().value || 0), 0);

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
}
