import { adminAuth, adminDb } from './firebase-admin.ts';
import { FieldValue, Timestamp, type QuerySnapshot } from 'firebase-admin/firestore';
import { recordMemberLoginFailure, sanitizeMemberLoginFailureCode } from './login-activity.ts';

const MEMBER_ROLES = ['ADMIN', 'MANAGER', 'USER'] as const;
const LICENSE_PLANS = ['TRIAL', 'SOLO', 'STARTER', 'TEAM', 'LEGACY'] as const;
const ACTIVE_LICENSE_STATUSES = ['TRIAL', 'ACTIVE'] as const;
const ORGANIZATION_STATUSES = ['trial', 'active', 'expired', 'suspended'] as const;

type BootstrapMembership = { organizationId: string; role: typeof MEMBER_ROLES[number]; status: string };
type BootstrapAuthUser = {
  uid: string;
  email?: string | null;
  emailVerified: boolean;
  disabled: boolean;
  displayName?: string | null;
  photoURL?: string | null;
  name?: string | null;
};
export type WorkspaceBootstrapStage = 'auth-user-load' | 'auth-user-loaded' | 'profile-read' | 'memberships-read' | 'invitations-read' | 'organization-context-read' | 'profile-write' | 'completed';
export type WorkspaceBootstrapTimingMetric =
  | 'auth-user-lookup'
  | 'profile-read'
  | 'memberships-read'
  | 'invitations-read'
  | 'organization-context-read'
  | 'organization-context-batch-read'
  | 'organization-documents-read'
  | 'license-documents-read'
  | 'canonical-memberships-read'
  | 'invitation-member-collections-read'
  | 'profile-write-staged'
  | 'transaction-callback'
  | 'transaction-total'
  | 'transaction-commit-overhead'
  | 'login-failure-activity'
  | 'bootstrap-total';

export type WorkspaceBootstrapTimings = Partial<Record<WorkspaceBootstrapTimingMetric, number>>;

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
 * ID token to the route; the route verifies it (including revoked/disabled
 * checks) and passes that verified identity here, avoiding a second Admin Auth
 * lookup. Direct server callers without a verified identity retain the
 * authoritative Admin lookup. The function then claims Console assignments
 * and normalizes the root profile before Client membership discovery runs.
 */
