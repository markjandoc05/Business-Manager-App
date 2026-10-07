import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/server/auth';
import { createSaleForOrganization, deleteDealForOrganization, FinanceError, financeId, recordPaymentForOrganization } from '@/lib/server/sales-service';

export async function handleFinanceRequest(request: NextRequest, orgId: string, action: 'create-sale' | 'payment' | 'delete-deal', recordId?: string) {
  const actor = await getAuthenticatedUser(request);
  if (!actor) return NextResponse.json({ error: 'Authentication is required.' }, { status: 401 });
  if (!financeId(orgId) || (action !== 'create-sale' && !financeId(recordId))) return NextResponse.json({ error: 'Invalid financial record reference.' }, { status: 400 });
  try {
    if (action === 'delete-deal') {
      await deleteDealForOrganization(orgId, actor.uid, recordId!);
      return NextResponse.json({ ok: true });
    }
    let body: unknown;
    try { body = await request.json(); } catch { throw new FinanceError('Invalid financial request.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new FinanceError('Invalid financial request.');
    const key = request.headers.get('Idempotency-Key') || '';
    const input = body as Record<string, unknown>;
    const result = action === 'create-sale'
      ? { saleId: await createSaleForOrganization(orgId, actor.uid, input, key) }
      : await recordPaymentForOrganization(orgId, actor.uid, recordId!, input, key);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof FinanceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Financial transaction failed', error && typeof error === 'object' && 'code' in error ? error.code : 'unknown');
    return NextResponse.json({ error: 'Unable to complete the financial transaction. Retry the same request.' }, { status: 500 });
  }
}
