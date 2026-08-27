import type { FeedbackType } from '@/lib/feedback';

export interface FeedbackEmailInput {
  type: FeedbackType;
  message: string;
  userName: string;
  userEmail: string;
  route: string;
  appVersion: string;
  submittedAt: string;
}

export interface FeedbackEmailContent {
  subject: string;
  text: string;
  html: string;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlText(value: string) {
  return escapeHtml(value).replace(/\r?\n/g, '<br />');
}

export function formatFeedbackSubmittedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '';

  return `${getPart('month')} ${getPart('day')}, ${getPart('year')} • ${getPart('hour')}:${getPart('minute')} ${getPart('dayPeriod')}`;
}

export function buildFeedbackEmail(input: FeedbackEmailInput): FeedbackEmailContent {
  const subjectEmail = input.userEmail.replace(/[\r\n]/g, ' ').trim() || 'unknown user';
  const submittedAt = formatFeedbackSubmittedAt(input.submittedAt);
  const userEmail = input.userEmail || 'No email available';
  const subject = `[BSM Feedback] ${input.type} - ${subjectEmail}`;
  const text = [
    'Business Sales Manager',
    'Feedback & Support',
    '',
    input.type,
    '',
    'Message',
    '-------',
    input.message,
    '',
    'Submitted by',
    input.userName,
    userEmail,
    '',
    'Page',
    input.route,
    '',
    'App Version',
    input.appVersion,
    '',
    'Submitted',
    submittedAt,
    '',
    'Business Sales Manager (BSM)',
    'Feedback & Support Notification',
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f8fafc;color:#334155;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;width:100%;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="border-top:4px solid #2563eb;padding:24px 24px 18px;">
                <div style="font-size:13px;line-height:20px;color:#64748b;">Business Sales Manager</div>
                <div style="font-size:22px;line-height:30px;font-weight:700;color:#0f172a;">Feedback &amp; Support</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 24px;">
                <div style="font-size:11px;line-height:16px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#64748b;">Feedback type</div>
                <div style="margin-top:4px;font-size:22px;line-height:30px;font-weight:700;color:#0f172a;">${escapeHtml(input.type)}</div>
                <div style="margin-top:22px;padding:16px 18px;background:#eff6ff;border-left:4px solid #2563eb;border-radius:4px;">
                  <div style="font-size:14px;line-height:20px;font-weight:700;color:#1e3a8a;">Message</div>
                  <div style="margin-top:8px;font-size:15px;line-height:24px;color:#334155;">${htmlText(input.message)}</div>
                </div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin-top:22px;">
                  <tr>
                    <td style="padding:0 12px 16px 0;vertical-align:top;width:50%;">
                      <div style="font-size:11px;line-height:16px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#64748b;">Submitted by</div>
                      <div style="margin-top:4px;font-size:14px;line-height:21px;color:#0f172a;">${htmlText(input.userName)}<br />${escapeHtml(userEmail)}</div>
                    </td>
                    <td style="padding:0 0 16px 12px;vertical-align:top;width:50%;">
                      <div style="font-size:11px;line-height:16px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#64748b;">Page</div>
                      <div style="margin-top:4px;font-size:14px;line-height:21px;color:#0f172a;">${escapeHtml(input.route)}</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:0 12px 0 0;vertical-align:top;width:50%;">
                      <div style="font-size:11px;line-height:16px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#64748b;">App version</div>
                      <div style="margin-top:4px;font-size:14px;line-height:21px;color:#0f172a;">${escapeHtml(input.appVersion)}</div>
                    </td>
                    <td style="padding:0 0 0 12px;vertical-align:top;width:50%;">
                      <div style="font-size:11px;line-height:16px;letter-spacing:1px;text-transform:uppercase;font-weight:700;color:#64748b;">Submitted</div>
                      <div style="margin-top:4px;font-size:14px;line-height:21px;color:#0f172a;">${escapeHtml(submittedAt)}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid #e2e8f0;padding:16px 24px 18px;text-align:center;">
                <div style="font-size:12px;line-height:18px;font-weight:700;color:#64748b;">Business Sales Manager (BSM)</div>
                <div style="font-size:12px;line-height:18px;color:#94a3b8;">Feedback &amp; Support Notification</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, text, html };
}
