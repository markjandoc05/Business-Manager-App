import { Timestamp, type Query, type QuerySnapshot } from 'firebase-admin/firestore';
import { adminDb, adminStorageBucket } from '@/lib/server/firebase-admin';
import { evaluateLifecycle, type LifecycleDependencies, type LifecycleDecision, type LifecycleEntity } from '@/lib/record-lifecycle';

export type BulkLifecycleAction = 'archive' | 'trash' | 'restore' | 'permanent-delete';
export type BulkLifecycleResult = {
  id: string;
  ok: boolean;
  decision?: LifecycleDecision;
  error?: string;
};

type CleanupDocument = { documentId: string; storagePath: string };
type CleanupPlan = {
  dependencies: LifecycleDependencies;
  taskQuery?: Query;
  taskActivityQuery?: Query;
  timelineQuery?: Query;
  noteQuery?: Query;
  documentQuery?: Query;
  documents: CleanupDocument[];
};

function countRelatedTasks(snapshot: QuerySnapshot, entity: LifecycleEntity, recordId: string) {
  return snapshot.docs.filter((item) => {
    const related = item.data().relatedTo as { type?: string; id?: string } | undefined;
    return related?.type === entity && related.id === recordId;
  });
}

function countTaskActivities(snapshot: QuerySnapshot, taskIds: Set<string>) {
  return snapshot.docs.filter((item) => typeof item.data().entityId === 'string' && taskIds.has(item.data().entityId as string));
}

export async function buildBulkCleanupPlan(entity: LifecycleEntity, organizationId: string, recordId: string, action: BulkLifecycleAction): Promise<CleanupPlan> {
  const organization = adminDb.doc(`organizations/${organizationId}`);
  if (entity === 'Lead') {
    const lead = await organization.collection('leads').doc(recordId).get();
    if (!lead.exists) throw new Error('NOT_FOUND');
    const data = lead.data() || {};
    const taskQuery = organization.collection('tasks').where('relatedTo.id', '==', recordId);
    const taskActivityQuery = action === 'permanent-delete' ? organization.collection('activities').where('entityType', '==', 'Task') : undefined;
    const timelineQuery = lead.ref.collection('timeline');
    const [timeline, tasks, taskActivities, activities, convertedClient] = await Promise.all([
      timelineQuery.get(),
      taskQuery.get(),
      taskActivityQuery ? taskActivityQuery.get() : Promise.resolve(null),
      organization.collection('activities').where('entityType', '==', 'Lead').where('entityId', '==', recordId).get(),
      typeof data.convertedClientId === 'string' ? organization.collection('clients').doc(data.convertedClientId).get() : Promise.resolve(null),
    ]);
    const relatedTasks = countRelatedTasks(tasks, 'Lead', recordId);
    const relatedTaskActivities = taskActivities ? countTaskActivities(taskActivities, new Set(relatedTasks.map((item) => item.id))) : [];
    return {
      dependencies: {
        tasks: relatedTasks.length,
        taskActivities: relatedTaskActivities.length,
        activities: activities.size,
        notes: timeline.docs.filter((item) => item.data().entryType === 'NOTE').length,
        documents: 0,
        invalidDocuments: 0,
        timelineEntries: timeline.size,
        activeDeals: 0,
        wonDeals: 0,
        lostDeals: 0,
        convertedClientName: convertedClient?.exists && typeof convertedClient.data()?.name === 'string' ? convertedClient.data()?.name : undefined,
      },
      taskQuery,
      ...(taskActivityQuery ? { taskActivityQuery } : {}),
      timelineQuery,
      documents: [],
    };
  }

  const client = await organization.collection('clients').doc(recordId).get();
  if (!client.exists) throw new Error('NOT_FOUND');
  const taskQuery = organization.collection('tasks').where('relatedTo.id', '==', recordId);
  const taskActivityQuery = action === 'permanent-delete' ? organization.collection('activities').where('entityType', '==', 'Task') : undefined;
  const noteQuery = client.ref.collection('notes');
  const documentQuery = client.ref.collection('documents');
  const [deals, tasks, taskActivities, activities, notes, documents] = await Promise.all([
    organization.collection('deals').where('clientId', '==', recordId).get(),
    taskQuery.get(),
    taskActivityQuery ? taskActivityQuery.get() : Promise.resolve(null),
    organization.collection('activities').where('entityType', '==', 'Client').where('entityId', '==', recordId).get(),
    noteQuery.get(),
    documentQuery.get(),
  ]);
  const relatedTasks = countRelatedTasks(tasks, 'Client', recordId);
  const relatedTaskActivities = taskActivities ? countTaskActivities(taskActivities, new Set(relatedTasks.map((item) => item.id))) : [];
  const storagePrefix = `organizations/${organizationId}/clients/${recordId}/documents/`;
  const documentRecords = documents.docs.flatMap((item) => {
    const storagePath = item.data().storagePath;
    const documentPrefix = `${storagePrefix}${item.id}/`;
    return typeof storagePath === 'string' && storagePath.startsWith(documentPrefix) && storagePath.length > documentPrefix.length
      ? [{ documentId: item.id, storagePath }]
      : [];
  });
  return {
    dependencies: {
      tasks: relatedTasks.length,
      taskActivities: relatedTaskActivities.length,
      activities: activities.size,
      notes: notes.size,
      documents: documents.size,
      timelineEntries: 0,
      activeDeals: deals.docs.filter((item) => item.data().archived !== true && item.data().status === 'Active').length,
      wonDeals: deals.docs.filter((item) => item.data().status === 'Won').length,
      lostDeals: deals.docs.filter((item) => item.data().status === 'Lost').length,
      invalidDocuments: documents.size - documentRecords.length,
    },
    taskQuery,
    ...(taskActivityQuery ? { taskActivityQuery } : {}),
    noteQuery,
    documentQuery,
    documents: documentRecords,
  };
}

