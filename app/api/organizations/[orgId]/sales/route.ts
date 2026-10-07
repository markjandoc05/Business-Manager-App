import { NextRequest } from 'next/server';
import { handleFinanceRequest } from '@/lib/server/finance-route';

export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ orgId: string }> }) {
  return handleFinanceRequest(request, (await context.params).orgId, 'create-sale');
}
