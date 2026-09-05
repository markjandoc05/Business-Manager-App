export const DASHBOARD_KPI_STORAGE_KEY = 'bsm_dashboard_kpis_v1';
export const MIN_DASHBOARD_KPIS = 3;
export const MAX_DASHBOARD_KPIS = 8;

export type DashboardKpiModule = 'Sales' | 'Deals' | 'Leads' | 'Clients' | 'Tasks';
export type DashboardKpiFormat = 'currency' | 'number' | 'percent';
export type DashboardKpiDateBehavior = 'RANGE' | 'CURRENT_STATE';
export type DashboardKpiId =
  | 'sales.total' | 'sales.transactions' | 'sales.collected' | 'sales.outstanding'
  | 'deals.open' | 'deals.potentialSales' | 'deals.won' | 'deals.lost' | 'deals.winRate'
  | 'leads.total' | 'leads.new' | 'leads.followup'
  | 'clients.total' | 'clients.new'
  | 'tasks.followupsDue' | 'tasks.overdue';

export type DashboardKpiDefinition = {
  id: DashboardKpiId;
  module: DashboardKpiModule;
  label: string;
  description: string;
  cardContext: string;
  icon: LucideIcon;
  format: DashboardKpiFormat;
  dateBehavior: DashboardKpiDateBehavior;
  defaultEnabled: boolean;
  defaultOrder: number;
};

export const KPI_REGISTRY: readonly DashboardKpiDefinition[] = [
  { id: 'sales.total', module: 'Sales', label: 'Sales', description: 'Total value of recorded sales during the selected period.', cardContext: 'Recorded sales value', icon: ReceiptText, format: 'currency', dateBehavior: 'RANGE', defaultEnabled: true, defaultOrder: 6 },
  { id: 'sales.collected', module: 'Sales', label: 'Amount Collected', description: 'Amount recorded as paid from sales during the selected period.', cardContext: 'Recorded as paid', icon: CircleDollarSign, format: 'currency', dateBehavior: 'RANGE', defaultEnabled: false, defaultOrder: 7 },
  { id: 'sales.outstanding', module: 'Sales', label: 'Outstanding Balance', description: 'Total unpaid balance from all active sales.', cardContext: 'Unpaid active sales', icon: CreditCard, format: 'currency', dateBehavior: 'CURRENT_STATE', defaultEnabled: false, defaultOrder: 8 },
  { id: 'sales.transactions', module: 'Sales', label: 'Transactions', description: 'Number of sales transactions recorded during the selected period.', cardContext: 'Recorded sales', icon: ReceiptText, format: 'number', dateBehavior: 'RANGE', defaultEnabled: false, defaultOrder: 7 },
  { id: 'deals.potentialSales', module: 'Deals', label: 'Potential Sales', description: 'Total value of your currently open sales opportunities.', cardContext: 'Total value of open deals', icon: TrendingUp, format: 'currency', dateBehavior: 'CURRENT_STATE', defaultEnabled: true, defaultOrder: 1 },
  { id: 'deals.open', module: 'Deals', label: 'Open Deals', description: 'Number of deals that are still being worked on.', cardContext: 'Deals in progress', icon: Briefcase, format: 'number', dateBehavior: 'CURRENT_STATE', defaultEnabled: true, defaultOrder: 4 },
  { id: 'deals.won', module: 'Deals', label: 'Won Deals', description: 'Number of deals successfully closed during the selected period.', cardContext: 'Successfully closed', icon: Trophy, format: 'number', dateBehavior: 'RANGE', defaultEnabled: false, defaultOrder: 8 },
  { id: 'deals.lost', module: 'Deals', label: 'Lost Deals', description: 'Number of deals marked as lost during the selected period.', cardContext: 'Marked as lost', icon: CircleX, format: 'number', dateBehavior: 'RANGE', defaultEnabled: false, defaultOrder: 9 },
  { id: 'deals.winRate', module: 'Deals', label: 'Win Rate', description: 'Percentage of closed deals that were won during the selected period.', cardContext: 'Closed deals won', icon: Target, format: 'percent', dateBehavior: 'RANGE', defaultEnabled: false, defaultOrder: 10 },
  { id: 'leads.total', module: 'Leads', label: 'Total Leads', description: 'Total number of leads currently recorded in BSM.', cardContext: 'All recorded leads', icon: UsersRound, format: 'number', dateBehavior: 'CURRENT_STATE', defaultEnabled: true, defaultOrder: 2 },
  { id: 'leads.new', module: 'Leads', label: 'New Leads', description: 'Number of new leads added during the selected period.', cardContext: 'Added in this period', icon: UserPlus, format: 'number', dateBehavior: 'RANGE', defaultEnabled: false, defaultOrder: 12 },
  { id: 'leads.followup', module: 'Leads', label: 'Leads Needing Follow-up', description: 'Leads that currently require follow-up or attention.', cardContext: 'Need your attention', icon: PhoneCall, format: 'number', dateBehavior: 'CURRENT_STATE', defaultEnabled: false, defaultOrder: 13 },
  { id: 'clients.total', module: 'Clients', label: 'Total Clients', description: 'Total number of clients currently recorded in BSM.', cardContext: 'All recorded clients', icon: Users, format: 'number', dateBehavior: 'CURRENT_STATE', defaultEnabled: true, defaultOrder: 3 },
  { id: 'clients.new', module: 'Clients', label: 'New Clients', description: 'Number of new clients added during the selected period.', cardContext: 'Added in this period', icon: UserRoundPlus, format: 'number', dateBehavior: 'RANGE', defaultEnabled: false, defaultOrder: 15 },
  { id: 'tasks.followupsDue', module: 'Tasks', label: 'Follow-ups Due', description: 'Follow-ups that currently need your attention.', cardContext: 'Need your attention', icon: Clock, format: 'number', dateBehavior: 'CURRENT_STATE', defaultEnabled: true, defaultOrder: 5 },
  { id: 'tasks.overdue', module: 'Tasks', label: 'Overdue Tasks', description: 'Tasks that have passed their due date and are not yet completed.', cardContext: 'Past due and open', icon: TriangleAlert, format: 'number', dateBehavior: 'CURRENT_STATE', defaultEnabled: false, defaultOrder: 16 },
] as const;

