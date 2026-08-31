import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/server/auth';
import { recordMemberLoginSuccess } from '@/lib/server/login-activity';

export const runtime = 'nodejs';

function errorResponse(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }

export async function POST(request: NextRequest) {
  const authenticatedUser = await getAuthenticatedUser(request);
  if (!authenticatedUser) return errorResponse('Authentication is required.', 401);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse('Invalid request payload.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse('Invalid request payload.', 400);
  const payload = body as Record<string, unknown>;
  const orgId = typeof payload.orgId === 'string' ? payload.orgId : '';
  if (!orgId || Object.keys(payload).some((key) => key !== 'orgId')) return errorResponse('Invalid login activity request.', 400);

  try {
    const recorded = await recordMemberLoginSuccess(orgId, authenticatedUser.uid);
    return recorded ? NextResponse.json({ ok: true }) : errorResponse('Workspace membership was not found or is inactive.', 403);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.startsWith('Invalid ')) return errorResponse('Invalid login activity request.', 400);
    console.warn('[login-activity] recording failed:', error);
    return errorResponse('Login activity could not be recorded.', 503);
  }
}
