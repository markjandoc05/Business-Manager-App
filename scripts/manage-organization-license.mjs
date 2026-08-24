/* Trusted platform administration. Dry-run by default; mutations require --apply. */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

const [, , command = 'show', ...args] = process.argv;
const apply = args.includes('--apply');
const value = (flag) => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
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
const licenseRef = organization.ref.collection('license').doc('current');
const currentSnapshot = await licenseRef.get();
const current = currentSnapshot.exists ? currentSnapshot.data() : null;
console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', command, projectId, organizationId: organization.id, organizationPath: organization.ref.path, currentLicense: current }, null, 2));
if (command === 'show') process.exit(0);
if (command === 'activate' && !['STARTER', 'TEAM', 'TRIAL', 'LEGACY'].includes(value('--plan') || '')) throw new Error('activate requires --plan STARTER|TEAM|TRIAL|LEGACY.');
if (command !== 'suspend' && command !== 'expire' && command !== 'activate' && command !== 'renew') throw new Error('Supported commands: show, activate, renew, suspend, expire.');
if (!current && command !== 'activate') throw new Error('No current license exists; run the backfill or activate the organization first.');

const now = Timestamp.now();
const currentEnd = current?.subscriptionEndsAt instanceof Timestamp ? current.subscriptionEndsAt : now;
const days = Math.max(1, Number(value('--days') || 30));
const nextEnd = Timestamp.fromMillis(Math.max(now.toMillis(), currentEnd.toMillis()) + days * 86_400_000);
const updates = command === 'activate'
  ? { status: 'ACTIVE', plan: value('--plan'), features: current?.features || { crm: true, reports: true, documents: true }, subscriptionStartedAt: current?.subscriptionStartedAt || FieldValue.serverTimestamp(), subscriptionEndsAt: nextEnd, maxUsers: Math.max(1, Number(value('--max-users') || current?.maxUsers || 3)), updatedAt: FieldValue.serverTimestamp(), updatedBy: 'platform-script' }
  : command === 'renew'
    ? { status: 'ACTIVE', subscriptionEndsAt: nextEnd, updatedAt: FieldValue.serverTimestamp(), updatedBy: 'platform-script' }
    : command === 'suspend'
      ? { status: 'SUSPENDED', updatedAt: FieldValue.serverTimestamp(), updatedBy: 'platform-script' }
      : { status: 'EXPIRED', updatedAt: FieldValue.serverTimestamp(), updatedBy: 'platform-script' };

console.log(JSON.stringify({ plannedChanges: updates, organizationEnforcement: command === 'suspend' || command === 'expire' ? { licenseStatus: updates.status, licenseWriteEnabled: false } : { licenseStatus: updates.status, licenseWriteEnabled: true, licenseExpiresAt: nextEnd } }, null, 2));
if (!apply) {
  console.log('Dry run only. Re-run with --apply to apply this platform license change.');
  process.exit(0);
}
await licenseRef.set(updates, { merge: true });
await organization.ref.update({ licenseStatus: updates.status, licenseWriteEnabled: command !== 'suspend' && command !== 'expire', licenseExpiresAt: command === 'suspend' || command === 'expire' ? null : nextEnd, updatedAt: FieldValue.serverTimestamp() });
console.log(`License ${command} applied to ${organization.ref.path}.`);
