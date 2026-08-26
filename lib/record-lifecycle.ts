export type LifecycleEntity = 'Lead' | 'Client';
export type LifecycleAction = 'archive' | 'trash' | 'permanent-delete';
export type LifecycleOutcome = 'ALLOWED' | 'ALLOWED_WITH_WARNING' | 'BLOCKED';

export type LifecycleDependencies = {
  tasks: number;
  taskActivities: number;
  activities: number;
  notes: number;
  documents: number;
  invalidDocuments: number;
  timelineEntries: number;
  activeDeals: number;
  wonDeals: number;
  lostDeals: number;
  convertedClientName?: string;
};

export type LifecycleDecision = {
  outcome: LifecycleOutcome;
  reason: string;
  affectedRecords: Record<string, number>;
  cleanupRecords: Record<string, number>;
  blockingRecords: Record<string, number>;
  preservedRecords: Record<string, number | string>;
  recommendedAction: string;
};

export const emptyLifecycleDependencies: LifecycleDependencies = {
  tasks: 0,
  taskActivities: 0,
  activities: 0,
  notes: 0,
  documents: 0,
  invalidDocuments: 0,
  timelineEntries: 0,
  activeDeals: 0,
  wonDeals: 0,
  lostDeals: 0,
};

function affectedRecords(dependencies: LifecycleDependencies) {
  return Object.fromEntries(
    Object.entries({
      Tasks: dependencies.tasks,
      'Task Activities': dependencies.taskActivities,
      Activities: dependencies.activities,
      Notes: dependencies.notes,
      Documents: dependencies.documents,
      'Invalid Documents': dependencies.invalidDocuments,
      'Active Deals': dependencies.activeDeals,
      'Won Deals': dependencies.wonDeals,
      'Lost Deals': dependencies.lostDeals,
    }).filter(([, count]) => count > 0),
  );
}

function cleanupRecords(dependencies: LifecycleDependencies) {
  return Object.fromEntries(
    Object.entries({
      Tasks: dependencies.tasks,
      'Task Activities': dependencies.taskActivities,
      Notes: dependencies.notes,
      Documents: dependencies.documents,
      'Lead Activity Timeline': Math.max(0, dependencies.timelineEntries - dependencies.notes),
    }).filter(([, count]) => count > 0),
  );
}

function blockingRecords(dependencies: LifecycleDependencies) {
  return Object.fromEntries(
    Object.entries({
      'Active Deals': dependencies.activeDeals,
      'Won Deals': dependencies.wonDeals,
      'Lost Deals': dependencies.lostDeals,
      'Invalid Documents': dependencies.invalidDocuments,
    }).filter(([, count]) => count > 0),
  );
}

function preservedRecords(entity: LifecycleEntity, dependencies: LifecycleDependencies) {
  const preserved: Record<string, number | string> = {};
  if (dependencies.activities > 0) preserved.Activities = dependencies.activities;
  if (entity === 'Lead' && dependencies.convertedClientName) preserved['Converted Client'] = dependencies.convertedClientName;
  return preserved;
}

function decisionDetails(entity: LifecycleEntity, dependencies: LifecycleDependencies) {
  return {
    cleanupRecords: cleanupRecords(dependencies),
    blockingRecords: blockingRecords(dependencies),
    preservedRecords: preservedRecords(entity, dependencies),
  };
}

function hasRecords(records: Record<string, number | string>) {
  return Object.keys(records).length > 0;
}

