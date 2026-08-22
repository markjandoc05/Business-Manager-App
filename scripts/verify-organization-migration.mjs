/* Read-only verification for the organization migration. This script never writes Firestore. */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'bsm-client-app-web';
const organizationIdOverride = process.env.BSM_ORGANIZATION_ID;
const canonicalSlug = 'aiph-internal';
const app = initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore(app);

function status(ok, warning = false) {
  return ok ? 'PASS' : warning ? 'WARNING' : 'FAIL';
}

function recordPath(organization, collectionName, id) {
  return organization.ref.collection(collectionName).doc(id);
}

function relationKey(type, id) {
  return `${type}:${id}`;
}

function isObject(value) {
  return value !== null && typeof value === 'object';
}

try {
  const organizationSnapshot = organizationIdOverride
    ? await db.collection('organizations').doc(organizationIdOverride).get()
    : (await db.collection('organizations').where('slug', '==', canonicalSlug).limit(2).get());

  const organization = organizationIdOverride
    ? organizationSnapshot
    : organizationSnapshot.docs[0];
  const organizationMatches = organizationIdOverride ? (organization.exists ? 1 : 0) : organizationSnapshot.size;
  if (organizationMatches !== 1) throw new Error(`Expected exactly one organization to verify; found ${organizationMatches}.`);
  console.log(JSON.stringify({ organizationId: organization.id, organizationPath: organization.ref.path, projectId, databaseId: '(default)' }));

  const collectionNames = ['leads', 'clients', 'deals', 'tasks', 'activities'];
  const rootCollections = Object.fromEntries(await Promise.all(collectionNames.map(async (name) => [name, await db.collection(name).get()])));
  const organizationCollections = Object.fromEntries(await Promise.all(collectionNames.map(async (name) => [name, await organization.ref.collection(name).get()])));
  const missingDocuments = Object.fromEntries(collectionNames.map((name) => [name, []]));
  for (const name of collectionNames) {
    const organizationIds = new Set(organizationCollections[name].docs.map((doc) => doc.id));
    for (const source of rootCollections[name].docs) if (!organizationIds.has(source.id)) missingDocuments[name].push(source.id);
  }

  const countComparison = collectionNames.map((name) => ({
    collection: name,
    legacy: rootCollections[name].size,
    organization: organizationCollections[name].size,
    missing: missingDocuments[name].length,
    status: status(missingDocuments[name].length === 0),
  }));

  const orgLeads = organizationCollections.leads.docs;
  const orgClients = organizationCollections.clients.docs;
  const orgDeals = organizationCollections.deals.docs;
  const orgTasks = organizationCollections.tasks.docs;
  const orgActivities = organizationCollections.activities.docs;
  const relationships = {
    leadToClient: { valid: [], missingClient: [], mismatchedSourceLead: [] },
    clientToLead: { valid: [], missingLead: [] },
    dealToClient: { valid: [], invalid: [] },
    dealToLead: { valid: [], invalid: [] },
    taskToEntity: { valid: [], invalid: [] },
    taskToMember: { valid: [], invalid: [] },
    activityReferences: { valid: [], invalid: [] },
  };

  const leadById = new Map(orgLeads.map((item) => [item.id, item.data()]));
  const clientById = new Map(orgClients.map((item) => [item.id, item.data()]));
  const dealById = new Map(orgDeals.map((item) => [item.id, item.data()]));
  const taskById = new Map(orgTasks.map((item) => [item.id, item.data()]));

  for (const lead of orgLeads) {
    const data = lead.data();
    if (typeof data.convertedClientId === 'string' && data.convertedClientId) {
      const client = clientById.get(data.convertedClientId);
      if (!client) relationships.leadToClient.missingClient.push({ leadId: lead.id, clientId: data.convertedClientId });
      else if (client.sourceLeadId && client.sourceLeadId !== lead.id) relationships.leadToClient.mismatchedSourceLead.push({ leadId: lead.id, clientId: data.convertedClientId, sourceLeadId: client.sourceLeadId });
      else relationships.leadToClient.valid.push({ leadId: lead.id, clientId: data.convertedClientId });
    }
  }

  for (const client of orgClients) {
    const data = client.data();
    if (typeof data.sourceLeadId === 'string' && data.sourceLeadId) {
      if (leadById.has(data.sourceLeadId)) relationships.clientToLead.valid.push({ clientId: client.id, leadId: data.sourceLeadId });
      else relationships.clientToLead.missingLead.push({ clientId: client.id, leadId: data.sourceLeadId });
    }
  }

  for (const deal of orgDeals) {
    const data = deal.data();
    if (typeof data.clientId !== 'string' || !clientById.has(data.clientId)) relationships.dealToClient.invalid.push({ dealId: deal.id, clientId: data.clientId || null });
    else relationships.dealToClient.valid.push({ dealId: deal.id, clientId: data.clientId });
    if (typeof data.leadId === 'string' && data.leadId) {
      if (leadById.has(data.leadId)) relationships.dealToLead.valid.push({ dealId: deal.id, leadId: data.leadId });
      else relationships.dealToLead.invalid.push({ dealId: deal.id, leadId: data.leadId });
    }
  }

  const memberSnapshot = await organization.ref.collection('members').get();
  const memberIds = new Set(memberSnapshot.docs.filter((item) => item.data().status === 'active').map((item) => item.id));
  for (const task of orgTasks) {
    const data = task.data();
    if (typeof data.assignedToUid === 'string' && data.assignedToUid) {
      if (memberIds.has(data.assignedToUid)) relationships.taskToMember.valid.push({ taskId: task.id, uid: data.assignedToUid });
      else relationships.taskToMember.invalid.push({ taskId: task.id, uid: data.assignedToUid });
    }
    if (isObject(data.relatedTo) && typeof data.relatedTo.type === 'string' && typeof data.relatedTo.id === 'string') {
      const target = data.relatedTo.type === 'Lead' ? leadById : data.relatedTo.type === 'Client' ? clientById : data.relatedTo.type === 'Deal' ? dealById : null;
      if (target?.has(data.relatedTo.id)) relationships.taskToEntity.valid.push({ taskId: task.id, relatedTo: data.relatedTo });
      else relationships.taskToEntity.invalid.push({ taskId: task.id, relatedTo: data.relatedTo });
    }
  }

  for (const activity of orgActivities) {
    const data = activity.data();
    const creatorValid = typeof data.createdBy === 'string' && memberIds.has(data.createdBy);
    const type = data.entityType;
    const id = data.entityId;
    const target = type === 'Lead' ? leadById : type === 'Client' ? clientById : type === 'Deal' ? dealById : type === 'Task' ? taskById : type === 'Settings' ? new Map([['settings', {}]]) : null;
    const entitylessSettingsActivity = type === 'Settings' && (id === null || id === undefined || id === '');
    if (creatorValid && (!type || entitylessSettingsActivity || (typeof id === 'string' && target?.has(id)))) relationships.activityReferences.valid.push({ activityId: activity.id });
    else relationships.activityReferences.invalid.push({ activityId: activity.id, entityType: type || null, entityId: id || null, createdBy: data.createdBy || null });
  }

  const settingsLegacy = await db.collection('system').doc('settings').get();
  const settingsOrganization = await organization.ref.collection('settings').doc('settings').get();
  const requiredSettings = ['businessName', 'businessType', 'currency', 'timezone', 'pipelineStages', 'leadSources'];
  const missingSettings = requiredSettings.filter((key) => !settingsOrganization.exists || settingsOrganization.data()?.[key] === undefined || settingsOrganization.data()?.[key] === null);
  const settingsValidation = {
    legacyExists: settingsLegacy.exists,
    organizationExists: settingsOrganization.exists,
    missingRequiredValues: missingSettings,
    status: status(settingsOrganization.exists && missingSettings.length === 0),
  };

  const timelineValidation = { leadTimelineEntries: 0, dealTimelineEntries: 0, status: 'PASS' };
  for (const lead of orgLeads) {
    const timeline = await lead.ref.collection('timeline').get();
    timelineValidation.leadTimelineEntries += timeline.size;
  }
  for (const deal of orgDeals) {
    const timeline = await deal.ref.collection('timeline').get();
    timelineValidation.dealTimelineEntries += timeline.size;
  }

  const relationshipFailureCount = Object.values(relationships).reduce((total, group) => total + Object.entries(group).filter(([key]) => key !== 'valid').reduce((count, [, values]) => count + values.length, 0), 0);
  const relationshipCategories = {
    'Lead → Client': relationships.leadToClient.missingClient.length + relationships.leadToClient.mismatchedSourceLead.length,
    'Client → Lead': relationships.clientToLead.missingLead.length,
    'Deal → Client': relationships.dealToClient.invalid.length,
    'Deal → Lead': relationships.dealToLead.invalid.length,
    'Task → Lead': relationships.taskToEntity.invalid.filter((item) => item.relatedTo?.type === 'Lead').length,
    'Task → Client': relationships.taskToEntity.invalid.filter((item) => item.relatedTo?.type === 'Client').length,
    'Task → Deal': relationships.taskToEntity.invalid.filter((item) => item.relatedTo?.type === 'Deal').length,
    'Task → Member': relationships.taskToMember.invalid.length,
    'Activity → Lead': relationships.activityReferences.invalid.filter((item) => item.entityType === 'Lead').length,
    'Activity → Client': relationships.activityReferences.invalid.filter((item) => item.entityType === 'Client').length,
    'Activity → Deal': relationships.activityReferences.invalid.filter((item) => item.entityType === 'Deal').length,
    'Activity → Task': relationships.activityReferences.invalid.filter((item) => item.entityType === 'Task').length,
    'Activity → Member/User': relationships.activityReferences.invalid.filter((item) => !item.entityType || item.entityType === 'Settings').length,
    Other: relationships.taskToEntity.invalid.filter((item) => !['Lead', 'Client', 'Deal'].includes(item.relatedTo?.type)).length,
  };
  const hasFailures = countComparison.some((item) => item.status === 'FAIL')
    || Object.values(relationships).some((group) => Object.entries(group).some(([key, values]) => key !== 'valid' && Array.isArray(values) && values.length > 0))
    || settingsValidation.status === 'FAIL';

  console.log(JSON.stringify({
    verification: 'MIGRATION VERIFICATION',
    organization: { id: organization.id, path: organization.ref.path },
    countComparison,
    missingDocuments,
    relationships,
    relationshipCategories,
    settingsValidation,
    timelineValidation,
    relationshipFailureCount,
    decision: hasFailures ? 'NOT SAFE FOR LEGACY CLEANUP' : 'SAFE FOR LEGACY CLEANUP',
    readOnly: true,
  }, null, 2));
  if (hasFailures) process.exitCode = 2;
} catch (error) {
  console.error(`Read-only verification could not complete: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Required credentials: Firebase Admin Application Default Credentials for project bsm-client-app-web, or an equivalent GOOGLE_APPLICATION_CREDENTIALS service-account configuration.');
  process.exitCode = 1;
}
