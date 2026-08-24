/* Phase 2A: copy Leads and Clients into the active organization without touching root data. */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, GeoPoint } from 'firebase-admin/firestore';
import { assertMutationSafety, logMutationSafety } from './lib/safety.mjs';

const apply = process.argv.includes('--apply');
const safety = assertMutationSafety({ apply, scope: 'leads and clients organization migration' });
const projectId = safety.projectId;
logMutationSafety(safety);

const app = initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore();
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

const pendingWrites = [];
const conflicts = [];
const counts = { leads: 0, clients: 0, timelines: 0, notes: 0, documents: 0, creates: 0, skips: 0 };

async function planDocument(sourceRef, destinationRef, label) {
  const source = await sourceRef.get();
  if (!source.exists) return;
  const destination = await destinationRef.get();
  console.log(JSON.stringify({
    projectId,
    databaseId: '(default)',
    organizationPath: organization.ref.path,
    sourcePath: sourceRef.path,
    destinationPath: destinationRef.path,
    destinationExists: destination.exists,
  }));
  if (!destination.exists) {
    pendingWrites.push({ ref: destinationRef, data: source.data() });
    counts.creates += 1;
  } else if (sameData(source.data(), destination.data())) {
    counts.skips += 1;
  } else {
    conflicts.push(label);
  }
}

const [rootLeads, rootClients] = await Promise.all([db.collection('leads').get(), db.collection('clients').get()]);
for (const source of rootLeads.docs) {
  counts.leads += 1;
  await planDocument(source.ref, organization.ref.collection('leads').doc(source.id), `lead:${source.id}`);
  const timeline = await source.ref.collection('timeline').get();
  for (const entry of timeline.docs) {
    counts.timelines += 1;
    await planDocument(entry.ref, organization.ref.collection('leads').doc(source.id).collection('timeline').doc(entry.id), `lead-timeline:${source.id}/${entry.id}`);
  }
}
for (const source of rootClients.docs) {
  counts.clients += 1;
  await planDocument(source.ref, organization.ref.collection('clients').doc(source.id), `client:${source.id}`);
  const clientDestination = organization.ref.collection('clients').doc(source.id);
  for (const [name, countKey] of [['notes', 'notes'], ['documents', 'documents']]) {
    const children = await source.ref.collection(name).get();
    for (const child of children.docs) {
      counts[countKey] += 1;
      await planDocument(child.ref, clientDestination.collection(name).doc(child.id), `client-${name}:${source.id}/${child.id}`);
    }
  }
}

if (conflicts.length) {
  console.error(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', organizationId: organization.id, conflicts }, null, 2));
  throw new Error('Destination conflicts found. No conflicting documents were overwritten.');
}

if (apply) {
  for (let index = 0; index < pendingWrites.length; index += 400) {
    const batch = db.batch();
    for (const write of pendingWrites.slice(index, index + 400)) batch.set(write.ref, write.data);
    await batch.commit();
  }
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  projectId,
  databaseId: '(default)',
  organizationId: organization.id,
  slug: organization.data().slug,
  counts,
  plannedCreates: pendingWrites.length,
  conflicts: [],
  rootData: 'untouched; no root documents were deleted or modified',
}, null, 2));
if (!apply) console.log('Dry run only. Review the plan, then re-run with --apply to copy only missing destination documents.');