export function evaluateLifecycle(
  entity: LifecycleEntity,
  action: LifecycleAction,
  dependencies: LifecycleDependencies,
): LifecycleDecision {
  const affected = affectedRecords(dependencies);
  const details = decisionDetails(entity, dependencies);
  const relatedCount = Object.values(affected).reduce((total, count) => total + count, 0) + dependencies.timelineEntries;

  if (action === 'archive') {
    return {
      outcome: relatedCount > 0 ? 'ALLOWED_WITH_WARNING' : 'ALLOWED',
      reason: entity === 'Client'
        ? 'Archiving this Client hides it from active views while preserving its records and sales history.'
        : 'Archiving this Lead hides it from active views while preserving its related records.',
      affectedRecords: affected,
      ...details,
      recommendedAction: 'Restore the record later if it needs to return to active workflows.',
    };
  }

  if (action === 'trash') {
    if (entity === 'Client' && dependencies.activeDeals > 0) {
      return {
        outcome: 'BLOCKED',
        reason: `This Client cannot be moved to Trash because it has ${dependencies.activeDeals} active Deal${dependencies.activeDeals === 1 ? '' : 's'} still linked to it.`,
        affectedRecords: affected,
        ...details,
        recommendedAction: 'Close, reassign, or remove the active Deals first.',
      };
    }
    const convertedWarning = entity === 'Lead' && dependencies.convertedClientName
      ? ` This Lead was converted to Client “${dependencies.convertedClientName}”; that Client and its records will remain unchanged.`
      : '';
    return {
      outcome: relatedCount > 0 || Boolean(convertedWarning) ? 'ALLOWED_WITH_WARNING' : 'ALLOWED',
      reason: `This ${entity} will leave active and archived views but remain recoverable.${convertedWarning}`,
      affectedRecords: affected,
      ...details,
      recommendedAction: 'Restore it from Trash if it is needed again. Related records will be preserved.',
    };
  }

  if (dependencies.invalidDocuments > 0) {
    return {
      outcome: 'BLOCKED',
      reason: `This ${entity} cannot be permanently deleted because ${dependencies.invalidDocuments} Document${dependencies.invalidDocuments === 1 ? '' : 's'} has an invalid stored file reference.`,
      affectedRecords: affected,
      ...details,
      recommendedAction: 'Repair or remove the invalid Document first, then try again.',
    };
  }

  if (entity === 'Client' && dependencies.activeDeals > 0) {
    return {
      outcome: 'BLOCKED',
      reason: `This Client cannot be permanently deleted because it has ${dependencies.activeDeals} active Deal${dependencies.activeDeals === 1 ? '' : 's'} still linked to it.`,
      affectedRecords: affected,
      ...details,
      recommendedAction: 'Close, reassign, or remove the active Deals first.',
    };
  }

  if (entity === 'Client' && (dependencies.wonDeals > 0 || dependencies.lostDeals > 0)) {
    const historicalDeals = dependencies.wonDeals + dependencies.lostDeals;
    return {
      outcome: 'BLOCKED',
      reason: `This Client cannot be permanently deleted because it has ${historicalDeals} historical Won/Lost Deal${historicalDeals === 1 ? '' : 's'} used by sales history and Reports.`,
      affectedRecords: affected,
      ...details,
      recommendedAction: 'Keep the Client in Trash or archive it so the historical Deals remain intact.',
    };
  }

  const convertedWarning = entity === 'Lead' && dependencies.convertedClientName
    ? ` This Lead was converted to Client “${dependencies.convertedClientName}”; the Client and all Client records will remain unchanged.`
    : '';
  const cleanupWarning = hasRecords(details.cleanupRecords)
    ? ` Eligible child records will be removed: ${Object.entries(details.cleanupRecords).map(([label, count]) => `${count} ${label}`).join(', ')}.`
    : '';
  const preservedWarning = hasRecords(details.preservedRecords)
    ? ` Preserved: ${Object.entries(details.preservedRecords).map(([label, value]) => `${label}${typeof value === 'number' ? ` (${value})` : ` “${value}”`}`).join(', ')}.`
    : '';
  return {
    outcome: cleanupWarning || preservedWarning || convertedWarning ? 'ALLOWED_WITH_WARNING' : 'ALLOWED',
    reason: `This ${entity} can be permanently deleted safely.${cleanupWarning}${preservedWarning}`,
    affectedRecords: affected,
    ...details,
    recommendedAction: 'This action cannot be undone.',
  };
}