export async function getBulkLifecycleDecision(entity: LifecycleEntity, organizationId: string, recordId: string, action: BulkLifecycleAction) {
  if (action === 'restore') {
    return {
      outcome: 'ALLOWED',
      reason: `This ${entity} will be restored to the active view.`,
      affectedRecords: {},
      cleanupRecords: {},
      blockingRecords: {},
      preservedRecords: {},
      recommendedAction: 'The record can be restored.',
    } satisfies LifecycleDecision;
  }
  const plan = await buildBulkCleanupPlan(entity, organizationId, recordId, action);
  return evaluateLifecycle(entity, action, plan.dependencies);
}

function isMissingStorageObject(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === 404 || code === '404' || code === 'storage/object-not-found';
}

async function deleteStorageFiles(organizationId: string, clientId: string, documents: CleanupDocument[]) {
  const prefix = `organizations/${organizationId}/clients/${clientId}/documents/`;
  for (const { documentId, storagePath } of documents) {
    const documentPrefix = `${prefix}${documentId}/`;
    if (!storagePath.startsWith(documentPrefix) || storagePath.length <= documentPrefix.length) throw new Error('INVALID_DOCUMENT_REFERENCE');
    try {
      await adminStorageBucket().file(storagePath).delete();
    } catch (error) {
      if (!isMissingStorageObject(error)) throw new Error('STORAGE_DELETE_FAILED');
    }
  }
}

async function cleanupAndDeleteParent(entity: LifecycleEntity, organizationId: string, recordId: string, plan: CleanupPlan) {
  if (plan.documents.length > 0) await deleteStorageFiles(organizationId, recordId, plan.documents);
  const parentRef = adminDb.doc(`organizations/${organizationId}/${entity === 'Lead' ? 'leads' : 'clients'}/${recordId}`);
  await adminDb.runTransaction(async (transaction) => {
    const latest = await transaction.get(parentRef);
    if (!latest.exists || latest.data()?.trashed !== true) throw new Error('RECORD_CHANGED');
    const taskSnapshot = plan.taskQuery ? await transaction.get(plan.taskQuery) : null;
    const taskActivitySnapshot = plan.taskActivityQuery ? await transaction.get(plan.taskActivityQuery) : null;
    const timelineSnapshot = plan.timelineQuery ? await transaction.get(plan.timelineQuery) : null;
    const noteSnapshot = plan.noteQuery ? await transaction.get(plan.noteQuery) : null;
    const documentSnapshot = plan.documentQuery ? await transaction.get(plan.documentQuery) : null;
    const cleanupTasks = taskSnapshot ? countRelatedTasks(taskSnapshot, entity, recordId) : [];
    const cleanupTaskActivities = taskActivitySnapshot ? countTaskActivities(taskActivitySnapshot, new Set(cleanupTasks.map((item) => item.id))) : [];
    if (cleanupTasks.length !== plan.dependencies.tasks
      || cleanupTaskActivities.length !== plan.dependencies.taskActivities
      || (timelineSnapshot && timelineSnapshot.size !== plan.dependencies.timelineEntries)
      || (noteSnapshot && noteSnapshot.size !== plan.dependencies.notes)
      || (documentSnapshot && documentSnapshot.size !== plan.dependencies.documents)) throw new Error('CHILDREN_CHANGED');
    if (documentSnapshot && documentSnapshot.docs.some((item) => !plan.documents.some((document) => document.storagePath === item.data().storagePath))) throw new Error('CHILDREN_CHANGED');
    cleanupTasks.forEach((item) => transaction.delete(item.ref));
    cleanupTaskActivities.forEach((item) => transaction.delete(item.ref));
    timelineSnapshot?.docs.forEach((item) => transaction.delete(item.ref));
    noteSnapshot?.docs.forEach((item) => transaction.delete(item.ref));
    documentSnapshot?.docs.forEach((item) => transaction.delete(item.ref));
    transaction.delete(parentRef);
  });
}

