import { requireOrganizationAccess } from '@/lib/permissions';
import type { AppUser } from '@/types/auth';
import type { FeedbackType } from '@/lib/feedback';
import { authenticatedFetch } from '@/lib/repositories/authenticatedRequest';

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
  const response = await authenticatedFetch(`/api/organizations/${encodeURIComponent(organizationId)}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json().catch(() => null) as Partial<SubmitFeedbackResponse> & { error?: string } | null;
  if (!response.ok || !payload?.ok || !payload.feedbackId) {
    throw new Error(payload?.error || 'Unable to submit feedback. Please try again.');
  }
  return payload as SubmitFeedbackResponse;
}
