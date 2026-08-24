import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb, adminStorageBucket } from '@/lib/server/firebase-admin';
import { assertFirebaseProject } from '@/lib/server/firebase-project';

export const runtime = 'nodejs';

function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function validId(value: string) {
  return Boolean(value) && value.length <= 128 && !value.includes('/');
}

function writableLicense(organization: Record<string, unknown>, license: Record<string, unknown>) {
  if (!['trial', 'active'].includes(String(organization.status))
    || organization.licenseWriteEnabled !== true
    || !['TRIAL', 'ACTIVE'].includes(String(organization.licenseStatus))) return false;
  if (organization.licenseExpiresAt instanceof Timestamp && organization.licenseExpiresAt.toMillis() < Date.now()) return false;

  if (!['TRIAL', 'STARTER', 'TEAM', 'LEGACY'].includes(String(license.plan))
    || !['TRIAL', 'ACTIVE'].includes(String(license.status))
    || !Number.isInteger(license.maxUsers)
    || (license.maxUsers as number) < 1) return false;
  const expiry = license.status === 'TRIAL' ? license.trialEndsAt : license.subscriptionEndsAt;
  if (!(expiry instanceof Timestamp) || expiry.toMillis() < Date.now()) return false;
  return organization.licenseStatus === license.status
    && organization.licenseWriteEnabled === true
    && organization.licenseExpiresAt instanceof Timestamp
    && organization.licenseExpiresAt.toMillis() === expiry.toMillis()
    && ((license.status === 'TRIAL' && organization.status === 'trial')
      || (license.status === 'ACTIVE' && organization.status === 'active'));
}

function isMissingStorageObject(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 404 || error.code === '404' || error.code === 'storage/object-not-found';
}

function tokenDiagnosticClaims(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    return {
      audience: typeof payload.aud === 'string' ? payload.aud : undefined,
      issuer: typeof payload.iss === 'string' ? payload.iss : undefined,
      subjectPresent: typeof payload.sub === 'string' && payload.sub.length > 0,
      expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
      issuedAt: typeof payload.iat === 'number' ? payload.iat : undefined,
      authenticatedAt: typeof payload.auth_time === 'number' ? payload.auth_time : undefined,
    };
  } catch {
    return { audience: undefined, issuer: undefined, subjectPresent: false, expiresAt: undefined, issuedAt: undefined, authenticatedAt: undefined };
  }
}

function verificationErrorDetails(error: unknown) {
  return {
    code: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
    message: error instanceof Error ? error.message : 'Unknown Firebase Admin verification error',
  };
}

