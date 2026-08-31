import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/server/firebase-admin';
import { getAuthenticatedUser, isApplicationUserActive, setFirebaseAccountDisabled } from '@/lib/server/auth';

const roles = new Set(['ADMIN', 'MANAGER', 'USER']);
const statuses = new Set(['pending', 'active', 'inactive', 'suspended', 'archived']);

function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

async function validateMembershipAuthorization(organizationId: string, callerUid: string, memberUid: string, accountAction: 'disable' | 'reactivate') {
  const organizationRef = adminDb.doc(`organizations/${organizationId}`);
  const callerRef = organizationRef.collection('members').doc(callerUid);
  const memberRef = organizationRef.collection('members').doc(memberUid);
  const licenseRef = organizationRef.collection('license').doc('current');
  const [organizationSnapshot, callerSnapshot, memberSnapshot, licenseSnapshot] = await Promise.all([
    organizationRef.get(),
    callerRef.get(),
    memberRef.get(),
    licenseRef.get(),
  ]);
  if (!organizationSnapshot.exists || !callerSnapshot.exists || !memberSnapshot.exists || !licenseSnapshot.exists) return 'NOT_FOUND';
  const caller = callerSnapshot.data() || {};
  if (caller.userId !== callerUid || caller.role !== 'ADMIN' || caller.status !== 'active') return 'FORBIDDEN';
  const organization = organizationSnapshot.data() || {};
  if (!['trial', 'active'].includes(String(organization.status))) return 'LICENSE_BLOCKED';
  if (organization.licenseWriteEnabled !== true || !['TRIAL', 'ACTIVE'].includes(String(organization.licenseStatus))) return 'LICENSE_BLOCKED';
  if (organization.licenseExpiresAt instanceof Timestamp && organization.licenseExpiresAt.toMillis() < Date.now()) return 'LICENSE_BLOCKED';

  const license = licenseSnapshot.data() || {};
  if (!['TRIAL', 'STARTER', 'TEAM', 'LEGACY'].includes(String(license.plan)) || !['TRIAL', 'ACTIVE'].includes(String(license.status)) || !Number.isInteger(license.maxUsers) || license.maxUsers < 1) return 'LICENSE_INVALID';
  const expiry = license.status === 'TRIAL' ? license.trialEndsAt : license.subscriptionEndsAt;
  if (!(expiry instanceof Timestamp) || expiry.toMillis() < Date.now()) return 'LICENSE_BLOCKED';
  if (organization.licenseStatus !== license.status
    || organization.licenseWriteEnabled !== true
    || !(organization.licenseExpiresAt instanceof Timestamp)
    || organization.licenseExpiresAt.toMillis() !== expiry.toMillis()
    || (license.status === 'TRIAL' && organization.status !== 'trial')
    || (license.status === 'ACTIVE' && organization.status !== 'active')) return 'LICENSE_INVALID';

  if (accountAction === 'reactivate') {
    const member = memberSnapshot.data() || {};
    if (member.status !== 'active') {
      const activeMembers = await organizationRef.collection('members').where('status', '==', 'active').get();
      if (activeMembers.size >= license.maxUsers) return 'SEAT_LIMIT';
    }
  }
  return null;
}

