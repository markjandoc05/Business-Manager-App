/*
 * Dry-run by default. This script only creates missing organization license
 * documents and the small organization-level write-enforcement mirror.
 * It never changes business data, memberships, or existing licenses.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { assertMutationSafety, logMutationSafety } from './lib/safety.mjs';

const apply = process.argv.includes('--apply');
const safety = assertMutationSafety({ apply, scope: 'organization license backfill' });
const projectId = safety.projectId;
logMutationSafety(safety);

const app = initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore(app);
const DEFAULT_LEGACY_MAX_USERS = 3;
const DEFAULT_FEATURES = { crm: true, reports: true, documents: true };

const organizations = await db.collection('organizations').get();
const planned = [];
const warnings = [];
let withLicense = 0;

for (const organizationDoc of organizations.docs) {
  const organization = organizationDoc.data();
  const licenseRef = organizationDoc.ref.collection('license').doc('current');
  const licenseSnapshot = await licenseRef.get();
  if (licenseSnapshot.exists) {
    withLicense += 1;
    continue;
  }

  const membersSnapshot = await organizationDoc.ref.collection('members').get();
  const activeMemberCount = membersSnapshot.docs.filter((member) => member.data().status === 'active').length;
  const maxUsers = Math.max(
    typeof organization.maxUsers === 'number' ? organization.maxUsers : DEFAULT_LEGACY_MAX_USERS,
    activeMemberCount,
    DEFAULT_LEGACY_MAX_USERS,
  );
  planned.push({
    organizationId: organizationDoc.id,
    path: organizationDoc.ref.path,
    name: organization.name || null,
    slug: organization.slug || null,
    memberCount: membersSnapshot.size,
    activeMemberCount,
    license: { plan: 'LEGACY', status: 'ACTIVE', maxUsers, features: DEFAULT_FEATURES },
  });
  if (!organization.slug || !organization.name) warnings.push(`${organizationDoc.ref.path} has incomplete identity fields.`);
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  projectId,
  organizationsScanned: organizations.size,
  organizationsWithLicense: withLicense,
  organizationsMissingLicense: planned.length,
  plannedLicenses: planned,
  warnings,
  conflicts: [],
  businessData: 'unchanged; no leads, clients, deals, tasks, activities, settings, or memberships are modified',
}, null, 2));

if (!apply) {
  console.log('Dry run only. Re-run with --apply after review to create missing LEGACY licenses.');
  process.exit(0);
}

let batch = db.batch();
let writes = 0;
for (const item of planned) {
  const organizationRef = db.collection('organizations').doc(item.organizationId);
  const licenseRef = organizationRef.collection('license').doc('current');
  const latestLicense = await licenseRef.get();
  if (latestLicense.exists) continue;
  const now = FieldValue.serverTimestamp();
  batch.create(licenseRef, {
    plan: 'LEGACY',
    status: 'ACTIVE',
    maxUsers: item.license.maxUsers,
    features: DEFAULT_FEATURES,
    createdAt: now,
    updatedAt: now,
    updatedBy: 'migration:backfill-organization-licenses',
  });
  batch.update(organizationRef, {
    licenseStatus: 'ACTIVE',
    licenseWriteEnabled: true,
    licenseExpiresAt: null,
    updatedAt: now,
  });
  writes += 2;
  if (writes >= 400) {
    await batch.commit();
    batch = db.batch();
    writes = 0;
  }
}
if (writes > 0) await batch.commit();
console.log(`Backfill complete. Created ${planned.length} missing organization licenses.`);