async function verifyFirebaseUser(request: NextRequest) {
  const authorization = request.headers.get('authorization')?.trim() || null;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : null;
  if (process.env.NODE_ENV !== 'production') {
    console.debug('Client document API authentication', {
      authorizationHeaderPresent: Boolean(authorization),
      bearerTokenParsed: Boolean(token),
    });
  }
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    if (process.env.NODE_ENV !== 'production') {
      console.debug('Client document API token verification', {
        verifyIdTokenSucceeded: true,
        verifiedUidPresent: Boolean(decoded.uid),
      });
    }
    return decoded.uid;
  } catch (error) {
    let adminProjectId: string | undefined;
    try {
      adminProjectId = assertFirebaseProject().projectId;
    } catch {
      adminProjectId = undefined;
    }
    console.error('Client document API token verification failed', {
      verifyIdTokenSucceeded: false,
      verifiedUidPresent: false,
      clientProjectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      adminProjectId,
      ...tokenDiagnosticClaims(token),
      ...verificationErrorDetails(error),
    });
    return null;
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ orgId: string; clientId: string; documentId: string }> }) {
  const uid = await verifyFirebaseUser(request);
  if (!uid) return errorResponse(401, 'Authentication is required.');

  const { orgId, clientId, documentId } = await context.params;
  if (![orgId, clientId, documentId].every(validId)) return errorResponse(400, 'Invalid document request.');

  const organizationRef = adminDb.doc(`organizations/${orgId}`);
  const membershipRef = organizationRef.collection('members').doc(uid);
  const licenseRef = organizationRef.collection('license').doc('current');
  const clientRef = organizationRef.collection('clients').doc(clientId);
  const documentRef = clientRef.collection('documents').doc(documentId);
  const [organizationSnapshot, membershipSnapshot, licenseSnapshot, clientSnapshot, documentSnapshot] = await Promise.all([
    organizationRef.get(), membershipRef.get(), licenseRef.get(), clientRef.get(), documentRef.get(),
  ]);

  if (!organizationSnapshot.exists || !membershipSnapshot.exists || !licenseSnapshot.exists) return errorResponse(403, 'You are not allowed to permanently delete this document.');
  const membership = membershipSnapshot.data() || {};
  if (membership.userId !== uid || membership.status !== 'active' || !['ADMIN', 'MANAGER'].includes(String(membership.role))) return errorResponse(403, 'You are not allowed to permanently delete this document.');
  if (!writableLicense(organizationSnapshot.data() || {}, licenseSnapshot.data() || {})) return errorResponse(409, 'Document deletion is unavailable for the current workspace license.');
  if (!clientSnapshot.exists || !documentSnapshot.exists) return errorResponse(404, 'The document could not be found.');

  const documentData = documentSnapshot.data() || {};
  if (documentData.archived !== true) return errorResponse(409, 'Only archived documents can be permanently deleted.');
  const storagePath = documentData.storagePath;
  const storagePrefix = `organizations/${orgId}/clients/${clientId}/documents/${documentId}/`;
  if (typeof storagePath !== 'string' || !storagePath.startsWith(storagePrefix) || storagePath.length <= storagePrefix.length) {
    return errorResponse(409, 'The document cannot be permanently deleted because its stored file reference is invalid.');
  }

  try {
    await adminStorageBucket().file(storagePath).delete();
  } catch (error) {
    if (!isMissingStorageObject(error)) {
      console.error('Client document server deletion failed', { organizationId: orgId, clientId, documentId, code: error && typeof error === 'object' && 'code' in error ? error.code : undefined });
      return errorResponse(502, 'Unable to delete the stored document. Please try again.');
    }
  }

  try {
    await adminDb.runTransaction(async (transaction) => {
      const latestDocument = await transaction.get(documentRef);
      if (!latestDocument.exists) return;
      const latestData = latestDocument.data() || {};
      if (latestData.archived !== true || latestData.storagePath !== storagePath) throw new Error('DOCUMENT_CHANGED');
      transaction.delete(documentRef);
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'DOCUMENT_CHANGED') return errorResponse(409, 'The document changed before deletion. Refresh and try again.');
    console.error('Client document metadata deletion failed', { organizationId: orgId, clientId, documentId });
    return errorResponse(500, 'Unable to permanently delete the document. Please try again.');
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest, context: { params: Promise<{ orgId: string; clientId: string; documentId: string }> }) {
  const uid = await verifyFirebaseUser(request);
  if (!uid) return errorResponse(401, 'Authentication is required.');

  const { orgId, clientId, documentId } = await context.params;
  if (![orgId, clientId, documentId].every(validId)) return errorResponse(400, 'Invalid document request.');

  let body: { storagePath?: unknown };
  try {
    body = await request.json() as { storagePath?: unknown };
  } catch {
    return errorResponse(400, 'Invalid cleanup request.');
  }

  const storagePath = body.storagePath;
  const storagePrefix = `organizations/${orgId}/clients/${clientId}/documents/${documentId}/`;
  if (typeof storagePath !== 'string' || !storagePath.startsWith(storagePrefix) || storagePath.slice(storagePrefix.length).length === 0 || storagePath.slice(storagePrefix.length).includes('/')) {
    return errorResponse(400, 'Invalid stored document reference.');
  }

  const organizationRef = adminDb.doc(`organizations/${orgId}`);
  const membershipRef = organizationRef.collection('members').doc(uid);
  const clientRef = organizationRef.collection('clients').doc(clientId);
  const [organizationSnapshot, membershipSnapshot, clientSnapshot] = await Promise.all([
    organizationRef.get(), membershipRef.get(), clientRef.get(),
  ]);
  const membership = membershipSnapshot.data() || {};
  if (!organizationSnapshot.exists || !membershipSnapshot.exists || !clientSnapshot.exists
    || membership.userId !== uid || membership.status !== 'active'
    || !['ADMIN', 'MANAGER'].includes(String(membership.role))) {
    return errorResponse(403, 'You are not allowed to clean up this document.');
  }

  try {
    await adminStorageBucket().file(storagePath).delete();
  } catch (error) {
    if (!isMissingStorageObject(error)) {
      console.error('Client document upload cleanup failed', { organizationId: orgId, clientId, documentId, code: error && typeof error === 'object' && 'code' in error ? error.code : undefined });
      return errorResponse(502, 'Unable to clean up the uploaded document. Please try again.');
    }
  }
  return NextResponse.json({ ok: true });
}