function authorizationError(code: string) {
  if (code === 'FORBIDDEN') return errorResponse(403, 'Organization ADMIN access is required.');
  if (code === 'NOT_FOUND') return errorResponse(404, 'Organization or member not found.');
  if (code === 'SEAT_LIMIT') return errorResponse(409, 'The organization has reached its active-user limit.');
  if (code === 'LICENSE_BLOCKED' || code === 'LICENSE_INVALID') return errorResponse(409, 'Membership changes are unavailable for the current license.');
  return null;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ orgId: string; memberUid: string }> }) {
  const authenticatedUser = await getAuthenticatedUser(request);
  if (!authenticatedUser) return errorResponse(401, 'Authentication is required.');
  if (!await isApplicationUserActive(authenticatedUser.uid)) return errorResponse(403, 'Your BSM account is not active.');

  const { orgId, memberUid } = await context.params;
  if (!orgId || !memberUid || orgId.length > 128 || memberUid.length > 128 || memberUid === authenticatedUser.uid) {
    return errorResponse(400, 'Invalid organization or member.');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid request payload.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse(400, 'Invalid request payload.');
  const changes = body as Record<string, unknown>;
  const allowedKeys = Object.keys(changes);
  if (!allowedKeys.length || allowedKeys.some((key) => key !== 'role' && key !== 'status' && key !== 'accountAction')) return errorResponse(400, 'Only role, status, or an explicit account action can be requested.');
  if (changes.role !== undefined && (typeof changes.role !== 'string' || !roles.has(changes.role))) return errorResponse(400, 'Invalid organization role.');
  if (changes.status !== undefined && (typeof changes.status !== 'string' || !statuses.has(changes.status))) return errorResponse(400, 'Invalid membership status.');
  if (changes.accountAction !== undefined && (changes.accountAction !== 'disable' && changes.accountAction !== 'reactivate')) return errorResponse(400, 'Invalid account action.');
  if (changes.accountAction === 'disable' && changes.status !== undefined && changes.status !== 'inactive') return errorResponse(400, 'Account disablement requires inactive membership status.');
  if (changes.accountAction === 'reactivate' && changes.status !== undefined && changes.status !== 'active') return errorResponse(400, 'Account reactivation requires active membership status.');

  const accountAction = changes.accountAction as 'disable' | 'reactivate' | undefined;
  if (accountAction === 'reactivate') {
    const validationCode = await validateMembershipAuthorization(orgId, authenticatedUser.uid, memberUid, accountAction);
    if (validationCode) return authorizationError(validationCode) || errorResponse(500, 'Unable to authorize account reactivation.');
    try {
      await setFirebaseAccountDisabled(memberUid, false);
    } catch {
      return errorResponse(500, 'Unable to reactivate the account.');
    }
  }

  try {
    await adminDb.runTransaction(async (transaction) => {
      const organizationRef = adminDb.doc(`organizations/${orgId}`);
      const callerRef = organizationRef.collection('members').doc(authenticatedUser.uid);
      const memberRef = organizationRef.collection('members').doc(memberUid);
      const userRef = adminDb.doc(`users/${memberUid}`);
      const licenseRef = organizationRef.collection('license').doc('current');
      const [organizationSnapshot, callerSnapshot, memberSnapshot, licenseSnapshot] = await Promise.all([
        transaction.get(organizationRef),
        transaction.get(callerRef),
        transaction.get(memberRef),
        transaction.get(licenseRef),
      ]);
      if (!organizationSnapshot.exists || !callerSnapshot.exists || !memberSnapshot.exists || !licenseSnapshot.exists) throw new Error('NOT_FOUND');
      const caller = callerSnapshot.data() || {};
      if (caller.userId !== authenticatedUser.uid || caller.role !== 'ADMIN' || caller.status !== 'active') throw new Error('FORBIDDEN');
      const organization = organizationSnapshot.data() || {};
      if (!['trial', 'active'].includes(String(organization.status))) throw new Error('LICENSE_BLOCKED');
      if (organization.licenseWriteEnabled !== true || !['TRIAL', 'ACTIVE'].includes(String(organization.licenseStatus))) throw new Error('LICENSE_BLOCKED');
      if (organization.licenseExpiresAt instanceof Timestamp && organization.licenseExpiresAt.toMillis() < Date.now()) throw new Error('LICENSE_BLOCKED');

      const license = licenseSnapshot.data() || {};
      if (!['TRIAL', 'STARTER', 'TEAM', 'LEGACY'].includes(String(license.plan)) || !['TRIAL', 'ACTIVE'].includes(String(license.status)) || !Number.isInteger(license.maxUsers) || license.maxUsers < 1) throw new Error('LICENSE_INVALID');
      const expiry = license.status === 'TRIAL' ? license.trialEndsAt : license.subscriptionEndsAt;
      if (!(expiry instanceof Timestamp) || expiry.toMillis() < Date.now()) throw new Error('LICENSE_BLOCKED');
      if (organization.licenseStatus !== license.status
        || organization.licenseWriteEnabled !== true
        || !(organization.licenseExpiresAt instanceof Timestamp)
        || organization.licenseExpiresAt.toMillis() !== expiry.toMillis()
        || (license.status === 'TRIAL' && organization.status !== 'trial')
        || (license.status === 'ACTIVE' && organization.status !== 'active')) throw new Error('LICENSE_INVALID');

      const member = memberSnapshot.data() || {};
      const nextStatus = accountAction === 'disable'
        ? 'inactive'
        : accountAction === 'reactivate'
          ? 'active'
          : changes.status === undefined ? member.status : changes.status;
      if (nextStatus === 'active' && member.status !== 'active') {
        const activeMembers = await transaction.get(organizationRef.collection('members').where('status', '==', 'active'));
        if (activeMembers.size >= license.maxUsers) throw new Error('SEAT_LIMIT');
      }
      const update: Record<string, unknown> = {};
      if (changes.role !== undefined) update.role = changes.role;
      if (changes.status !== undefined || accountAction) update.status = nextStatus;
      if (changes.status === 'active' && member.status !== 'active') {
        update.activatedAt = FieldValue.serverTimestamp();
        update.activatedBy = authenticatedUser.uid;
      }
      if (accountAction === 'reactivate' && member.status !== 'active') {
        update.activatedAt = FieldValue.serverTimestamp();
        update.activatedBy = authenticatedUser.uid;
      }
      transaction.update(memberRef, update);
      if (accountAction === 'disable') {
        transaction.set(userRef, { uid: memberUid, status: 'disabled', active: false }, { merge: true });
      } else if (accountAction === 'reactivate') {
        transaction.set(userRef, { uid: memberUid, status: 'active', active: true }, { merge: true });
      }
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const knownError = authorizationError(code);
    if (knownError) return knownError;
    return errorResponse(500, 'Unable to update organization membership.');
  }

  if (accountAction === 'disable') {
    try {
      await setFirebaseAccountDisabled(memberUid, true);
    } catch {
      // Firestore access is already blocked by the disabled profile. Do not
      // report internal Admin SDK details to the caller.
      return errorResponse(500, 'Account access was blocked, but Firebase account disablement did not complete.');
    }
  }

  return NextResponse.json({ ok: true });
}
