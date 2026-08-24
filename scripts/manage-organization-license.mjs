/*
 * Read-only license inspection tool.
 *
 * License mutations belong to the Console platform-admin API. This script is
 * intentionally limited to reads so a local operator cannot bypass that
 * authorization, transaction, mirror, and audit-log path.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const [, , command = 'show', ...args] = process.argv;
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

if (command !== 'show') throw new Error('This tool is read-only. Use the Console platform-admin API for license changes.');
if (args.includes('--apply')) throw new Error('This tool never applies license changes.');

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!projectId) throw new Error('Set GOOGLE_CLOUD_PROJECT, GCLOUD_PROJECT, or NEXT_PUBLIC_FIREBASE_PROJECT_ID.');
const app = initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore(app);

const orgSelector = value('--org');
if (!orgSelector) throw new Error('Use --org <organization ID or exact slug>.');
const byId = await db.collection('organizations').doc(orgSelector).get();
const matches = byId.exists ? [byId] : (await db.collection('organizations').where('slug', '==', orgSelector).limit(2).get()).docs;
if (matches.length !== 1) throw new Error(`Expected exactly one organization for ${orgSelector}; found ${matches.length}.`);

const organization = matches[0];
const licenseSnapshot = await organization.ref.collection('license').doc('current').get();
const membersSnapshot = await organization.ref.collection('members').where('status', '==', 'active').get();
const license = licenseSnapshot.exists ? licenseSnapshot.data() : null;
const asIso = (value) => value instanceof Timestamp ? value.toDate().toISOString() : value ?? null;
const expectedWriteEnabled = Boolean(license && ['TRIAL', 'ACTIVE'].includes(license.status));
const expectedExpiry = license?.status === 'TRIAL' ? license.trialEndsAt : license?.status === 'ACTIVE' ? license.subscriptionEndsAt : null;
const mirrorsMatch = Boolean(license
  && organization.data().licenseStatus === license.status
  && organization.data().licenseWriteEnabled === expectedWriteEnabled
  && asIso(organization.data().licenseExpiresAt) === asIso(expectedExpiry));

console.log(JSON.stringify({
  mode: 'read-only',
  organizationId: organization.id,
  organizationName: organization.data().name || null,
  organizationStatus: organization.data().status || null,
  canonicalLicenseExists: licenseSnapshot.exists,
  canonicalLicense: license ? {
    plan: license.plan || null,
    status: license.status || null,
    trialStartedAt: asIso(license.trialStartedAt),
    trialEndsAt: asIso(license.trialEndsAt),
    subscriptionStartedAt: asIso(license.subscriptionStartedAt),
    subscriptionEndsAt: asIso(license.subscriptionEndsAt),
    maxUsers: license.maxUsers || null,
  } : null,
  activeMemberCount: membersSnapshot.size,
  mirrors: {
    licenseStatus: organization.data().licenseStatus || null,
    licenseWriteEnabled: organization.data().licenseWriteEnabled ?? null,
    licenseExpiresAt: asIso(organization.data().licenseExpiresAt),
    matchCanonical: mirrorsMatch,
  },
}, null, 2));
