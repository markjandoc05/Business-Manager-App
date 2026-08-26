export type ActivityHistoryRecord = {
  entityType?: string;
  entityId?: string;
  metadata?: { clientId?: unknown };
};

export function activityBelongsToClient(activity: ActivityHistoryRecord, clientId: string, sourceLeadId?: string) {
  return (activity.entityType === 'Client' && activity.entityId === clientId)
    || (Boolean(sourceLeadId) && activity.entityType === 'Lead' && activity.entityId === sourceLeadId)
    || activity.metadata?.clientId === clientId;
}