async function updateLifecycleState(entity: LifecycleEntity, organizationId: string, recordId: string, action: BulkLifecycleAction, uid: string) {
  const parentRef = adminDb.doc(`organizations/${organizationId}/${entity === 'Lead' ? 'leads' : 'clients'}/${recordId}`);
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(parentRef);
    if (!snapshot.exists) throw new Error('NOT_FOUND');
    const current = snapshot.data() || {};
    if (action === 'archive' && (current.archived === true || current.trashed === true)) throw new Error('RECORD_STATE');
    if (action === 'trash' && current.trashed === true) throw new Error('RECORD_STATE');
    if (action === 'restore' && current.archived !== true && current.trashed !== true) throw new Error('RECORD_STATE');
    const now = Timestamp.now();
    if (action === 'restore') {
      transaction.update(parentRef, { ...(entity === 'Client' ? { status: 'ACTIVE' } : {}), archived: false, trashed: false, archivedAt: null, archivedBy: null, trashedAt: null, trashedBy: null, updatedAt: now, updatedBy: uid });
    } else if (action === 'archive') {
      transaction.update(parentRef, { ...(entity === 'Client' ? { status: 'ARCHIVED' } : {}), archived: true, trashed: false, archivedAt: now, archivedBy: uid, trashedAt: null, trashedBy: null, updatedAt: now, updatedBy: uid });
    } else if (action === 'trash') {
      transaction.update(parentRef, { ...(entity === 'Client' ? { status: 'ARCHIVED' } : {}), archived: true, trashed: true, trashedAt: now, trashedBy: uid, updatedAt: now, updatedBy: uid });
    }
  });
}

export async function executeBulkLifecycleAction(entity: LifecycleEntity, organizationId: string, action: BulkLifecycleAction, recordIds: string[], uid: string): Promise<BulkLifecycleResult[]> {
  const results: BulkLifecycleResult[] = [];
  for (const id of recordIds) {
    try {
      if (action === 'permanent-delete') {
        const plan = await buildBulkCleanupPlan(entity, organizationId, id, action);
        const decision = evaluateLifecycle(entity, action, plan.dependencies);
        const cleanupCount = Object.values(decision.cleanupRecords).reduce((total, count) => total + count, 0);
        if (decision.outcome === 'BLOCKED') throw new Error(decision.reason);
        if (cleanupCount >= 450) throw new Error('Too many dependent records for one safe operation.');
        await cleanupAndDeleteParent(entity, organizationId, id, plan);
        results.push({ id, ok: true, decision });
      } else {
        const decision = await getBulkLifecycleDecision(entity, organizationId, id, action);
        if (decision.outcome === 'BLOCKED') throw new Error(decision.reason);
        await updateLifecycleState(entity, organizationId, id, action, uid);
        results.push({ id, ok: true, decision });
      }
    } catch (error) {
      const message = error instanceof Error
        ? error.message === 'RECORD_STATE' ? 'The record is no longer in the selected lifecycle view.' : error.message
        : 'The action failed.';
      results.push({ id, ok: false, error: message });
    }
  }
  return results;
}
