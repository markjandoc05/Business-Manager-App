import type { NextRequest } from 'next/server';
import { adminAuth, adminDb } from '@/lib/server/firebase-admin';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  name?: string;
}

/**
 * Authenticate a protected API request with a current, non-revoked Firebase
 * ID token. Callers must perform organization and role authorization separately.
 */
export async function getAuthenticatedUser(request: Pick<NextRequest, 'headers'>): Promise<AuthenticatedUser | null> {
  const header = request.headers.get('authorization')?.trim() || '';
  const parts = header.split(/\s+/);
  if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) return null;

  try {
    const decoded = await adminAuth.verifyIdToken(parts[1], true);
    return {
      uid: decoded.uid,
      ...(typeof decoded.email === 'string' ? { email: decoded.email } : {}),
      ...(typeof decoded.name === 'string' ? { name: decoded.name } : {}),
    };
  } catch {
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
