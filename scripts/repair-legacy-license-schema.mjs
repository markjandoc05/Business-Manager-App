/*
 * One-time LEGACY license schema repair preparation.
 *
 * Dry-run by default. The --apply path is intentionally guarded by the exact
 * known malformed state, explicit business-supplied subscription dates, and
 * an approved active platform SUPER_ADMIN actor. It changes only the
 * canonical license fields required by the current Client contract, the
 * organization enforcement mirrors/lifecycle status, and one platform audit
 * record. It never changes members or business data.
 */
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { assertMutationSafety, logMutationSafety } from './lib/safety.mjs';

const ORGANIZATION_ID = 'WC6DwK5qdQiFUK5Rw71l';
const ORGANIZATION_SLUG = 'aiph-internal';
const ORGANIZATION_NAME = 'AI.PH Internal';
const REQUIRED_REASON = 'LEGACY_LICENSE_SCHEMA_REPAIR';
const APPLY = process.argv.includes('--apply');

function flag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertSafeEnvironment() {
  if (flag('--org') !== ORGANIZATION_ID) {
    throw new Error(`This repair requires --org ${ORGANIZATION_ID}.`);
  }
  return assertMutationSafety({ apply: APPLY, args: process.argv.slice(2), scope: 'approved legacy license schema repair' });
}

function parseDate(name) {
  const raw = flag(name);
  if (!raw) return null;
  const milliseconds = Date.parse(raw);
  if (!Number.isFinite(milliseconds)) throw new Error(`${name} must be a valid ISO-8601 date.`);
  return new Date(milliseconds);
}

function iso(value) {
  return value instanceof Timestamp ? value.toDate().toISOString() : value == null ? null : String(value);
}

function isMissing(value) {
  return value === undefined || value === null;
}

function expectedMalformedState(organization, license) {
  return Boolean(
    organization.name === ORGANIZATION_NAME
      && organization.slug === ORGANIZATION_SLUG
      && organization.status === 'trial'
      && organization.licenseStatus === 'ACTIVE'
      && organization.licenseWriteEnabled === true
      && isMissing(organization.licenseExpiresAt)
      && license
      && license.plan === 'LEGACY'
      && license.status === 'ACTIVE'
      && license.maxUsers === 3
      && isMissing(license.subscriptionStartedAt)
      && isMissing(license.subscriptionEndsAt),
  );
}

function summarizeLicense(license) {
  return license ? {
    plan: license.plan || null,
    status: license.status || null,
    trialStartedAt: iso(license.trialStartedAt),
    trialEndsAt: iso(license.trialEndsAt),
    subscriptionStartedAt: iso(license.subscriptionStartedAt),
    subscriptionEndsAt: iso(license.subscriptionEndsAt),
    maxUsers: license.maxUsers ?? null,
  } : null;
}

const safety = assertSafeEnvironment();
const PROJECT_ID = safety.projectId;
logMutationSafety(safety);

const subscriptionStartedAt = parseDate('--subscription-started-at');
const subscriptionEndsAt = parseDate('--subscription-ends-at');
if (subscriptionStartedAt && subscriptionEndsAt && subscriptionStartedAt > subscriptionEndsAt) {
  throw new Error('--subscription-started-at must be earlier than --subscription-ends-at.');
}
if (subscriptionEndsAt && subscriptionEndsAt.getTime() <= Date.now()) {
  throw new Error('--subscription-ends-at must be in the future for an ACTIVE license.');
}

const existingApp = getApps()[0];
if (existingApp?.options.projectId && existingApp.options.projectId !== PROJECT_ID) {
  throw new Error(`Existing Firebase Admin app targets ${existingApp.options.projectId}, not ${PROJECT_ID}.`);
}
const app = existingApp || initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
const db = getFirestore(app);
const organizationRef = db.collection('organizations').doc(ORGANIZATION_ID);
const licenseRef = organizationRef.collection('license').doc('current');
const organizationSnapshot = await organizationRef.get();
const licenseSnapshot = await licenseRef.get();
if (!organizationSnapshot.exists) throw new Error(`Organization ${organizationRef.path} does not exist.`);

const organization = organizationSnapshot.data() || {};
const license = licenseSnapshot.exists ? licenseSnapshot.data() : null;
const stateMatches = expectedMalformedState(organization, license);
const conflicts = stateMatches ? [] : ['The exact expected malformed before-state no longer matches; refusing repair.'];
const actorUid = flag('--actor-uid') || null;
const missingInputs = [];
if (!subscriptionStartedAt) missingInputs.push('--subscription-started-at');
if (!subscriptionEndsAt) missingInputs.push('--subscription-ends-at');
if (APPLY && !actorUid) missingInputs.push('--actor-uid');

