import type { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/server/firebase-admin';
import { describeFirebaseAuthError, type FirebaseAuthDiagnostic } from './firebase-auth-diagnostics';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  name?: string;
  /**
   * These fields come from the ID token that was just verified with
   * checkRevoked=true. Keeping them with the authenticated identity lets the
   * bootstrap route reuse that verification instead of issuing a second
   * Admin Auth getUser request.
   */
  emailVerified: boolean;
  disabled: boolean;
}

export function authorizationHeaderDiagnostics(request: Pick<NextRequest, 'headers'>) {
  const header = request.headers.get('authorization')?.trim() || '';
  const parts = header.split(/\s+/);
  const bearerPrefixValid = parts.length === 2 && parts[0] === 'Bearer' && Boolean(parts[1]);
  return {
    authorizationHeaderPresent: Boolean(header),
    bearerPrefixValid,
    tokenLength: bearerPrefixValid ? parts[1].length : 0,
  };
}

/**
 * Authenticate a protected API request with a current, non-revoked Firebase
 * ID token. Callers must perform organization and role authorization separately.
 */
export async function getAuthenticatedUser(
  request: Pick<NextRequest, 'headers'>,
  options: { onVerificationFailure?: (diagnostic: FirebaseAuthDiagnostic) => void } = {},
): Promise<AuthenticatedUser | null> {
  const header = request.headers.get('authorization')?.trim() || '';
  const parts = header.split(/\s+/);
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) return null;

  try {
    const decoded = await adminAuth.verifyIdToken(parts[1], true);
    return {
      uid: decoded.uid,
      ...(typeof decoded.email === 'string' ? { email: decoded.email } : {}),
      ...(typeof decoded.name === 'string' ? { name: decoded.name } : {}),
      // verifyIdToken(..., true) rejects disabled and revoked sessions before
      // returning these claims. The disabled flag is therefore safely false
      // for a request that reached this point.
      emailVerified: decoded.email_verified === true,
      disabled: false,
    };
  } catch (error) {
    options.onVerificationFailure?.(describeFirebaseAuthError(error));
    return null;
  }
}

export async function isApplicationUserActive(uid: string) {
  const snapshot = await adminDb.doc(`users/${uid}`).get();
  if (!snapshot.exists) return false;
  const data = snapshot.data() || {};
  return data.uid === uid
    && data.status === 'active'
    && (!Object.prototype.hasOwnProperty.call(data, 'active') || data.active === true);
}

export async function setFirebaseAccountDisabled(uid: string, disabled: boolean) {
  if (disabled) {
    await adminAuth.updateUser(uid, { disabled: true });
    await adminAuth.revokeRefreshTokens(uid);
    return;
  }

  await adminAuth.updateUser(uid, { disabled: false });
  // A re-enabled account must not regain access with a token issued before
  // the account was disabled.
  await adminAuth.revokeRefreshTokens(uid);
}
