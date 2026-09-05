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
export type MemberLoginActivityTimingMetric =
  | 'member-read'
  | 'member-write-staged'
  | 'transaction-callback'
  | 'transaction-total'
  | 'transaction-commit-overhead';

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
export async function recordMemberLoginActivity(
  { orgId, uid, status, failureCode }: RecordMemberLoginActivityInput,
  options: { onTiming?: (metric: MemberLoginActivityTimingMetric, durationMs: number) => void } = {},
) {
  const organizationId = validateDocumentId(orgId, 'organization ID');
  const userId = validateDocumentId(uid, 'user ID');
  if (!MEMBER_LOGIN_STATUSES.includes(status)) throw new Error('Invalid member login status.');

  const transactionStartedAt = performance.now();
  let transactionCallbackDurationMs = 0;
  const recordTiming = (metric: MemberLoginActivityTimingMetric, startedAt: number) => {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    options.onTiming?.(metric, durationMs);
    return durationMs;
  };
  const recorded = await adminDb.runTransaction(async (transaction) => {
    const callbackStartedAt = performance.now();
    try {
      const memberRef = adminDb.doc(`organizations/${organizationId}/members/${userId}`);
      const memberReadStartedAt = performance.now();
      const memberSnapshot = await transaction.get(memberRef);
      recordTiming('member-read', memberReadStartedAt);
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
      const memberWriteStartedAt = performance.now();
      transaction.update(memberRef, update);
      // Like bootstrap, the actual write RPC is part of the transaction commit.
      recordTiming('member-write-staged', memberWriteStartedAt);
      return true;
    } finally {
      transactionCallbackDurationMs += Math.max(0, Math.round(performance.now() - callbackStartedAt));
      options.onTiming?.('transaction-callback', transactionCallbackDurationMs);
    }
  });
  const transactionTotalMs = recordTiming('transaction-total', transactionStartedAt);
  options.onTiming?.('transaction-commit-overhead', Math.max(0, transactionTotalMs - transactionCallbackDurationMs));
  return recorded;
}

export function recordMemberLoginSuccess(orgId: string, uid: string, options?: { onTiming?: (metric: MemberLoginActivityTimingMetric, durationMs: number) => void }) {
  return recordMemberLoginActivity({ orgId, uid, status: 'SUCCESS' }, options);
}

export function recordMemberLoginFailure(orgId: string, uid: string, failureCode?: unknown, options?: { onTiming?: (metric: MemberLoginActivityTimingMetric, durationMs: number) => void }) {
  return recordMemberLoginActivity({ orgId, uid, status: 'FAILED', failureCode }, options);
}