const proposedCanonical = subscriptionStartedAt && subscriptionEndsAt ? {
  subscriptionStartedAt: subscriptionStartedAt.toISOString(),
  subscriptionEndsAt: subscriptionEndsAt.toISOString(),
  updatedBy: actorUid,
} : {
  subscriptionStartedAt: 'requires explicit business-supplied date',
  subscriptionEndsAt: 'requires explicit business-supplied date',
  updatedBy: APPLY ? 'requires approved actor UID' : 'set only during --apply',
};
const proposedOrganization = subscriptionEndsAt ? {
  status: 'active',
  licenseStatus: 'ACTIVE',
  licenseWriteEnabled: true,
  licenseExpiresAt: subscriptionEndsAt.toISOString(),
} : {
  status: 'active',
  licenseStatus: 'ACTIVE',
  licenseWriteEnabled: true,
  licenseExpiresAt: 'same explicit subscription end date',
};

console.log(JSON.stringify({
  mode: APPLY ? 'apply-requested' : 'dry-run',
  projectId: PROJECT_ID,
  organizationId: ORGANIZATION_ID,
  organizationPath: organizationRef.path,
  licensePath: licenseRef.path,
  beforeStateMatchesExactly: stateMatches,
  before: {
    organization: {
      name: organization.name || null,
      slug: organization.slug || null,
      status: organization.status || null,
      licenseStatus: organization.licenseStatus || null,
      licenseWriteEnabled: organization.licenseWriteEnabled ?? null,
      licenseExpiresAt: iso(organization.licenseExpiresAt),
    },
    canonicalLicense: summarizeLicense(license),
  },
  plannedChanges: {
    canonicalLicense: proposedCanonical,
    organization: proposedOrganization,
    auditPath: 'platformAuditLogs/{generated-id}',
    auditReason: REQUIRED_REASON,
  },
  unchanged: [
    'canonical plan (LEGACY)',
    'canonical status (ACTIVE)',
    'canonical maxUsers (3)',
    'canonical features and createdAt',
    'organization members',
    'all business collections and settings',
  ],
  missingInputs,
  conflicts,
  writesPerformed: 0,
}, null, 2));

if (!stateMatches) throw new Error('Repair stopped because the expected before-state changed.');
if (!APPLY) {
  console.log('Dry run only. Supply explicit dates and --actor-uid, then review before using --apply.');
  process.exit(0);
}
if (missingInputs.length) throw new Error(`Apply requires: ${missingInputs.join(', ')}.`);

const actorSnapshot = await db.collection('platformAdmins').doc(actorUid).get();
const actor = actorSnapshot.data() || {};
if (!actorSnapshot.exists || actor.role !== 'SUPER_ADMIN' || actor.status !== 'ACTIVE') {
  throw new Error('The apply actor must be an active platform SUPER_ADMIN.');
}

const repairedCanonical = {
  subscriptionStartedAt: Timestamp.fromDate(subscriptionStartedAt),
  subscriptionEndsAt: Timestamp.fromDate(subscriptionEndsAt),
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: actorUid,
};
const repairedOrganization = {
  status: 'active',
  licenseStatus: 'ACTIVE',
  licenseWriteEnabled: true,
  licenseExpiresAt: Timestamp.fromDate(subscriptionEndsAt),
  updatedAt: FieldValue.serverTimestamp(),
};
const auditRef = db.collection('platformAuditLogs').doc();

await db.runTransaction(async (transaction) => {
  const latestOrganizationSnapshot = await transaction.get(organizationRef);
  const latestLicenseSnapshot = await transaction.get(licenseRef);
  const latestOrganization = latestOrganizationSnapshot.data() || {};
  const latestLicense = latestLicenseSnapshot.data() || null;
  if (!latestOrganizationSnapshot.exists || !latestLicenseSnapshot.exists || !expectedMalformedState(latestOrganization, latestLicense)) {
    throw new Error('Repair stopped inside transaction because the expected before-state changed.');
  }
  transaction.update(licenseRef, repairedCanonical);
  transaction.update(organizationRef, repairedOrganization);
  transaction.create(auditRef, {
    type: 'LICENSE_REPAIR',
    reason: REQUIRED_REASON,
    organizationId: ORGANIZATION_ID,
    actorUid,
    previousCanonicalLicense: summarizeLicense(latestLicense),
    repairedCanonicalLicense: {
      plan: 'LEGACY',
      status: 'ACTIVE',
      subscriptionStartedAt: subscriptionStartedAt.toISOString(),
      subscriptionEndsAt: subscriptionEndsAt.toISOString(),
      maxUsers: 3,
    },
    createdAt: FieldValue.serverTimestamp(),
  });
});

console.log(JSON.stringify({ mode: 'applied', organizationId: ORGANIZATION_ID, auditPath: auditRef.path, writesPerformed: 3 }, null, 2));
