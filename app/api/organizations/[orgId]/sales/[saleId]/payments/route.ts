import { NextRequest } from 'next/server';
import { handleFinanceRequest } from '@/lib/server/finance-route';

export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ orgId: string; saleId: string }> }) {
  const { orgId, saleId } = await context.params;
  return handleFinanceRequest(request, orgId, 'payment', saleId);
}