export const DEFAULT_DASHBOARD_KPI_IDS = KPI_REGISTRY.filter((kpi) => kpi.defaultEnabled).sort((a, b) => a.defaultOrder - b.defaultOrder).map((kpi) => kpi.id);
const KNOWN_IDS = new Set<string>(KPI_REGISTRY.map((kpi) => kpi.id));

export function getKpiDefinition(id: string): DashboardKpiDefinition | undefined {
  return KPI_REGISTRY.find((kpi) => kpi.id === id);
}

export function normalizeDashboardKpiIds(value: unknown): DashboardKpiId[] {
  if (!Array.isArray(value)) return [...DEFAULT_DASHBOARD_KPI_IDS];
  const normalized = value.filter((id): id is DashboardKpiId => typeof id === 'string' && KNOWN_IDS.has(id));
  const unique = [...new Set(normalized)].slice(0, MAX_DASHBOARD_KPIS);
  return unique.length >= MIN_DASHBOARD_KPIS ? unique : [...DEFAULT_DASHBOARD_KPI_IDS];
}

export function readDashboardKpiPreference(storage: Pick<Storage, 'getItem'> | null | undefined): DashboardKpiId[] {
  if (!storage) return [...DEFAULT_DASHBOARD_KPI_IDS];
  try { return normalizeDashboardKpiIds(JSON.parse(storage.getItem(DASHBOARD_KPI_STORAGE_KEY) || 'null')); }
  catch { return [...DEFAULT_DASHBOARD_KPI_IDS]; }
}
import type { LucideIcon } from 'lucide-react';
import { Briefcase, CircleDollarSign, CircleX, CreditCard, PhoneCall, ReceiptText, Target, TrendingUp, TriangleAlert, Trophy, UserPlus, UserRoundPlus, Users, UsersRound, Clock } from 'lucide-react';
