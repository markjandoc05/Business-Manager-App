import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/server/auth';
import { isValidIdempotencyKey, parseTrialProxyRequest, platformProxyResponse, proxyPlatformRequest } from '@/lib/server/platform-api';

export const runtime = 'nodejs';

function errorResponse(code: 'UNAUTHENTICATED' | 'INVALID_REQUEST', status: number, message: string) {
  return Response.json({ success: false, error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get('authorization')?.trim() || '';
  if (!await getAuthenticatedUser(request)) return errorResponse('UNAUTHENTICATED', 401, 'Authentication is required.');

  const idempotencyKey = request.headers.get('idempotency-key');
  if (!isValidIdempotencyKey(idempotencyKey)) return errorResponse('INVALID_REQUEST', 400, 'A valid provisioning idempotency key is required.');

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse('INVALID_REQUEST', 400, 'Invalid provisioning request.');
  }
  const body = parseTrialProxyRequest(rawBody);
  if (!body) return errorResponse('INVALID_REQUEST', 400, 'Invalid provisioning request.');

  return platformProxyResponse(await proxyPlatformRequest('/api/v1/trials', {
    method: 'POST',
    authorization,
    idempotencyKey,
    body,
  }));
}
