import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { authorizationHeaderDiagnostics, getAuthenticatedUser } from '@/lib/server/auth';
import { bootstrapWorkspaceAccess, WorkspaceBootstrapError, type WorkspaceBootstrapStage } from '@/lib/server/workspace-bootstrap';

export const runtime = 'nodejs';

function safeBootstrapError(error: unknown) {
  const candidate = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown; stage?: unknown } : {};
  const code = typeof candidate.code === 'string' && candidate.code.trim() ? candidate.code.trim().slice(0, 120) : 'BOOTSTRAP_FAILED';
  const message = typeof candidate.message === 'string' && candidate.message.trim()
    ? candidate.message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/-----BEGIN[\s\S]*?-----END[^-]+-----/g, '[redacted]').slice(0, 300)
    : 'Workspace bootstrap failed.';
  const stage = typeof candidate.stage === 'string' && candidate.stage.trim() ? candidate.stage.trim().slice(0, 120) : 'unknown';
  return { code, message, stage };
}

function serverTimingHeader(timings: Record<string, number>) {
  return Object.entries(timings)
    .filter(([, durationMs]) => Number.isFinite(durationMs) && durationMs >= 0)
    .map(([metric, durationMs]) => `${metric};dur=${durationMs}`)
    .join(', ');
}

function responseWithRequestId(body: Record<string, unknown>, status: number, requestId: string, timings: Record<string, number>) {
  const serverTiming = serverTimingHeader(timings);
  return NextResponse.json(body, {
    status,
    headers: {
      'x-bootstrap-request-id': requestId,
      ...(serverTiming ? { 'server-timing': serverTiming } : {}),
    },
  });
}

function bootstrapTriggerDiagnostics(request: NextRequest) {
  const rawTrigger = request.headers.get('x-bootstrap-trigger') || '';
  const trigger = ['auth-state-initial', 'auth-state-user-change', 'auth-state-repeat', 'manual-retry'].includes(rawTrigger)
    ? rawTrigger
    : 'unknown';
  const rawEvent = request.headers.get('x-bootstrap-auth-event') || '';
  const authEvent = /^\d{1,6}$/.test(rawEvent) ? rawEvent : 'unknown';
  return { trigger, authEvent };
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const requestStartedAt = performance.now();
  const timings: Record<string, number> = {};
  const recordTiming = (metric: string, startedAt: number) => {
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    timings[metric] = durationMs;
    console.info(`[workspace-bootstrap:${requestId}] timing ${metric}=${durationMs}ms`);
  };
  const respond = (body: Record<string, unknown>, status: number) => {
    recordTiming('total', requestStartedAt);
    return responseWithRequestId({ ...body, timings }, status, requestId, timings);
  };
  const log = (message: string) => console.info(`[workspace-bootstrap:${requestId}] ${message}`);
  const triggerDiagnostics = bootstrapTriggerDiagnostics(request);
  const headerDiagnostics = authorizationHeaderDiagnostics(request);
  log(`start trigger=${triggerDiagnostics.trigger} authEvent=${triggerDiagnostics.authEvent}`);
  if (!headerDiagnostics.bearerPrefixValid) {
    const classification = headerDiagnostics.authorizationHeaderPresent ? 'AUTH_BEARER_INVALID' : 'AUTH_HEADER_MISSING';
    log(`[firebase-auth] requestId=${requestId} stage=authorization-header classification=${classification} firebaseCode=none project=unknown authorizationHeaderPresent=${headerDiagnostics.authorizationHeaderPresent} bearerPrefixValid=${headerDiagnostics.bearerPrefixValid} tokenLength=${headerDiagnostics.tokenLength}`);
    return respond({ error: 'Authentication is required.', code: 'AUTH_REQUIRED' }, 401);
  }

  let authenticatedUser;
  const tokenVerificationStartedAt = performance.now();
  try {
    authenticatedUser = await getAuthenticatedUser(request, {
      onVerificationFailure: (diagnostic) => log(`[firebase-auth] requestId=${requestId} stage=token-verification classification=${diagnostic.classification} firebaseCode=${diagnostic.firebaseCode} project=${process.env.GOOGLE_CLOUD_PROJECT || 'unknown'} authorizationHeaderPresent=${headerDiagnostics.authorizationHeaderPresent} bearerPrefixValid=${headerDiagnostics.bearerPrefixValid} tokenLength=${headerDiagnostics.tokenLength} message=${diagnostic.message}`),
    });
  } catch {
    authenticatedUser = null;
  } finally {
    recordTiming('token-verification', tokenVerificationStartedAt);
  }
  if (!authenticatedUser) {
    log('failed stage=token-verification code=AUTH_REQUIRED message=Authentication is required.');
    return respond({ error: 'Authentication is required.', code: 'AUTH_REQUIRED' }, 401);
  }
  log('token-verified');

  try {
    const result = await bootstrapWorkspaceAccess(authenticatedUser.uid, {
      // getAuthenticatedUser already performs verifyIdToken(token, true),
      // including the disabled/revoked-user check. Reuse that verified
      // identity so bootstrap does not perform a redundant Admin Auth lookup.
      authUser: authenticatedUser,
      onStage: (stage) => log(stage),
      onTiming: (metric, durationMs) => {
        const timingMetric = `bootstrap-${metric}`;
        timings[timingMetric] = durationMs;
        log(`timing ${timingMetric}=${durationMs}ms`);
      },
    });
    log('completed');
    return respond({ ok: true, data: result }, 200);
  } catch (error) {
    const safeError = safeBootstrapError(error);
    const stage = error instanceof WorkspaceBootstrapError ? error.stage : safeError.stage as WorkspaceBootstrapStage | 'unknown';
    console.warn(`[workspace-bootstrap:${requestId}] failed stage=${stage} code=${safeError.code} message=${safeError.message}`);
    const response: { error: string; code: string; debug?: { stage: string; code: string; message: string; requestId: string } } = {
      error: 'We could not prepare your BSM workspace access yet.',
      code: 'WORKSPACE_BOOTSTRAP_FAILED',
    };
    if (process.env.NODE_ENV !== 'production') response.debug = { stage, code: safeError.code, message: safeError.message, requestId };
    return respond(response, 503);
  }
}
