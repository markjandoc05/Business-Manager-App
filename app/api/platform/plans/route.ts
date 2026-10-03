import { platformProxyResponse, proxyPlatformRequest } from '@/lib/server/platform-api';

export const runtime = 'nodejs';

export async function GET() {
  return platformProxyResponse(await proxyPlatformRequest('/api/v1/plans', { method: 'GET' }));
}
