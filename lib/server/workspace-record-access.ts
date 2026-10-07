import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/server/firebase-admin';

export class WorkspaceRecordError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function recordId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f/]/.test(value) && value !== '.' && value !== '..';
}

/** Read policy stays available after expiry. Writes retain their existing mirror
 * policy; Documents additionally verify the canonical license as their API did. */
export async function requireWorkspaceRecordAccess(transaction: Transaction, orgId: string, uid: string, write: false | 'mirror' | 'canonical' = false) {
  const organization = adminDb.doc(`organizations/${orgId}`);
  const [user, org, member, license] = await Promise.all([
    transaction.get(adminDb.doc(`users/${uid}`)), transaction.get(organization),
    transaction.get(organization.collection('members').doc(uid)),
    write === 'canonical' ? transaction.get(organization.collection('license').doc('current')) : Promise.resolve(null),
  ]);
  const u = user.data() || {}; const o = org.data() || {}; const m = member.data() || {};
  if (!user.exists || u.uid !== uid || u.status !== 'active' || (Object.hasOwn(u, 'active') && u.active !== true)
    || !org.exists || !['trial', 'active', 'expired', 'suspended'].includes(o.status)
    || !member.exists || m.userId !== uid || m.status !== 'active'
    || !(write ? ['ADMIN', 'MANAGER'] : ['ADMIN', 'MANAGER', 'USER']).includes(m.role)) {
    throw new WorkspaceRecordError('You do not have permission to access these workspace records.', 403);
  }
  if (write && (o.licenseWriteEnabled !== true || !['TRIAL', 'ACTIVE'].includes(o.licenseStatus)
    || (o.licenseExpiresAt != null && (!(o.licenseExpiresAt instanceof Timestamp) || o.licenseExpiresAt.toMillis() < Date.now())))) {
    throw new WorkspaceRecordError('Changes are unavailable for the current workspace license.', 409);
  }
  if (write === 'canonical') {
    const l = license?.data() || {}; const expiry = l.status === 'TRIAL' ? l.trialEndsAt : l.subscriptionEndsAt;
    if (!license?.exists || !['TRIAL', 'SOLO', 'STARTER', 'TEAM', 'LEGACY'].includes(l.plan)
      || !Number.isInteger(l.maxUsers) || l.maxUsers < 1 || !['TRIAL', 'ACTIVE'].includes(l.status)
      || !(expiry instanceof Timestamp) || expiry.toMillis() < Date.now()
      || o.licenseStatus !== l.status || !(o.licenseExpiresAt instanceof Timestamp)
      || o.licenseExpiresAt.toMillis() !== expiry.toMillis()
      || !((l.status === 'TRIAL' && o.status === 'trial') || (l.status === 'ACTIVE' && o.status === 'active'))) {
      throw new WorkspaceRecordError('Changes are unavailable for the current workspace license.', 409);
    }
  }
  return { organization, user: u, membership: m };
}
