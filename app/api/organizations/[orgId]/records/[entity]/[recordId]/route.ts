import { NextRequest, NextResponse } from 'next/server';
import { Timestamp, type Query, type QuerySnapshot } from 'firebase-admin/firestore';
import { adminDb, adminStorageBucket } from '@/lib/server/firebase-admin';
import { getAuthenticatedUser, isApplicationUserActive } from '@/lib/server/auth';
import { evaluateLifecycle, type LifecycleAction, type LifecycleDependencies, type LifecycleEntity } from '@/lib/record-lifecycle';

export const runtime = 'nodejs';

function response(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function validId(value: string) {
  return Boolean(value) && value.length <= 128 && !value.includes('/');
}

function normalizeEntity(value: string): LifecycleEntity | null {
  return value.toLowerCase() === 'lead' ? 'Lead' : value.toLowerCase() === 'client' ? 'Client' : null;
}

function normalizeAction(value: string | null): LifecycleAction | null {
  return value === 'archive' || value === 'trash' || value === 'permanent-delete' ? value : null;
}

function organizationDataMatchesLicense(organization: Record<string, unknown>, license: Record<string, unknown>, licenseExpiry: Timestamp) {
  return organization.licenseStatus === license.status
    && organization.licenseExpiresAt instanceof Timestamp
    && organization.licenseExpiresAt.toMillis() === licenseExpiry.toMillis()
    && ((license.status === 'TRIAL' && organization.status === 'trial')
      || (license.status === 'ACTIVE' && organization.status === 'active'));
}

function writableLicense(organization: Record<string, unknown>, license: Record<string, unknown>) {
  const organizationExpiry = organization.licenseExpiresAt;
  const licenseExpiry = license.status === 'TRIAL' ? license.trialEndsAt : license.subscriptionEndsAt;
  return ['trial', 'active'].includes(String(organization.status))
    && organization.licenseWriteEnabled === true
    && ['TRIAL', 'ACTIVE'].includes(String(organization.licenseStatus))
    && organizationExpiry instanceof Timestamp
    && organizationExpiry.toMillis() >= Date.now()
    && ['TRIAL', 'SOLO', 'STARTER', 'TEAM', 'LEGACY'].includes(String(license.plan))
    && ['TRIAL', 'ACTIVE'].includes(String(license.status))
    && Number.isInteger(license.maxUsers)
    && (license.maxUsers as number) >= 1
    && licenseExpiry instanceof Timestamp
    && licenseExpiry.toMillis() >= Date.now()
    && organizationDataMatchesLicense(organization, license, licenseExpiry);
}

function countRelatedTasks(snapshot: QuerySnapshot, entity: LifecycleEntity, recordId: string) {
  return snapshot.docs.filter((item) => {
    const related = item.data().relatedTo as { type?: string; id?: string } | undefined;
    return related?.type === entity && related.id === recordId;
  });
}

function countTaskActivities(snapshot: QuerySnapshot, taskIds: Set<string>) {
  return snapshot.docs.filter((item) => typeof item.data().entityId === 'string' && taskIds.has(item.data().entityId as string));
}

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

async function buildCleanupPlan(entity: LifecycleEntity, organizationId: string, recordId: string, action: LifecycleAction): Promise<CleanupPlan> {
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
  const invalidDocumentCount = documents.docs.length - documentRecords.length;
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
      invalidDocuments: invalidDocumentCount,
    },
    taskQuery,
    ...(taskActivityQuery ? { taskActivityQuery } : {}),
    noteQuery,
    documentQuery,
    documents: documentRecords.map(({ documentId, storagePath }) => ({ documentId, storagePath })),
  };
}

async function getAuthorizedMembership(organizationId: string, uid: string) {
  const organization = adminDb.doc(`organizations/${organizationId}`);
  const [organizationSnapshot, membershipSnapshot] = await Promise.all([
    organization.get(),
    organization.collection('members').doc(uid).get(),
  ]);
  const membership = membershipSnapshot.data() || {};
  if (!organizationSnapshot.exists || !membershipSnapshot.exists || membership.userId !== uid || membership.status !== 'active') return null;
  return { organization, organizationSnapshot, membership };
}

