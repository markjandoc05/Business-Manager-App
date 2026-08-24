/* Phase 2D: copy persisted Activities and Settings into the active organization. */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { GeoPoint, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { assertMutationSafety, logMutationSafety } from './lib/safety.mjs';

const apply = process.argv.includes('--apply');
const safety = assertMutationSafety({ apply, scope: 'activities and settings organization migration' });
const projectId = safety.projectId;
logMutationSafety(safety);

const app = initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore(app);
const organizations = await db.collection('organizations').where('slug', '==', 'aiph-internal').limit(2).get();
if (organizations.size !== 1) throw new Error(`Expected exactly one organization with slug aiph-internal; found ${organizations.size}.`);
const organization = organizations.docs[0];
console.log(JSON.stringify({ organizationId: organization.id, organizationPath: organization.ref.path }));

function normalize(value) {
  if (value instanceof Timestamp) return { __type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof GeoPoint) return { __type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (value && typeof value.path === 'string' && typeof value.id === 'string') return { __type: 'reference', path: value.path };
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  return value;
}

function sameData(left, right) {
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

const writes = [];
const conflicts = [];
const relationshipIssues = [];
const counts = { activities: 0, settingsFound: 0, creates: 0, skips: 0 };

async function plan(sourceRef, destinationRef, label) {
  const source = await sourceRef.get();
  if (!source.exists) return;
  const destination = await destinationRef.get();
  if (!destination.exists) {
    writes.push({ ref: destinationRef, data: source.data() });
    counts.creates += 1;
  } else if (sameData(source.data(), destination.data())) {
    counts.skips += 1;
  } else {
    conflicts.push(label);
  }
}

async function organizationRecordExists(type, id) {
  const collectionName = `${type.toLowerCase()}s`;
  return (await organization.ref.collection(collectionName).doc(id).get()).exists;
}

const rootActivities = await db.collection('activities').get();
for (const source of rootActivities.docs) {
  counts.activities += 1;
  const data = source.data();
  if (typeof data.createdBy !== 'string' || !(await organization.ref.collection('members').doc(data.createdBy).get()).exists) relationshipIssues.push(`activity:${source.id} creator is not an organization member:${data.createdBy || 'missing'}`);
  if (typeof data.entityType === 'string' && data.entityType !== 'Settings') {
    if (typeof data.entityId !== 'string' || !(await organizationRecordExists(data.entityType, data.entityId))) relationshipIssues.push(`activity:${source.id} references missing organization ${data.entityType}:${data.entityId || 'missing'}`);
  }
  await plan(source.ref, organization.ref.collection('activities').doc(source.id), `activity:${source.id}`);
}

const rootSettings = db.collection('system').doc('settings');
const settingsSnapshot = await rootSettings.get();
if (settingsSnapshot.exists) {
  counts.settingsFound = 1;
  await plan(rootSettings, organization.ref.collection('settings').doc('settings'), 'settings:settings');
}

if (conflicts.length || relationshipIssues.length) {
  console.error(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', organizationId: organization.id, conflicts, relationshipIssues }, null, 2));
  throw new Error(conflicts.length ? 'Destination conflicts found. No conflicting documents were overwritten.' : 'Activity relationships are not ready for organization migration.');
}

if (apply) {
  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    for (const write of writes.slice(index, index + 400)) batch.set(write.ref, write.data);
    await batch.commit();
  }
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  projectId,
  organizationId: organization.id,
  slug: organization.data().slug,
  counts,
  plannedCreates: writes.length,
  conflicts: [],
  relationshipIssues: [],
  reports: 'derived from organization-scoped Leads and Deals; no Reports collection created',
  rootData: 'untouched; no root documents were deleted or modified',
}, null, 2));
if (!apply) console.log('Dry run only. Review the plan, then re-run with --apply to copy only missing destination documents.');
