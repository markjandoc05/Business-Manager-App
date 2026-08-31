import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/server/firebase-admin';
import { getAuthenticatedUser, isApplicationUserActive } from '@/lib/server/auth';

export const runtime = 'nodejs';

function validId(value: string) {
  return Boolean(value) && value.length <= 128 && !value.includes('/');
}

function writableLicense(organization: Record<string, unknown>, license: Record<string, unknown>) {
  if (!['trial', 'active'].includes(String(organization.status)) || organization.licenseWriteEnabled !== true
    || !['TRIAL', 'ACTIVE'].includes(String(organization.licenseStatus))) return false;
  if (organization.licenseExpiresAt instanceof Timestamp && organization.licenseExpiresAt.toMillis() < Date.now()) return false;
  const expiry = license.status === 'TRIAL' ? license.trialEndsAt : license.subscriptionEndsAt;
  return ['TRIAL', 'STARTER', 'TEAM', 'LEGACY'].includes(String(license.plan))
    && ['TRIAL', 'ACTIVE'].includes(String(license.status))
    && Number.isInteger(license.maxUsers)
    && (license.maxUsers as number) >= 1
    && expiry instanceof Timestamp
    && expiry.toMillis() >= Date.now()
    && organization.licenseStatus === license.status
    && organization.licenseExpiresAt instanceof Timestamp
    && organization.licenseExpiresAt.toMillis() === expiry.toMillis()
    && ((license.status === 'TRIAL' && organization.status === 'trial') || (license.status === 'ACTIVE' && organization.status === 'active'));
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ orgId: string; clientId: string; noteId: string }> }) {
  const authenticatedUser = await getAuthenticatedUser(request);
  if (!authenticatedUser) return NextResponse.json({ error: 'Authentication is required.' }, { status: 401 });
  const { uid } = authenticatedUser;
  if (!await isApplicationUserActive(uid)) return NextResponse.json({ error: 'Your BSM account is not active.' }, { status: 403 });
  const { orgId, clientId, noteId } = await context.params;
  if (![orgId, clientId, noteId].every(validId)) return NextResponse.json({ error: 'Invalid note request.' }, { status: 400 });

  const organization = adminDb.doc(`organizations/${orgId}`);
  const [organizationSnapshot, membershipSnapshot, licenseSnapshot] = await Promise.all([
    organization.get(),
    organization.collection('members').doc(uid).get(),
    organization.collection('license').doc('current').get(),
  ]);
  const membership = membershipSnapshot.data() || {};
  if (!organizationSnapshot.exists || !membershipSnapshot.exists || membership.userId !== uid || membership.status !== 'active' || !['ADMIN', 'MANAGER'].includes(String(membership.role))) {
    return NextResponse.json({ error: 'You are not allowed to permanently delete this note.' }, { status: 403 });
  }
  if (!writableLicense(organizationSnapshot.data() || {}, licenseSnapshot.data() || {})) {
    return NextResponse.json({ error: 'Permanent deletion is unavailable for the current workspace license.' }, { status: 409 });
  }

  const clientRef = organization.collection('clients').doc(clientId);
  const noteRef = clientRef.collection('notes').doc(noteId);
  try {
    await adminDb.runTransaction(async (transaction) => {
      const clientSnapshot = await transaction.get(clientRef);
      const noteSnapshot = await transaction.get(noteRef);
      if (!clientSnapshot.exists || !noteSnapshot.exists) throw new Error('NOT_FOUND');
      if (noteSnapshot.data()?.archived !== true) throw new Error('ONLY_ARCHIVED');
      transaction.delete(noteRef);
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'NOT_FOUND') return NextResponse.json({ error: 'The Client or Note could not be found.' }, { status: 404 });
    if (error instanceof Error && error.message === 'ONLY_ARCHIVED') return NextResponse.json({ error: 'Only archived notes can be permanently deleted.' }, { status: 409 });
    throw error;
  }
  return NextResponse.json({ ok: true });
}
