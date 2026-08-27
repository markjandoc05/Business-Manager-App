import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedbackEmail, formatFeedbackSubmittedAt } from '../lib/server/feedback-email.ts';

const input = {
  type: 'Report a Bug',
  message: 'The Add Lead button is not working on mobile.',
  userName: 'Mark Garcia Jandoc',
  userEmail: 'markjandoc@gmail.com',
  route: '/feedback',
  appVersion: '0.1.0',
  submittedAt: '2026-08-27T15:14:00.000Z',
};

test('formats feedback email date in Philippine time', () => {
  assert.equal(formatFeedbackSubmittedAt(input.submittedAt), 'Aug 27, 2026 • 11:14 PM');
  assert.equal(formatFeedbackSubmittedAt('not-a-date'), 'Unknown');
});

test('builds matching subject, HTML email, and plain-text fallback', () => {
  const email = buildFeedbackEmail(input);

  assert.equal(email.subject, '[BSM Feedback] Report a Bug - markjandoc@gmail.com');
  assert.match(email.html, /^<!doctype html>/);
  assert.match(email.html, /Business Sales Manager/);
  assert.match(email.html, /Feedback &amp; Support/);
  assert.match(email.html, /Report a Bug/);
  assert.match(email.html, /The Add Lead button is not working on mobile\./);
  assert.match(email.html, /Aug 27, 2026 • 11:14 PM/);
  assert.match(email.html, /Feedback &amp; Support Notification/);
  assert.doesNotMatch(email.html, /2026-08-27T15:14:00\.000Z/);

  assert.match(email.text, /Message\n-------\nThe Add Lead button is not working on mobile\./);
  assert.match(email.text, /Submitted by\nMark Garcia Jandoc\nmarkjandoc@gmail\.com/);
  assert.match(email.text, /Aug 27, 2026 • 11:14 PM/);
  assert.doesNotMatch(email.text, /2026-08-27T15:14:00\.000Z/);
});

test('escapes user-controlled HTML content', () => {
  const email = buildFeedbackEmail({ ...input, message: '<script>alert("x")</script>\nKeep me safe.' });

  assert.match(email.html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;<br \/>Keep me safe\./);
  assert.doesNotMatch(email.html, /<script>alert/);
});
