/* Conflict-safe organization migration repair planner. Dry-run by default; --apply is required to write. */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const apply = process.argv.includes('--apply');
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'bsm-client-app-web';
const app = initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore(app);
const collections = ['leads', 'clients', 'deals', 'tasks', 'activities'];
const pending = [];
const conflicts = [];
const unresolved = [];
const canonicalPipelineStages = [
  { name: 'Opportunity', isActive: true },
  { name: 'Qualified', isActive: true },
  { name: 'Proposal', isActive: true },
  { name: 'Negotiation', isActive: true },
  { name: 'Won', isActive: true },
  { name: 'Lost', isActive: true },
];

function isValidPipelineStages(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every((stage) => stage && typeof stage.name === 'string' && stage.name.trim() && typeof stage.isActive === 'boolean');
}

const organizations = await db.collection('organizations').where('slug', '==', 'aiph-internal').limit(2).get();
if (organizations.size !== 1) throw new Error(`Expected exactly one organization with slug aiph-internal; found ${organizations.size}.`);
const organization = organizations.docs[0];
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', projectId, databaseId: '(default)', organizationId: organization.id, organizationPath: organization.ref.path }));

async function planCopy(sourceRef, destinationRef, label) {
  const [source, destination] = await Promise.all([sourceRef.get(), destinationRef.get()]);
  if (!source.exists) return;
  if (!destination.exists) pending.push({ ref: destinationRef, data: source.data(), label });
  else conflicts.push(label);
}

const roots = Object.fromEntries(await Promise.all(collections.map(async (name) => [name, await db.collection(name).get()])));
const destinations = Object.fromEntries(await Promise.all(collections.map(async (name) => [name, await organization.ref.collection(name).get()])));
const destinationIds = Object.fromEntries(collections.map((name) => [name, new Set(destinations[name].docs.map((item) => item.id))]));

for (const name of collections) {
  for (const source of roots[name].docs) {
    if (!destinationIds[name].has(source.id)) {
      await planCopy(source.ref, organization.ref.collection(name).doc(source.id), `${name}:${source.id}`);
      if (name === 'leads' || name === 'deals') {
        const timeline = await source.ref.collection('timeline').get();
        for (const entry of timeline.docs) {
          await planCopy(entry.ref, organization.ref.collection(name).doc(source.id).collection('timeline').doc(entry.id), `${name}-timeline:${source.id}/${entry.id}`);
        }
      }
      if (name === 'clients') {
        for (const childName of ['notes', 'documents']) {
          const children = await source.ref.collection(childName).get();
          for (const child of children.docs) await planCopy(child.ref, organization.ref.collection(name).doc(source.id).collection(childName).doc(child.id), `client-${childName}:${source.id}/${child.id}`);
        }
      }
    }
  }
}

const legacySettings = await db.collection('system').doc('settings').get();
const organizationSettingsRef = organization.ref.collection('settings').doc('settings');
const organizationSettings = await organizationSettingsRef.get();
const legacyPipelineStages = legacySettings.exists ? legacySettings.data()?.pipelineStages : undefined;
const organizationSettingsData = organizationSettings.exists ? organizationSettings.data() : undefined;
const organizationHasPipelineStages = organizationSettingsData?.pipelineStages !== undefined && organizationSettingsData?.pipelineStages !== null;
if (!organizationSettings.exists) {
  unresolved.push('organization settings document is missing');
} else if (isValidPipelineStages(organizationSettingsData.pipelineStages)) {
  // Preserve an existing valid organization value.
} else if (organizationHasPipelineStages) {
  unresolved.push('organization pipelineStages exists but is invalid; no overwrite planned');
} else {
  const fallback = isValidPipelineStages(legacyPipelineStages)
    ? { source: 'legacy', value: legacyPipelineStages }
    : { source: 'canonical-default', value: canonicalPipelineStages };
  pending.push({
    ref: organizationSettingsRef,
    update: { pipelineStages: fallback.value },
    backfill: { field: 'pipelineStages', source: fallback.source, value: fallback.value },
    label: 'settings:settings.pipelineStages',
  });
}

const rootIds = Object.fromEntries(collections.map((name) => [name, new Set(roots[name].docs.map((item) => item.id))]));
for (const source of roots.deals.docs) {
  const data = source.data();
  if (typeof data.clientId === 'string' && !destinationIds.clients.has(data.clientId) && !rootIds.clients.has(data.clientId)) unresolved.push(`deal:${source.id} client:${data.clientId}`);
  if (typeof data.leadId === 'string' && data.leadId && !destinationIds.leads.has(data.leadId) && !rootIds.leads.has(data.leadId)) unresolved.push(`deal:${source.id} lead:${data.leadId}`);
}
for (const source of roots.tasks.docs) {
  const related = source.data().relatedTo;
  if (related?.id && !destinationIds[`${String(related.type).toLowerCase()}s`]?.has(related.id) && !rootIds[`${String(related.type).toLowerCase()}s`]?.has(related.id)) unresolved.push(`task:${source.id} ${related.type}:${related.id}`);
}

if (conflicts.length) throw new Error(`Destination conflicts found: ${conflicts.join(', ')}`);
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', plannedCopies: pending.filter((item) => item.data).map((item) => item.label), plannedBackfills: pending.filter((item) => item.backfill).map((item) => item.backfill), unresolved, conflicts: [], readOnly: !apply }, null, 2));

if (apply) {
  for (const item of pending) {
    if (item.update) {
      const latest = await item.ref.get();
      if (!latest.exists || latest.data()?.pipelineStages === undefined) await item.ref.update(item.update);
    }
    else await item.ref.create(item.data);
  }
  console.log(JSON.stringify({ applied: pending.length, conflicts: [] }));
} else {
  console.log('Dry run only. No Firestore documents were written.');
}
