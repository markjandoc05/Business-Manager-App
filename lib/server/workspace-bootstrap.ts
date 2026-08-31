import { adminAuth, adminDb } from './firebase-admin.ts';
import { FieldValue, Timestamp, type QuerySnapshot } from 'firebase-admin/firestore';
import { recordMemberLoginFailure, sanitizeMemberLoginFailureCode } from './login-activity.ts';

const MEMBER_ROLES = ['ADMIN', 'MANAGER', 'USER'] as const;
const LICENSE_PLANS = ['TRIAL', 'SOLO', 'STARTER', 'TEAM', 'LEGACY'] as const;
const ACTIVE_LICENSE_STATUSES = ['TRIAL', 'ACTIVE'] as const;
const ORGANIZATION_STATUSES = ['trial', 'active', 'expired', 'suspended'] as const;

type BootstrapMembership = { organizationId: string; role: typeof MEMBER_ROLES[number]; status: string };
export type WorkspaceBootstrapStage = 'auth-user-load' | 'auth-user-loaded' | 'profile-read' | 'memberships-read' | 'invitations-read' | 'organization-context-read' | 'profile-write' | 'completed';

export class WorkspaceBootstrapError extends Error {
  readonly code: string;
  readonly stage: WorkspaceBootstrapStage;

  constructor(stage: WorkspaceBootstrapStage, code: string, message: string) {
    super(message);
    this.name = 'WorkspaceBootstrapError';
    this.stage = stage;
    this.code = code;
  }
}

