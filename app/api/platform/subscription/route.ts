import { NextRequest } from 'next/server';
import { adminDb } from '@/lib/server/firebase-admin';
import { getAuthenticatedUser, isApplicationUserActive } from '@/lib/server/auth';
import { platformProxyResponse, proxyPlatformRequest } from '@/lib/server/platform-api';

export const runtime = 'nodejs';

function errorResponse(code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID_REQUEST', status: number, message: string) {
  return Response.json({ success: false, error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

function validOrganizationId(value: string | null): value is string {
  return Boolean(value && value.length <= 128 && !value.includes('/'));
}

export async function GET(request: NextRequest) {
  const authenticatedUser = await getAuthenticatedUser(request);
  if (!authenticatedUser) return errorResponse('UNAUTHENTICATED', 401, 'Authentication is required.');
  const organizationId = request.nextUrl.searchParams.get('workspaceId');
  if (!validOrganizationId(organizationId)) return errorResponse('INVALID_REQUEST', 400, 'A valid workspace is required.');
  if (!await isApplicationUserActive(authenticatedUser.uid)) return errorResponse('FORBIDDEN', 403, 'Workspace access is not available.');

  const membership = await adminDb.doc(`organizations/${organizationId}/members/${authenticatedUser.uid}`).get();
  const member = membership.data() || {};
  if (!membership.exists || member.userId !== authenticatedUser.uid || member.status !== 'active' || !['ADMIN', 'MANAGER', 'USER'].includes(String(member.role))) {
    return errorResponse('FORBIDDEN', 403, 'Workspace access is not available.');
  }

  const authorization = request.headers.get('authorization')?.trim() || '';
  return platformProxyResponse(await proxyPlatformRequest(`/api/v1/subscription?workspaceId=${encodeURIComponent(organizationId)}`, {
    method: 'GET',
    authorization,
  }));
}
