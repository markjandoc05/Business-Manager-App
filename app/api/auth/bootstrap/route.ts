import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getAuthenticatedUser } from '@/lib/server/auth';
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

function responseWithRequestId(body: Record<string, unknown>, status: number, requestId: string) {
  return NextResponse.json(body, { status, headers: { 'x-bootstrap-request-id': requestId } });
}

function hasBearerToken(request: NextRequest) {
  const header = request.headers.get('authorization')?.trim() || '';
  const parts = header.split(/\s+/);
  return parts.length === 2 && parts[0] === 'Bearer' && Boolean(parts[1]);
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const log = (message: string) => console.info(`[workspace-bootstrap:${requestId}] ${message}`);
  log('start');
  if (!hasBearerToken(request)) {
    log('failed stage=authorization-header code=AUTH_REQUIRED message=Authentication is required.');
    return responseWithRequestId({ error: 'Authentication is required.', code: 'AUTH_REQUIRED' }, 401, requestId);
  }

  let authenticatedUser;
  try {
    authenticatedUser = await getAuthenticatedUser(request);
  } catch (error) {
    const safeError = safeBootstrapError(error);
    console.warn(`[workspace-bootstrap:${requestId}] failed stage=token-verification code=${safeError.code} message=${safeError.message}`);
    return responseWithRequestId({ error: 'We could not verify your BSM session.', code: 'AUTHENTICATION_FAILED' }, 503, requestId);
  }
  if (!authenticatedUser) {
    log('failed stage=token-verification code=AUTH_REQUIRED message=Authentication is required.');
    return responseWithRequestId({ error: 'Authentication is required.', code: 'AUTH_REQUIRED' }, 401, requestId);
  }
  log('token-verified');

  try {
    const result = await bootstrapWorkspaceAccess(authenticatedUser.uid, { onStage: (stage) => log(stage) });
    log('completed');
    return responseWithRequestId({ ok: true, data: result }, 200, requestId);
  } catch (error) {
    const safeError = safeBootstrapError(error);
    const stage = error instanceof WorkspaceBootstrapError ? error.stage : safeError.stage as WorkspaceBootstrapStage | 'unknown';
    console.warn(`[workspace-bootstrap:${requestId}] failed stage=${stage} code=${safeError.code} message=${safeError.message}`);
    const response: { error: string; code: string; debug?: { stage: string; code: string; message: string; requestId: string } } = {
      error: 'We could not prepare your BSM workspace access yet.',
      code: 'WORKSPACE_BOOTSTRAP_FAILED',
    };
    if (process.env.NODE_ENV !== 'production') response.debug = { stage, code: safeError.code, message: safeError.message, requestId };
    return responseWithRequestId(response, 503, requestId);
  }
}
