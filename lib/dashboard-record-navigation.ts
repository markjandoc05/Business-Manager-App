import type { Activity } from '@/types';

type DashboardRecordEntity = 'Lead' | 'Client' | 'Deal' | 'Task';

function hasRecordId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Returns only existing Client App record routes. Organization scope is resolved
 * by the active Workspace context and the destination module's own access checks.
 */
export function getDashboardRecordHref(entityType: DashboardRecordEntity, entityId: string) {
  const encodedId = encodeURIComponent(entityId);
  switch (entityType) {
    case 'Lead': return `/leads?leadId=${encodedId}`;
    case 'Client': return `/clients?clientId=${encodedId}`;
    case 'Deal': return `/pipeline?dealId=${encodedId}`;
    case 'Task': return `/tasks?taskId=${encodedId}`;
  }
}

/**
 * Uses persisted structured activity references only. Activity descriptions are
 * intentionally never inspected: legacy or unsupported activity records stay
 * informational rather than guessing a destination.
 */
export function getDashboardActivityHref(activity: Pick<Activity, 'entityType' | 'entityId' | 'metadata'>): string | null {
  if (!hasRecordId(activity.entityId)) return null;

  if (activity.entityType === 'Lead' || activity.entityType === 'Client' || activity.entityType === 'Deal' || activity.entityType === 'Task') {
    return getDashboardRecordHref(activity.entityType, activity.entityId);
  }

  // Notes are nested beneath Clients. A note has no standalone route, but its
  // repository-owned clientId opens the existing Notes context safely.
  if (activity.entityType === 'Note' && hasRecordId(activity.metadata?.clientId)) {
    return `${getDashboardRecordHref('Client', activity.metadata.clientId)}&tab=notes`;
  }

  return null;
}