function asWorkspaceBootstrapError(stage: WorkspaceBootstrapStage, error: unknown) {
  if (error instanceof WorkspaceBootstrapError) return error;
  const candidate = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
  const code = typeof candidate.code === 'string' && candidate.code.trim() ? candidate.code.trim().slice(0, 120) : 'BOOTSTRAP_FAILED';
  const message = typeof candidate.message === 'string' && candidate.message.trim() ? candidate.message.trim().slice(0, 300) : 'Workspace bootstrap failed.';
  return new WorkspaceBootstrapError(stage, code, message);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function validRole(value: unknown): value is typeof MEMBER_ROLES[number] {
  return typeof value === 'string' && (MEMBER_ROLES as readonly string[]).includes(value);
}

function isActiveMembership(data: Record<string, unknown>, uid: string) {
  return data.userId === uid && data.status === 'active' && validRole(data.role);
}

function isUsableLicense(data: Record<string, unknown>, now: Timestamp) {
  if (!ACTIVE_LICENSE_STATUSES.includes(data.status as typeof ACTIVE_LICENSE_STATUSES[number])) return false;
  if (!LICENSE_PLANS.includes(data.plan as typeof LICENSE_PLANS[number])) return false;
  if (!Number.isInteger(data.maxUsers) || Number(data.maxUsers) < 1) return false;
  const expiry = data.status === 'TRIAL' ? data.trialEndsAt : data.subscriptionEndsAt;
  return typeof expiry === 'object' && expiry !== null && 'toMillis' in expiry && typeof expiry.toMillis === 'function' && (expiry as Timestamp).toMillis() >= now.toMillis();
}

function profileIsBlocked(data: Record<string, unknown>) {
  return data.status === 'inactive' || data.status === 'disabled' || data.active === false && data.status === 'active';
}

async function recordBootstrapFailures(uid: string, activities: Array<{ organizationId: string; failureCode: string }>) {
  await Promise.all(activities.map(async ({ organizationId, failureCode }) => {
    try {
      await recordMemberLoginFailure(organizationId, uid, failureCode);
    } catch {
      console.warn(`[login-activity] unable to record status=FAILED organizationId=${organizationId}`);
    }
  }));
}

/**
 * Trusted first-login synchronization. The browser supplies only its Firebase
 * ID token to the route; this function obtains the authoritative email and
 * account state from Firebase Admin, then claims Console assignments and
 * normalizes the root profile before Client membership discovery runs.
 */
export async function bootstrapWorkspaceAccess(uid: string, options: { onStage?: (stage: WorkspaceBootstrapStage) => void } = {}) {
  let stage: WorkspaceBootstrapStage = 'auth-user-load';
  let associatedOrganizationIds: string[] = [];
  const markStage = (nextStage: WorkspaceBootstrapStage) => {
    stage = nextStage;
    options.onStage?.(nextStage);
  };

  try {
    markStage('auth-user-load');
    const authUser = await adminAuth.getUser(uid);
    markStage('auth-user-loaded');
    const email = authUser.email?.trim() || '';
    const emailNormalized = normalizeEmail(email);
    const profileRef = adminDb.doc(`users/${uid}`);
    const membershipQuery = adminDb.collectionGroup('members').where('userId', '==', uid).limit(100);
    const invitationQuery = emailNormalized
      ? adminDb.collection('organizationInvitations').where('emailNormalized', '==', emailNormalized).limit(100)
      : null;
    const now = Timestamp.now();

    const result = await adminDb.runTransaction(async (transaction) => {
      markStage('profile-read');
      const profileSnapshot = await transaction.get(profileRef);
      markStage('memberships-read');
      const membershipSnapshot = await transaction.get(membershipQuery);
      markStage('invitations-read');
      const invitationSnapshot = invitationQuery ? await transaction.get(invitationQuery) : null;
      const invitations = (invitationSnapshot?.docs || []).filter((item) => item.data().status === 'pending');
      const membershipRows = membershipSnapshot.docs
        .map((item) => ({ snapshot: item, organizationId: item.ref.parent.parent?.id || '' }))
        .filter((item) => item.organizationId && item.snapshot.data().userId === uid);
      associatedOrganizationIds = [...new Set(membershipRows.map((item) => item.organizationId))];
      const existingMemberships = membershipRows.filter((item) => validRole(item.snapshot.data().role));

      const organizationIds = new Set<string>(existingMemberships.map((item) => item.organizationId));
      for (const invitation of invitations) {
        const organizationId = invitation.data().organizationId;
        if (typeof organizationId === 'string' && organizationId && !organizationId.includes('/')) organizationIds.add(organizationId);
      }
      const organizationIdList = [...organizationIds];

      const organizationRefs = organizationIdList.map((organizationId) => adminDb.doc(`organizations/${organizationId}`));
      const licenseRefs = organizationIdList.map((organizationId) => adminDb.doc(`organizations/${organizationId}/license/current`));
      const memberRefs = organizationIdList.map((organizationId) => adminDb.doc(`organizations/${organizationId}/members/${uid}`));
      markStage('organization-context-read');
      const organizationSnapshots = await Promise.all(organizationRefs.map((ref) => transaction.get(ref)));
      const licenseSnapshots = await Promise.all(licenseRefs.map((ref) => transaction.get(ref)));
      const memberSnapshots = await Promise.all(memberRefs.map((ref) => transaction.get(ref)));
      const membersByOrganization = new Map<string, QuerySnapshot>();
      for (const organizationId of invitations.map((item) => item.data().organizationId).filter((value): value is string => typeof value === 'string' && Boolean(value))) {
        if (membersByOrganization.has(organizationId)) continue;
        membersByOrganization.set(organizationId, await transaction.get(adminDb.collection(`organizations/${organizationId}/members`)));
      }

      const existingActiveOrganizations = new Set<string>();
      existingMemberships.forEach(({ organizationId, snapshot }) => {
        if (isActiveMembership(snapshot.data() || {}, uid)) existingActiveOrganizations.add(organizationId);
      });
      memberSnapshots.forEach((snapshot, index) => {
        if (snapshot.exists && isActiveMembership(snapshot.data() || {}, uid)) existingActiveOrganizations.add(organizationIdList[index]);
      });

      const claimedOrganizations: string[] = [];
      const pendingOrganizations: string[] = [];
      const blockedOrganizations: string[] = [];
      const profileData = profileSnapshot.data() || {};
      const globallyBlocked = authUser.disabled || (profileSnapshot.exists && profileIsBlocked(profileData));

      if (!globallyBlocked && authUser.emailVerified) {
        for (const invitation of invitations) {
          const invitationData = invitation.data();
          const organizationId = typeof invitationData.organizationId === 'string' ? invitationData.organizationId : '';
          const organizationIndex = organizationIds.has(organizationId) ? organizationIdList.indexOf(organizationId) : -1;
          const organization = organizationIndex >= 0 ? organizationSnapshots[organizationIndex]?.data() || {} : {};
          const license = organizationIndex >= 0 ? licenseSnapshots[organizationIndex]?.data() || {} : {};
          const canonicalMember = organizationIndex >= 0 ? memberSnapshots[organizationIndex] : undefined;
          const existingMemberForEmail = membersByOrganization.get(organizationId)?.docs.find((item) => normalizeEmail(typeof item.data().email === 'string' ? item.data().email : '') === emailNormalized);

          if (existingActiveOrganizations.has(organizationId)) {
            transaction.update(invitation.ref, { status: 'claimed', claimedByUid: uid, claimedAt: FieldValue.serverTimestamp(), memberUid: uid, updatedAt: FieldValue.serverTimestamp() });
            claimedOrganizations.push(organizationId);
            continue;
          }
          if (canonicalMember?.exists || existingMemberForEmail) {
            const existingData = (canonicalMember?.data() || existingMemberForEmail?.data() || {}) as Record<string, unknown>;
            if (existingData.status === 'inactive' || existingData.status === 'archived' || existingData.status === 'suspended' || existingData.status === 'disabled') blockedOrganizations.push(organizationId);
            else pendingOrganizations.push(organizationId);
            continue;
          }
          if (organizationIndex < 0 || !ORGANIZATION_STATUSES.includes(organization.status as typeof ORGANIZATION_STATUSES[number]) || !isUsableLicense(license, now)) {
            pendingOrganizations.push(organizationId);
            continue;
          }
          const activeCount = membersByOrganization.get(organizationId)?.docs.filter((item) => item.data().status === 'active').length || 0;
          if (activeCount >= Number(license.maxUsers)) {
            pendingOrganizations.push(organizationId);
            continue;
          }
          const role = validRole(invitationData.role) ? invitationData.role : 'USER';
          transaction.set(adminDb.doc(`organizations/${organizationId}/members/${uid}`), {
            userId: uid,
            email: authUser.email || email,
            displayName: authUser.displayName || '',
            role,
            status: 'active',
            joinedAt: FieldValue.serverTimestamp(),
            activatedAt: FieldValue.serverTimestamp(),
            activatedBy: 'workspace-bootstrap',
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          transaction.update(invitation.ref, { status: 'claimed', claimedByUid: uid, claimedAt: FieldValue.serverTimestamp(), memberUid: uid, updatedAt: FieldValue.serverTimestamp() });
          claimedOrganizations.push(organizationId);
          existingActiveOrganizations.add(organizationId);
        }
      }

      const hasAuthorizedMembership = existingActiveOrganizations.size > 0;
      const shouldActivateProfile = !globallyBlocked && hasAuthorizedMembership;
      const existingProfileStatus = typeof profileData.status === 'string' ? profileData.status : 'pending';
      const nextProfile = {
        uid,
        name: authUser.displayName || (typeof profileData.name === 'string' ? profileData.name : 'User'),
        email: authUser.email || (typeof profileData.email === 'string' ? profileData.email : ''),
        displayName: authUser.displayName || (typeof profileData.displayName === 'string' ? profileData.displayName : 'User'),
        photoURL: authUser.photoURL || (typeof profileData.photoURL === 'string' ? profileData.photoURL : ''),
        status: shouldActivateProfile ? 'active' : authUser.disabled ? 'disabled' : globallyBlocked ? existingProfileStatus : profileSnapshot.exists ? existingProfileStatus : 'pending',
        role: profileData.role === 'ADMIN' || profileData.role === 'MANAGER' || profileData.role === 'USER' ? profileData.role : 'USER',
        active: shouldActivateProfile ? true : authUser.disabled || globallyBlocked ? false : profileSnapshot.exists ? profileData.active === true : false,
      };
      // Record only failures known during this trusted bootstrap. If another
      // active organization is available, inactive memberships remain untouched
      // because that organization was not resolved or accessed in this flow.
      const loginFailureActivities = globallyBlocked
        ? membershipRows.map(({ organizationId, snapshot }) => ({ organizationId, failureCode: snapshot.data()?.status === 'active' ? 'BOOTSTRAP_FAILED' : 'MEMBERSHIP_INACTIVE' }))
        : existingActiveOrganizations.size === 0
          ? membershipRows
            .filter(({ snapshot }) => snapshot.data()?.status !== 'active')
            .map(({ organizationId }) => ({ organizationId, failureCode: 'MEMBERSHIP_INACTIVE' }))
          : [];
      markStage('profile-write');
      if (!profileSnapshot.exists) transaction.set(profileRef, { ...nextProfile, createdAt: FieldValue.serverTimestamp() });
      else transaction.set(profileRef, nextProfile, { merge: true });

      return { profileStatus: nextProfile.status, profileActive: nextProfile.active, claimedOrganizations, pendingOrganizations, blockedOrganizations, existingMembershipCount: existingMemberships.length, loginFailureActivities };
    });

    await recordBootstrapFailures(uid, result.loginFailureActivities);
    markStage('completed');
    const { loginFailureActivities: _loginFailureActivities, ...publicResult } = result;
    return { uid, email: authUser.email || '', emailVerified: authUser.emailVerified, disabled: authUser.disabled, ...publicResult };
  } catch (error) {
    const bootstrapError = asWorkspaceBootstrapError(stage, error);
    if (associatedOrganizationIds.length) {
      const failureCode = sanitizeMemberLoginFailureCode(bootstrapError.code);
      await recordBootstrapFailures(uid, associatedOrganizationIds.map((organizationId) => ({ organizationId, failureCode })));
    }
    throw bootstrapError;
  }
}
