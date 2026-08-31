import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin.ts';

export const MEMBER_LOGIN_STATUSES = ['SUCCESS', 'FAILED'] as const;
export type MemberLoginStatus = typeof MEMBER_LOGIN_STATUSES[number];

export const MEMBER_LOGIN_FAILURE_CODES = [
  'BOOTSTRAP_FAILED',
  'MEMBERSHIP_INACTIVE',
  'LICENSE_BLOCKED',
  'WORKSPACE_ACCESS_FAILED',
] as const;
export type MemberLoginFailureCode = typeof MEMBER_LOGIN_FAILURE_CODES[number];

const DOCUMENT_ID_PATTERN = /^[^/]{1,150}$/;

function validateDocumentId(value: unknown, label: string) {
  if (typeof value !== 'string' || !DOCUMENT_ID_PATTERN.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

export function sanitizeMemberLoginFailureCode(value: unknown): MemberLoginFailureCode {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_') : '';
  return (MEMBER_LOGIN_FAILURE_CODES as readonly string[]).includes(normalized)
    ? normalized as MemberLoginFailureCode
    : 'WORKSPACE_ACCESS_FAILED';
}

export interface RecordMemberLoginActivityInput {
  orgId: string;
  uid: string;
  status: MemberLoginStatus;
  failureCode?: unknown;
}

/**
 * Records organization-scoped login telemetry for a verified server flow.
 * The caller must obtain uid from a verified Firebase ID token. This helper
 * deliberately updates no access-control or licensing fields.
 */
export async function recordMemberLoginActivity({ orgId, uid, status, failureCode }: RecordMemberLoginActivityInput) {
  const organizationId = validateDocumentId(orgId, 'organization ID');
  const userId = validateDocumentId(uid, 'user ID');
  if (!MEMBER_LOGIN_STATUSES.includes(status)) throw new Error('Invalid member login status.');

  return adminDb.runTransaction(async (transaction) => {
    const memberRef = adminDb.doc(`organizations/${organizationId}/members/${userId}`);
    const memberSnapshot = await transaction.get(memberRef);
    const memberData = memberSnapshot.data() || {};
    if (!memberSnapshot.exists || memberData.userId !== userId) return false;
    if (status === 'SUCCESS' && memberData.status !== 'active') return false;

    const update = status === 'SUCCESS'
      ? {
          lastLoginAt: FieldValue.serverTimestamp(),
          lastLoginStatus: 'SUCCESS' as const,
          lastSuccessfulLoginAt: FieldValue.serverTimestamp(),
        }
      : {
          lastLoginAt: FieldValue.serverTimestamp(),
          lastLoginStatus: 'FAILED' as const,
          lastFailedLoginAt: FieldValue.serverTimestamp(),
          lastLoginFailureCode: sanitizeMemberLoginFailureCode(failureCode),
        };
    transaction.update(memberRef, update);
    return true;
  });
}

export function recordMemberLoginSuccess(orgId: string, uid: string) {
  return recordMemberLoginActivity({ orgId, uid, status: 'SUCCESS' });
}

export function recordMemberLoginFailure(orgId: string, uid: string, failureCode?: unknown) {
  return recordMemberLoginActivity({ orgId, uid, status: 'FAILED', failureCode });
}
