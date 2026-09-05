'use client';

import React, { useState } from 'react';
import { MessageCircleQuestion } from 'lucide-react';
import { Button, Card } from '@/components/ui/core';
import { PageHeader } from '@/components/PageHeader';
import { submitFeedback } from '@/lib/repositories/feedback';
import { FEEDBACK_TYPES, type FeedbackType } from '@/lib/feedback';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { usePathname } from 'next/navigation';
import { userFacingErrorMessage } from '@/lib/repositories/pagination';

export default function FeedbackPage() {
  const { user } = useAuth();
  const { currentOrganizationId } = useWorkspace();
  const pathname = usePathname();
  const [type, setType] = useState<FeedbackType>('Report a Bug');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [emailWarning, setEmailWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (!user || !currentOrganizationId) {
      setError('Your organization is not ready yet. Please try again shortly.');
      return;
    }

    setIsSubmitting(true);
    setNotice(null);
    setEmailWarning(null);
    setError(null);
    try {
      const result = await submitFeedback(user, currentOrganizationId, {
        type,
        message,
        route: pathname || '/feedback',
      });
      setType('Report a Bug');
      setMessage('');
      setNotice('Thank you! Your feedback has been submitted.');
      if (result.emailNotificationStatus === 'FAILED') {
        setEmailWarning('Your feedback was saved, but the email notification could not be sent.');
      }
    } catch (submitError) {
      console.error('Unable to submit feedback', submitError);
      setError(userFacingErrorMessage(submitError, 'Unable to submit feedback. Please try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Feedback & Support" subtitle="Found an issue or have a suggestion? Let us know." />
      <Card className="max-w-2xl p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2 text-[var(--app-text)]">
          <MessageCircleQuestion size={20} className="text-[var(--app-primary)]" aria-hidden="true" />
          <h2 className="text-base font-semibold">Send feedback</h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="feedback-type" className="text-sm font-medium text-[var(--app-text)]">Type <span className="text-[var(--app-danger)]" aria-hidden="true">*</span></label>
            <select
              id="feedback-type"
              value={type}
              onChange={(event) => setType(event.target.value as FeedbackType)}
              className="h-9 w-full rounded-md border border-[var(--app-border)] bg-white px-3 text-sm text-[var(--app-text)] outline-none transition-colors focus:border-[var(--app-primary)] focus:ring-2 focus:ring-[var(--app-primary)]/20"
              required
              disabled={isSubmitting}
            >
              {FEEDBACK_TYPES.map((feedbackType) => <option key={feedbackType} value={feedbackType}>{feedbackType}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="feedback-message" className="text-sm font-medium text-[var(--app-text)]">Message <span className="text-[var(--app-danger)]" aria-hidden="true">*</span></label>
            <textarea
              id="feedback-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              className="min-h-32 w-full resize-y rounded-md border border-[var(--app-border)] bg-white px-3 py-2 text-sm text-[var(--app-text)] outline-none transition-colors placeholder:text-[var(--app-tertiary)] focus:border-[var(--app-primary)] focus:ring-2 focus:ring-[var(--app-primary)]/20"
              placeholder="Tell us how we can help."
              maxLength={5000}
              required
              disabled={isSubmitting}
            />
          </div>
          {notice && <p className="rounded-md bg-[var(--app-accent-soft)] px-3 py-2 text-sm text-[var(--app-primary)]" role="status">{notice}</p>}
          {emailWarning && <p className="rounded-md bg-[color-mix(in_srgb,var(--app-warning)_13%,white)] px-3 py-2 text-sm text-[var(--app-text)]" role="status">{emailWarning}</p>}
          {error && <p className="rounded-md bg-[color-mix(in_srgb,var(--app-danger)_9%,white)] px-3 py-2 text-sm text-[var(--app-danger)]" role="alert">{error}</p>}
          <Button type="submit" disabled={isSubmitting || !message.trim()}>{isSubmitting ? 'Submitting…' : 'Submit'}</Button>
        </form>
      </Card>
    </div>
  );
}
