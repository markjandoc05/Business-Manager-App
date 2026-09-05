import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthenticatedUser } from '@/lib/server/auth';
import { recordMemberLoginSuccess } from '@/lib/server/login-activity';

export const runtime = 'nodejs';

function serverTimingHeader(timings: Record<string, number>) {
  return Object.entries(timings)
    .filter(([, durationMs]) => Number.isFinite(durationMs) && durationMs >= 0)
    .map(([metric, durationMs]) => `${metric};dur=${durationMs}`)
    .join(', ');
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const requestStartedAt = performance.now();
  const timings: Record<string, number> = {};
  const recordTiming = (metric: string, startedAt: number) => {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    timings[metric] = durationMs;
    console.info(`[login-activity:${requestId}] timing ${metric}=${durationMs}ms`);
  };
  const respond = (body: Record<string, unknown>, status: number) => {
    recordTiming('total', requestStartedAt);
    const serverTiming = serverTimingHeader(timings);
    return NextResponse.json({ ...body, timings }, {
      status,
      headers: {
        'x-login-activity-request-id': requestId,
        ...(serverTiming ? { 'server-timing': serverTiming } : {}),
      },
    });
  };

  const tokenVerificationStartedAt = performance.now();
  const authenticatedUser = await getAuthenticatedUser(request);
  recordTiming('token-verification', tokenVerificationStartedAt);
  if (!authenticatedUser) return respond({ error: 'Authentication is required.' }, 401);

  let body: unknown;
  try { body = await request.json(); } catch { return respond({ error: 'Invalid request payload.' }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return respond({ error: 'Invalid request payload.' }, 400);
  const payload = body as Record<string, unknown>;
  const orgId = typeof payload.orgId === 'string' ? payload.orgId : '';
  if (!orgId || Object.keys(payload).some((key) => key !== 'orgId')) return respond({ error: 'Invalid login activity request.' }, 400);

  try {
    const recorded = await recordMemberLoginSuccess(orgId, authenticatedUser.uid, {
      onTiming: (metric, durationMs) => {
        const timingMetric = `activity-${metric}`;
        timings[timingMetric] = durationMs;
        console.info(`[login-activity:${requestId}] timing ${timingMetric}=${durationMs}ms`);
      },
    });
    return recorded ? respond({ ok: true }, 200) : respond({ error: 'Workspace membership was not found or is inactive.' }, 403);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('Invalid ')) return respond({ error: 'Invalid login activity request.' }, 400);
    console.warn('[login-activity] recording failed:', error);
    return respond({ error: 'Login activity could not be recorded.' }, 503);
  }
}
