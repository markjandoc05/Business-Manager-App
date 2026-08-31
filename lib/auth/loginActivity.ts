import type { User as FirebaseUser } from 'firebase/auth';
import type { MemberLoginFailureCode, MemberLoginStatus } from '@/types/auth';

export async function recordClientLoginActivity(firebaseUser: FirebaseUser, orgId: string, status: MemberLoginStatus, failureCode?: MemberLoginFailureCode) {
  const token = await firebaseUser.getIdToken();
  const response = await fetch(status === 'FAILED' ? '/api/auth/login-activity/failure' : '/api/auth/login-activity', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    // Failure codes are intentionally not accepted from the browser. Trusted
    // server flows choose and sanitize them before calling the persistence helper.
    body: JSON.stringify({ orgId }),
  });
  if (!response.ok) throw new Error('Login activity could not be recorded.');
}