export async function bootstrapWorkspaceAccess(
  uid: string,
  options: {
    authUser?: BootstrapAuthUser;
    onStage?: (stage: WorkspaceBootstrapStage) => void;
    onTiming?: (metric: WorkspaceBootstrapTimingMetric, durationMs: number) => void;
  } = {},
) {
  let stage: WorkspaceBootstrapStage = 'auth-user-load';
  let associatedOrganizationIds: string[] = [];
  const bootstrapStartedAt = performance.now();
  const timings: WorkspaceBootstrapTimings = {};
  const recordTiming = (metric: WorkspaceBootstrapTimingMetric, startedAt: number) => {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    timings[metric] = durationMs;
    options.onTiming?.(metric, durationMs);
    return durationMs;
  };
  const measure = async <T,>(metric: WorkspaceBootstrapTimingMetric, operation: () => Promise<T>) => {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      recordTiming(metric, startedAt);
    }
  };
  const markStage = (nextStage: WorkspaceBootstrapStage) => {
    stage = nextStage;
    options.onStage?.(nextStage);
  };

  try {
    markStage('auth-user-load');
    if (options.authUser && options.authUser.uid !== uid) {
      throw new WorkspaceBootstrapError('auth-user-load', 'AUTH_UID_MISMATCH', 'Authenticated user does not match the bootstrap request.');
    }
    const authUser = options.authUser
      ? (() => {
        // The route has already verified this identity with
        // verifyIdToken(..., true). Report a zero-duration lookup for the
        // server timing contract while avoiding a duplicate network call.
        options.onTiming?.('auth-user-lookup', 0);
        return {
          ...options.authUser,
          displayName: options.authUser.displayName || options.authUser.name || '',
          photoURL: options.authUser.photoURL || '',
        };
      })()
      : await measure('auth-user-lookup', () => adminAuth.getUser(uid));
    markStage('auth-user-loaded');
    const email = authUser.email?.trim() || '';
    const emailNormalized = normalizeEmail(email);
    const profileRef = adminDb.doc(`users/${uid}`);
    const membershipQuery = adminDb.collectionGroup('members').where('userId', '==', uid).limit(100);
    const invitationQuery = emailNormalized
      ? adminDb.collection('organizationInvitations').where('emailNormalized', '==', emailNormalized).limit(100)
      : null;
    const now = Timestamp.now();

    const transactionStartedAt = performance.now();
    let transactionCallbackDurationMs = 0;
    const result = await adminDb.runTransaction(async (transaction) => {
      const callbackStartedAt = performance.now();
      try {
        markStage('profile-read');
        const profileSnapshot = await measure('profile-read', () => transaction.get(profileRef));
        markStage('memberships-read');
        const membershipSnapshot = await measure('memberships-read', () => transaction.get(membershipQuery));
        markStage('invitations-read');
        const invitationSnapshot = invitationQuery ? await measure('invitations-read', () => transaction.get(invitationQuery)) : null;
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
      const organizationContextStartedAt = performance.now();
      const contextRefs = [...organizationRefs, ...licenseRefs, ...memberRefs];
      const contextBatchStartedAt = performance.now();
      const contextSnapshots = contextRefs.length ? await transaction.getAll(...contextRefs) : [];
      const contextBatchDurationMs = recordTiming('organization-context-batch-read', contextBatchStartedAt);
      // These were previously three separately awaited batches. getAll keeps
      // the reads inside the retryable transaction while issuing one atomic
      // document-read RPC; preserve the existing result grouping and timing
      // names for comparison with the audit baseline.
      const organizationSnapshots = contextSnapshots.slice(0, organizationRefs.length);
      const licenseSnapshots = contextSnapshots.slice(organizationRefs.length, organizationRefs.length + licenseRefs.length);
      const memberSnapshots = contextSnapshots.slice(organizationRefs.length + licenseRefs.length);
      timings['organization-documents-read'] = contextBatchDurationMs;
      options.onTiming?.('organization-documents-read', contextBatchDurationMs);
      timings['license-documents-read'] = contextBatchDurationMs;
      options.onTiming?.('license-documents-read', contextBatchDurationMs);
      timings['canonical-memberships-read'] = contextBatchDurationMs;
      options.onTiming?.('canonical-memberships-read', contextBatchDurationMs);
      const membersByOrganization = await measure('invitation-member-collections-read', async () => {
        const result = new Map<string, QuerySnapshot>();
        for (const organizationId of invitations.map((item) => item.data().organizationId).filter((value): value is string => typeof value === 'string' && Boolean(value))) {
          if (result.has(organizationId)) continue;
          result.set(organizationId, await transaction.get(adminDb.collection(`organizations/${organizationId}/members`)));
        }
        return result;
      });
      recordTiming('organization-context-read', organizationContextStartedAt);

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
      const profileWriteStartedAt = performance.now();
      if (!profileSnapshot.exists) transaction.set(profileRef, { ...nextProfile, createdAt: FieldValue.serverTimestamp() });
      else transaction.set(profileRef, nextProfile, { merge: true });
      // Firestore queues transaction writes locally. The actual write latency is
      // reported separately as transaction-commit-overhead after this callback.
      recordTiming('profile-write-staged', profileWriteStartedAt);

      return { profileStatus: nextProfile.status, profileActive: nextProfile.active, profile: nextProfile, claimedOrganizations, pendingOrganizations, blockedOrganizations, existingMembershipCount: existingMemberships.length, loginFailureActivities };
      } finally {
        const durationMs = Math.max(0, Math.round(performance.now() - callbackStartedAt));
        transactionCallbackDurationMs += durationMs;
        timings['transaction-callback'] = transactionCallbackDurationMs;
        options.onTiming?.('transaction-callback', transactionCallbackDurationMs);
      }
    });
    const transactionTotalMs = recordTiming('transaction-total', transactionStartedAt);
    timings['transaction-commit-overhead'] = Math.max(0, transactionTotalMs - transactionCallbackDurationMs);
    options.onTiming?.('transaction-commit-overhead', timings['transaction-commit-overhead']);

    await measure('login-failure-activity', () => recordBootstrapFailures(uid, result.loginFailureActivities));
    markStage('completed');
    recordTiming('bootstrap-total', bootstrapStartedAt);
    const { loginFailureActivities: _loginFailureActivities, ...publicResult } = result;
    return { uid, email: authUser.email || '', emailVerified: authUser.emailVerified, disabled: authUser.disabled, ...publicResult, timings };
  } catch (error) {
    const bootstrapError = asWorkspaceBootstrapError(stage, error);
    if (associatedOrganizationIds.length) {
      const failureCode = sanitizeMemberLoginFailureCode(bootstrapError.code);
      await recordBootstrapFailures(uid, associatedOrganizationIds.map((organizationId) => ({ organizationId, failureCode })));
    }
    recordTiming('bootstrap-total', bootstrapStartedAt);
    throw bootstrapError;
  }
}
