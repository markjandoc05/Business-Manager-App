import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/server/auth';
import { saveCatalogCategory } from './catalog-category-service';
import { WorkspaceRecordError } from './workspace-record-access';

export async function handleCatalogCategoryRequest(request: NextRequest, orgId: string, categoryId?: string) {
  const actor = await getAuthenticatedUser(request);
  if (!actor) return NextResponse.json({ error: 'Authentication is required.' }, { status: 401 });
  try {
    let input;
    try { input = await request.json(); } catch { throw new WorkspaceRecordError('Invalid category details.'); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WorkspaceRecordError('Invalid category details.');
    const id = await saveCatalogCategory(orgId, actor.uid, input, request.headers.get('Idempotency-Key') || '', categoryId);
    return NextResponse.json({ ok: true, categoryId: id });
  } catch (error) {
    if (error instanceof WorkspaceRecordError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Category transaction could not be confirmed');
    return NextResponse.json({ error: 'The category change could not be confirmed. Retry the same request.' }, { status: 503 });
  }
}