async function getDecision(entity: LifecycleEntity, organizationId: string, recordId: string, action: LifecycleAction) {
  const plan = await buildCleanupPlan(entity, organizationId, recordId, action);
  return { plan, decision: evaluateLifecycle(entity, action, plan.dependencies) };
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
  try {
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
  } catch (error) {
    if (error instanceof Error && error.message === 'RECORD_CHANGED') throw new Error('The record changed before deletion. Refresh and try again.');
    if (error instanceof Error && error.message === 'CHILDREN_CHANGED') throw new Error('Related records changed before deletion. Refresh and try again.');
    throw error;
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ orgId: string; entity: string; recordId: string }> }) {
  const authenticatedUser = await getAuthenticatedUser(request);
  if (!authenticatedUser) return response(401, { error: 'Authentication is required.' });
  const { uid } = authenticatedUser;
  if (!await isApplicationUserActive(uid)) return response(403, { error: 'Your BSM account is not active.' });
  const { orgId, entity: rawEntity, recordId } = await context.params;
  const entity = normalizeEntity(rawEntity);
  const action = normalizeAction(new URL(request.url).searchParams.get('action'));
  if (!validId(orgId) || !validId(recordId) || !entity || !action) return response(400, { error: 'Invalid lifecycle preview request.' });
  if (!await getAuthorizedMembership(orgId, uid)) return response(403, { error: 'You are not allowed to inspect this record lifecycle.' });
  try {
    const { decision } = await getDecision(entity, orgId, recordId, action);
    return NextResponse.json({ ok: true, entity, recordId, action, decision });
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_FOUND') return response(404, { error: `The ${entity.toLowerCase()} could not be found.` });
    return response(500, { error: 'Unable to evaluate this lifecycle action.' });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ orgId: string; entity: string; recordId: string }> }) {
  const authenticatedUser = await getAuthenticatedUser(request);
  if (!authenticatedUser) return response(401, { error: 'Authentication is required.' });
  const { uid } = authenticatedUser;
  if (!await isApplicationUserActive(uid)) return response(403, { error: 'Your BSM account is not active.' });
  const { orgId, entity: rawEntity, recordId } = await context.params;
  const entity = normalizeEntity(rawEntity);
  if (!validId(orgId) || !validId(recordId) || !entity) return response(400, { error: 'Invalid record request.' });

  const authorization = await getAuthorizedMembership(orgId, uid);
  if (!authorization || !['ADMIN', 'MANAGER'].includes(String(authorization.membership.role))) return response(403, { error: 'You are not allowed to permanently delete this record.' });
  const organization = authorization.organization;
  const licenseSnapshot = await organization.collection('license').doc('current').get();
  if (!writableLicense(authorization.organizationSnapshot.data() || {}, licenseSnapshot.data() || {})) {
    return response(409, { error: 'Permanent deletion is unavailable for the current workspace license.' });
  }

  const parentRef = organization.collection(entity === 'Lead' ? 'leads' : 'clients').doc(recordId);
  const parentSnapshot = await parentRef.get();
  if (!parentSnapshot.exists) return response(404, { error: `The ${entity.toLowerCase()} could not be found.` });
  if (parentSnapshot.data()?.trashed !== true) return response(409, { error: `Only Trashed ${entity.toLowerCase()} records can be permanently deleted.` });

  try {
    const { plan, decision } = await getDecision(entity, orgId, recordId, 'permanent-delete');
    if (decision.outcome === 'BLOCKED') return response(409, { error: 'Permanent deletion is blocked.', reason: decision.reason, affectedRecords: decision.affectedRecords, blockingRecords: decision.blockingRecords, preservedRecords: decision.preservedRecords, cleanupRecords: decision.cleanupRecords, recommendedAction: decision.recommendedAction });
    const cleanupCount = Object.values(decision.cleanupRecords).reduce((total, count) => total + count, 0);
    if (cleanupCount >= 450) return response(409, { error: 'Permanent deletion is blocked because it has too many dependent records for one safe operation.', recommendedAction: 'Remove eligible child records individually, then try again.' });
    await cleanupAndDeleteParent(entity, orgId, recordId, plan);
    return NextResponse.json({ ok: true, decision });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_DOCUMENT_REFERENCE') return response(409, { error: 'Permanent deletion is blocked because a document has an invalid stored file reference.', recommendedAction: 'Repair or remove the document individually, then try again.' });
    if (error instanceof Error && error.message === 'STORAGE_DELETE_FAILED') return response(502, { error: 'Unable to delete a stored document file. No success was reported; please try again.' });
    if (error instanceof Error && (error.message.includes('changed before deletion') || error.message.includes('Related records changed'))) return response(409, { error: error.message });
    console.error('Permanent record deletion failed', { organizationId: orgId, entity, recordId, error: error instanceof Error ? error.message : error });
    return response(500, { error: 'Unable to permanently delete this record. No success was reported.' });
  }
}
