/*
 * Phase 1 bootstrap for the existing BSM installation.
 *
 * Dry-run is the default. Use --apply only after reviewing the printed plan.
 * Requires firebase-admin and Application Default Credentials in the execution environment.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const apply = process.argv.includes('--apply');
const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!projectId) throw new Error('Set GOOGLE_CLOUD_PROJECT, GCLOUD_PROJECT, or NEXT_PUBLIC_FIREBASE_PROJECT_ID.');

const app = initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore(app);
const canonicalSlug = 'aiph-internal';
const legacySlug = 'initial-bsm';
const canonicalName = 'AI.PH Internal';

const usersSnapshot = await db.collection('users').get();
const canonicalOrganizations = await db.collection('organizations').where('slug', '==', canonicalSlug).limit(2).get();
const legacyOrganizations = await db.collection('organizations').where('slug', '==', legacySlug).limit(2).get();
if (canonicalOrganizations.size > 1) throw new Error(`More than one organization uses slug ${canonicalSlug}; stop and resolve this manually.`);
if (legacyOrganizations.size > 1) throw new Error(`More than one organization uses slug ${legacySlug}; stop and resolve this manually.`);
if (!canonicalOrganizations.empty && !legacyOrganizations.empty && canonicalOrganizations.docs[0].id !== legacyOrganizations.docs[0].id) {
  throw new Error(`Organization slug conflict: ${canonicalSlug} and ${legacySlug} refer to different documents. No changes were made.`);
}

const existingOrganization = canonicalOrganizations.docs[0] || legacyOrganizations.docs[0] || null;
const organizationRef = existingOrganization?.ref || db.collection('organizations').doc();
const organization = existingOrganization?.data() || {
  name: canonicalName,
  slug: canonicalSlug,
  businessType: 'Small Business',
  status: 'trial',
  plan: 'trial',
  subscriptionStatus: 'trial',
  maxUsers: Math.max(usersSnapshot.size, 1),
};
const organizationChanges = existingOrganization && (organization.name !== canonicalName || organization.slug !== canonicalSlug)
  ? { name: canonicalName, slug: canonicalSlug }
  : {};

const memberships = [];
for (const userDoc of usersSnapshot.docs) {
  const data = userDoc.data();
  const legacyRole = data.role === 'ADMIN' || data.role === 'MANAGER' || data.role === 'USER' ? data.role : 'USER';
  const membershipRef = organizationRef.collection('members').doc(userDoc.id);
  const membershipSnapshot = await membershipRef.get();
  const membershipData = membershipSnapshot.exists ? membershipSnapshot.data() : null;
  memberships.push({
    userId: userDoc.id,
    role: typeof membershipData?.role === 'string' ? membershipData.role : legacyRole,
    status: typeof membershipData?.status === 'string' ? membershipData.status : data.active === true ? 'active' : 'pending',
    action: membershipSnapshot.exists ? 'preserve existing membership' : 'create membership',
  });
}

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  projectId,
  organizationId: organizationRef.id,
  organization: existingOrganization ? 'existing organization' : 'create organization',
  currentName: existingOrganization?.data().name || null,
  currentSlug: existingOrganization?.data().slug || null,
  proposedIdentity: { name: canonicalName, slug: canonicalSlug },
  organizationChanges,
  users: usersSnapshot.size,
  memberships,
  businessData: 'root collections untouched; no operational data is moved, copied, deleted, or modified',
}, null, 2));

if (!apply) {
  console.log('Dry run only. Re-run with --apply to reconcile the organization identity and create only missing memberships.');
  process.exit(0);
}

const batch = db.batch();
if (!existingOrganization) {
  batch.set(organizationRef, { ...organization, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
} else if (Object.keys(organizationChanges).length > 0) {
  batch.update(organizationRef, { ...organizationChanges, updatedAt: FieldValue.serverTimestamp() });
}

for (const userDoc of usersSnapshot.docs) {
  const data = userDoc.data();
  const membershipRef = organizationRef.collection('members').doc(userDoc.id);
  const membershipSnapshot = await membershipRef.get();
  if (membershipSnapshot.exists) continue;
  const role = data.role === 'ADMIN' || data.role === 'MANAGER' || data.role === 'USER' ? data.role : 'USER';
  batch.set(membershipRef, {
    userId: userDoc.id,
    email: typeof data.email === 'string' ? data.email : '',
    displayName: typeof data.displayName === 'string' ? data.displayName : typeof data.name === 'string' ? data.name : '',
    role,
    status: data.active === true ? 'active' : 'pending',
    joinedAt: FieldValue.serverTimestamp(),
    ...(data.active === true ? { activatedAt: FieldValue.serverTimestamp(), activatedBy: 'bootstrap' } : {}),
  });
}
await batch.commit();
console.log(`Bootstrap complete. Organization: ${organizationRef.id}. Existing business collections were not moved.`);
