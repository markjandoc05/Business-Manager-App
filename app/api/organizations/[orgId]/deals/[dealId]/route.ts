import { NextRequest } from 'next/server';
import { handleFinanceRequest } from '@/lib/server/finance-route';

export const runtime = 'nodejs';
export async function DELETE(request: NextRequest, context: { params: Promise<{ orgId: string; dealId: string }> }) {
  const { orgId, dealId } = await context.params;
  return handleFinanceRequest(request, orgId, 'delete-deal', dealId);
}
