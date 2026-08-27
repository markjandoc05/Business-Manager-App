import { auth } from '@/lib/firebase/client';
import { requireOrganizationAccess } from '@/lib/permissions';
import type { AppUser } from '@/types/auth';
import type { FeedbackType } from '@/lib/feedback';

export interface SubmitFeedbackInput {
  type: FeedbackType;
  message: string;
  route: string;
}

interface SubmitFeedbackResponse {
  ok: boolean;
  feedbackId: string;
  emailNotificationStatus: 'SENT' | 'FAILED';
}

export async function submitFeedback(user: AppUser | null, organizationId: string, input: SubmitFeedbackInput) {
  await requireOrganizationAccess(user, organizationId);
  await auth.authStateReady();
  const firebaseUser = auth.currentUser;
  if (!firebaseUser) throw new Error('Authentication is required.');

  const token = await firebaseUser.getIdToken(false);
  const response = await fetch(`/api/organizations/${encodeURIComponent(organizationId)}/feedback`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => null) as Partial<SubmitFeedbackResponse> & { error?: string } | null;
  if (!response.ok || !payload?.ok || !payload.feedbackId) {
    throw new Error(payload?.error || 'Unable to submit feedback. Please try again.');
  }
  return payload as SubmitFeedbackResponse;
}
