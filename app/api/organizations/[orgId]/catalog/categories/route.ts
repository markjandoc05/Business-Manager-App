import { NextRequest } from 'next/server';
import { handleCatalogCategoryRequest } from '@/lib/server/catalog-category-route';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ orgId: string }> }) {
  return handleCatalogCategoryRequest(request, (await context.params).orgId);
}
