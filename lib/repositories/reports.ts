import { count, getAggregateFromServer, query, sum, where } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { requireOrganizationAccess } from '@/lib/permissions';
import { organizationCollection } from '@/lib/organizations/paths';
import type { AppUser } from '@/types/auth';

export type ReportData = {
  totalLeads: number;
  qualifiedLeads: number;
  clients: number;
  wonDeals: number;
  lostDeals: number;
  activeDeals: number;
  convertedLeads: number;
  pipelineValue: number;
  totalWonSales: number;
  pipelineByStage: Record<string, number>;
  wonVsLost: { won: number; lost: number };
  leadsBySource: Record<string, number>;
};

export async function loadReportData(user: AppUser | null, organizationId: string, startDate: Date, endDate: Date, stages: string[], sources: string[]) {
  const { membership } = await requireOrganizationAccess(user, organizationId);
  const leads = organizationCollection(db, organizationId, 'leads');
  const clients = organizationCollection(db, organizationId, 'clients');
  const deals = organizationCollection(db, organizationId, 'deals');
  const leadDateRange = [where('archived', '==', false), where('createdAt', '>=', startDate), where('createdAt', '<', endDate)] as const;
  const dealDateRange = [where('archived', '==', false), where('createdAt', '>=', startDate), where('createdAt', '<', endDate)] as const;
  const wonDateRange = [where('archived', '==', false), where('wonAt', '>=', startDate), where('wonAt', '<', endDate)] as const;
  const lostDateRange = [where('archived', '==', false), where('lostAt', '>=', startDate), where('lostAt', '<', endDate)] as const;
  const assignedDeal = membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : [];
  const assignedLead = membership.role === 'USER' ? [where('assignedToUid', '==', user?.uid)] : [];
  const [leadTotals, qualifiedTotals, convertedTotals, clientTotals, wonTotals, lostTotals, activeTotals] = await Promise.all([
    getAggregateFromServer(query(leads, ...leadDateRange, ...assignedLead), { count: count() }),
    getAggregateFromServer(query(leads, ...leadDateRange, ...assignedLead, where('status', 'in', ['Opportunity', 'Client'])), { count: count() }),
    getAggregateFromServer(query(leads, ...leadDateRange, ...assignedLead, where('status', '==', 'Client')), { count: count() }),
    getAggregateFromServer(query(clients, where('archived', '==', false)), { count: count() }),
    getAggregateFromServer(query(deals, ...wonDateRange, ...assignedDeal, where('status', '==', 'Won')), { count: count(), value: sum('value') }),
    getAggregateFromServer(query(deals, ...lostDateRange, ...assignedDeal, where('status', '==', 'Lost')), { count: count(), value: sum('value') }),
    getAggregateFromServer(query(deals, ...dealDateRange, ...assignedDeal, where('status', '==', 'Active')), { count: count(), value: sum('value') }),
  ]);
  const [stageValues, sourceCounts] = await Promise.all([
    Promise.all(stages.map((stage) => {
      if (stage === 'Won') return Promise.resolve(wonTotals);
      if (stage === 'Lost') return Promise.resolve(lostTotals);
      return getAggregateFromServer(query(deals, ...dealDateRange, ...assignedDeal, where('stage', '==', stage)), { value: sum('value') });
    })),
    Promise.all(sources.map((source) => getAggregateFromServer(query(leads, ...leadDateRange, ...assignedLead, where('source', '==', source)), { count: count() }))),
  ]);
  return {
    totalLeads: leadTotals.data().count,
    qualifiedLeads: qualifiedTotals.data().count,
    clients: clientTotals.data().count,
    convertedLeads: convertedTotals.data().count,
    wonDeals: wonTotals.data().count,
    lostDeals: lostTotals.data().count,
    activeDeals: activeTotals.data().count,
    pipelineValue: activeTotals.data().value || 0,
    totalWonSales: wonTotals.data().value || 0,
    pipelineByStage: Object.fromEntries(stages.map((stage, index) => [stage, stageValues[index].data().value || 0])),
    wonVsLost: { won: wonTotals.data().count, lost: lostTotals.data().count },
    leadsBySource: Object.fromEntries(sources.map((source, index) => [source, sourceCounts[index].data().count])),
  } satisfies ReportData;
}
