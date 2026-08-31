import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import packageJson from '@/package.json';
import { adminDb } from '@/lib/server/firebase-admin';
import { getAuthenticatedUser, isApplicationUserActive } from '@/lib/server/auth';
import { FEEDBACK_TYPES, type FeedbackType } from '@/lib/feedback';
import { buildFeedbackEmail } from '@/lib/server/feedback-email';

export const runtime = 'nodejs';

const FEEDBACK_RECIPIENT = 'markjandoc@gmail.com';
const MAX_MESSAGE_LENGTH = 5_000;
const MAX_ROUTE_LENGTH = 200;
const MAX_APP_VERSION_LENGTH = 64;

function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.length <= 128 && !value.includes('/');
}

function isFeedbackType(value: unknown): value is FeedbackType {
  return typeof value === 'string' && (FEEDBACK_TYPES as readonly string[]).includes(value);
}

function cleanRoute(value: unknown) {
  if (typeof value !== 'string') return '/feedback';
  const route = value.trim().slice(0, MAX_ROUTE_LENGTH);
  return route.startsWith('/') ? route : '/feedback';
}

function cleanText(value: unknown, fallback: string) {
  return typeof value === 'string' ? value.trim() : fallback;
}

async function sendFeedbackNotification(input: {
  type: FeedbackType;
  message: string;
  userName: string;
  userEmail: string;
  route: string;
  appVersion: string;
  submittedAt: string;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.FEEDBACK_EMAIL_FROM?.trim();
  if (!apiKey || !from) throw new Error('Feedback email delivery is not configured.');

  const email = buildFeedbackEmail(input);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [FEEDBACK_RECIPIENT],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Feedback email provider returned HTTP ${response.status}.`);
}

export async function POST(request: NextRequest, context: { params: Promise<{ orgId: string }> }) {
  const authenticatedUser = await getAuthenticatedUser(request);
  if (!authenticatedUser) return errorResponse(401, 'Authentication is required.');
  if (!await isApplicationUserActive(authenticatedUser.uid)) return errorResponse(403, 'Your BSM account is not active.');

  const { orgId } = await context.params;
  if (!validId(orgId)) return errorResponse(400, 'Invalid organization.');

  let body: { type?: unknown; message?: unknown; route?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, 'Invalid feedback request.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) || !isFeedbackType(body.type)) {
    return errorResponse(400, 'Select a valid feedback type.');
  }

  const message = cleanText(body.message, '');
  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return errorResponse(400, `Message must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`);
  }

  const organizationRef = adminDb.doc(`organizations/${orgId}`);
  const membershipRef = organizationRef.collection('members').doc(authenticatedUser.uid);
  const [organizationSnapshot, membershipSnapshot] = await Promise.all([organizationRef.get(), membershipRef.get()]);
  const organization = organizationSnapshot.data() || {};
  const membership = membershipSnapshot.data() || {};
  if (!organizationSnapshot.exists || !membershipSnapshot.exists
    || membership.userId !== authenticatedUser.uid
    || membership.status !== 'active'
    || !['ADMIN', 'MANAGER', 'USER'].includes(String(membership.role))
    || !['trial', 'active', 'expired', 'suspended'].includes(String(organization.status))) {
    return errorResponse(403, 'You do not have access to this organization.');
  }

  const feedbackRef = organizationRef.collection('feedback').doc();
  const appVersion = cleanText(process.env.NEXT_PUBLIC_APP_VERSION, packageJson.version).slice(0, MAX_APP_VERSION_LENGTH);
  const userEmail = authenticatedUser.email || (typeof membership.email === 'string' ? membership.email : '');
  const userName = typeof membership.displayName === 'string' && membership.displayName.trim()
    ? membership.displayName.trim()
    : authenticatedUser.name && authenticatedUser.name.trim() ? authenticatedUser.name.trim() : userEmail || 'User';
  const route = cleanRoute(body.route);
  const submittedAt = new Date().toISOString();

  await feedbackRef.set({
    type: body.type,
    message,
    userId: authenticatedUser.uid,
    userEmail,
    userName,
    route,
    appVersion,
    status: 'NEW',
    createdAt: FieldValue.serverTimestamp(),
    emailNotificationStatus: 'PENDING',
  });

  let emailNotificationStatus: 'SENT' | 'FAILED' = 'FAILED';
  let emailNotificationError: string | undefined;
  try {
    await sendFeedbackNotification({
      type: body.type,
      message,
      userName,
      userEmail,
      route,
      appVersion,
      submittedAt,
    });
    emailNotificationStatus = 'SENT';
  } catch (emailError) {
    emailNotificationError = 'Email notification could not be delivered.';
    console.error('Unable to send BSM feedback notification', { feedbackId: feedbackRef.id, error: emailError });
  }

  try {
    await feedbackRef.update({
      emailNotificationStatus,
      ...(emailNotificationError ? { emailNotificationError } : {}),
      emailNotificationUpdatedAt: FieldValue.serverTimestamp(),
    });
  } catch (statusError) {
    console.error('Unable to update BSM feedback notification status', { feedbackId: feedbackRef.id, error: statusError });
  }

  return NextResponse.json({ ok: true, feedbackId: feedbackRef.id, emailNotificationStatus }, { status: 201 });
}
