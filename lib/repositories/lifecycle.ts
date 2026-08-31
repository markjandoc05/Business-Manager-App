import type { AppUser } from '@/types/auth';
import { requireOrganizationAccess } from '@/lib/permissions';
import { authenticatedFetch } from '@/lib/repositories/authenticatedRequest';
import {
  type LifecycleAction,
  type LifecycleDecision,
  type LifecycleEntity,
} from '@/lib/record-lifecycle';

export type BulkLifecycleAction = LifecycleAction | 'restore';
export type BulkLifecycleResult = {
  id: string;
  ok: boolean;
  decision?: LifecycleDecision;
  error?: string;
};

export async function getLifecycleDecision(
  user: AppUser | null,
  organizationId: string,
  entity: LifecycleEntity,
  action: LifecycleAction,
  recordId: string,
): Promise<LifecycleDecision> {
  await requireOrganizationAccess(user, organizationId);
  const response = await authenticatedFetch(`/api/organizations/${encodeURIComponent(organizationId)}/records/${entity.toLowerCase()}/${encodeURIComponent(recordId)}?action=${encodeURIComponent(action)}`);
  const payload = await response.json().catch(() => null) as { decision?: LifecycleDecision; error?: string; reason?: string; recommendedAction?: string } | null;
  if (!response.ok || !payload?.decision) throw new Error([payload?.error, payload?.reason, payload?.recommendedAction].filter(Boolean).join(' ') || 'Unable to evaluate this lifecycle action.');
  return payload.decision;
}

export async function permanentlyDeleteRecord(user: AppUser | null, organizationId: string, entity: LifecycleEntity, recordId: string) {
  await requireOrganizationAccess(user, organizationId, ['ADMIN', 'MANAGER']);
  const response = await authenticatedFetch(`/api/organizations/${encodeURIComponent(organizationId)}/records/${entity.toLowerCase()}/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  });
  const payload = await response.json().catch(() => null) as { error?: string; reason?: string; recommendedAction?: string } | null;
  if (!response.ok) throw new Error([payload?.error, payload?.reason, payload?.recommendedAction].filter(Boolean).join(' ') || 'Unable to permanently delete this record.');
}

async function requestBulkLifecycle(user: AppUser | null, organizationId: string, entity: LifecycleEntity, action: BulkLifecycleAction, recordIds: string[], mode: 'preview' | 'execute') {
  await requireOrganizationAccess(user, organizationId, mode === 'execute' ? ['ADMIN', 'MANAGER'] : undefined);
  const response = await authenticatedFetch(`/api/organizations/${encodeURIComponent(organizationId)}/records/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entity, action, recordIds, mode }),
  });
  const payload = await response.json().catch(() => null) as { results?: BulkLifecycleResult[]; error?: string } | null;
  if (!response.ok || !payload) throw new Error(payload?.error || 'Unable to process the bulk lifecycle action.');
  return payload.results || [];
}

export function previewBulkLifecycle(user: AppUser | null, organizationId: string, entity: LifecycleEntity, action: BulkLifecycleAction, recordIds: string[]) {
  return requestBulkLifecycle(user, organizationId, entity, action, recordIds, 'preview');
}

export function executeBulkLifecycle(user: AppUser | null, organizationId: string, entity: LifecycleEntity, action: BulkLifecycleAction, recordIds: string[]) {
  return requestBulkLifecycle(user, organizationId, entity, action, recordIds, 'execute');
}
