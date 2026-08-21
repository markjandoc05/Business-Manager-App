/* Phase 2B: copy Deals and Deal timelines into the active organization without touching root data. */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { GeoPoint, Timestamp, getFirestore } from 'firebase-admin/firestore';

const apply = process.argv.includes('--apply');
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!projectId) throw new Error('Set GOOGLE_CLOUD_PROJECT, GCLOUD_PROJECT, or NEXT_PUBLIC_FIREBASE_PROJECT_ID.');

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
const counts = { deals: 0, timelines: 0, creates: 0, skips: 0 };

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

const rootDeals = await db.collection('deals').get();
for (const source of rootDeals.docs) {
  counts.deals += 1;
  const dealData = source.data();
  const clientId = typeof dealData.clientId === 'string' ? dealData.clientId : '';
  if (!clientId || !(await organization.ref.collection('clients').doc(clientId).get()).exists) relationshipIssues.push(`deal:${source.id} references missing organization client:${clientId || 'empty'}`);
  if (typeof dealData.leadId === 'string' && dealData.leadId && !(await organization.ref.collection('leads').doc(dealData.leadId).get()).exists) relationshipIssues.push(`deal:${source.id} references missing organization lead:${dealData.leadId}`);
  const destination = organization.ref.collection('deals').doc(source.id);
  await plan(source.ref, destination, `deal:${source.id}`);
  const timeline = await source.ref.collection('timeline').get();
  for (const entry of timeline.docs) {
    counts.timelines += 1;
    await plan(entry.ref, destination.collection('timeline').doc(entry.id), `deal-timeline:${source.id}/${entry.id}`);
  }
}

if (conflicts.length || relationshipIssues.length) {
  console.error(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', organizationId: organization.id, conflicts, relationshipIssues }, null, 2));
  throw new Error(conflicts.length ? 'Destination conflicts found. No conflicting documents were overwritten.' : 'Deal relationships are not ready for organization migration. Run the Leads/Clients migration first.');
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
  rootData: 'untouched; no root documents were deleted or modified',
}, null, 2));
if (!apply) console.log('Dry run only. Review the plan, then re-run with --apply to copy only missing destination documents.');
