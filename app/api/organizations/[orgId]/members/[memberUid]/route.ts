import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/server/firebase-admin';

const roles = new Set(['ADMIN', 'MANAGER', 'USER']);
const statuses = new Set(['pending', 'active', 'inactive', 'suspended', 'archived']);

function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ orgId: string; memberUid: string }> }) {
  const authorization = request.headers.get('authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
  if (!token) return errorResponse(401, 'Authentication is required.');

  let decoded;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch {
    return errorResponse(401, 'Authentication is required.');
  }

  const { orgId, memberUid } = await context.params;
  if (!orgId || !memberUid || orgId.length > 128 || memberUid.length > 128 || memberUid === decoded.uid) {
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
  if (!allowedKeys.length || allowedKeys.some((key) => key !== 'role' && key !== 'status')) return errorResponse(400, 'Only role and status can be changed.');
  if (changes.role !== undefined && (typeof changes.role !== 'string' || !roles.has(changes.role))) return errorResponse(400, 'Invalid organization role.');
  if (changes.status !== undefined && (typeof changes.status !== 'string' || !statuses.has(changes.status))) return errorResponse(400, 'Invalid membership status.');

  try {
    await adminDb.runTransaction(async (transaction) => {
      const organizationRef = adminDb.doc(`organizations/${orgId}`);
      const callerRef = organizationRef.collection('members').doc(decoded.uid);
      const memberRef = organizationRef.collection('members').doc(memberUid);
      const licenseRef = organizationRef.collection('license').doc('current');
      const [organizationSnapshot, callerSnapshot, memberSnapshot, licenseSnapshot] = await Promise.all([
        transaction.get(organizationRef),
        transaction.get(callerRef),
        transaction.get(memberRef),
        transaction.get(licenseRef),
      ]);
      if (!organizationSnapshot.exists || !callerSnapshot.exists || !memberSnapshot.exists || !licenseSnapshot.exists) throw new Error('NOT_FOUND');
      const caller = callerSnapshot.data() || {};
      if (caller.userId !== decoded.uid || caller.role !== 'ADMIN' || caller.status !== 'active') throw new Error('FORBIDDEN');
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
      const nextStatus = changes.status === undefined ? member.status : changes.status;
      if (nextStatus === 'active' && member.status !== 'active') {
        const activeMembers = await transaction.get(organizationRef.collection('members').where('status', '==', 'active'));
        if (activeMembers.size >= license.maxUsers) throw new Error('SEAT_LIMIT');
      }
      const update: Record<string, unknown> = {};
      if (changes.role !== undefined) update.role = changes.role;
      if (changes.status !== undefined) update.status = changes.status;
      if (changes.status === 'active' && member.status !== 'active') {
        update.activatedAt = FieldValue.serverTimestamp();
        update.activatedBy = decoded.uid;
      }
      transaction.update(memberRef, update);
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'FORBIDDEN') return errorResponse(403, 'Organization ADMIN access is required.');
    if (code === 'NOT_FOUND') return errorResponse(404, 'Organization or member not found.');
    if (code === 'SEAT_LIMIT') return errorResponse(409, 'The organization has reached its active-user limit.');
    if (code === 'LICENSE_BLOCKED' || code === 'LICENSE_INVALID') return errorResponse(409, 'Membership changes are unavailable for the current license.');
    return errorResponse(500, 'Unable to update organization membership.');
  }

  return NextResponse.json({ ok: true });
}
