import { NextRequest } from 'next/server';
import { handleCatalogCategoryRequest } from '@/lib/server/catalog-category-route';
export const runtime = 'nodejs';
export async function PATCH(request: NextRequest, context: { params: Promise<{ orgId: string; categoryId: string }> }) {
  const { orgId, categoryId } = await context.params;
  return handleCatalogCategoryRequest(request, orgId, categoryId);
}
