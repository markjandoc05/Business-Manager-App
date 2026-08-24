export function getDashboardLeadTotal(metrics: { totalLeads: number } | null): number {
  return metrics?.totalLeads ?? 0;
}
