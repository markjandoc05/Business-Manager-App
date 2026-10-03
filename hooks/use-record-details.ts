'use client';

import { useCallback, useEffect, useState } from 'react';
import { userFacingErrorMessage } from '@/lib/repositories/pagination';
import type { AppUser } from '@/types/auth';

/** Resolves a deep link even when its record is outside the current list page. */
export function useRecordDetails<T extends { id: string }>({
  recordId, records, user, organizationId, ready, loadRecord,
}: {
  recordId: string | null;
  records: T[];
  user: AppUser | null;
  organizationId: string | null;
  ready: boolean;
  loadRecord: (user: AppUser, organizationId: string, recordId: string) => Promise<T>;
}) {
  const scope = JSON.stringify([user?.uid, organizationId, recordId]);
  const loadedRecord = ready && user && organizationId && recordId
    ? records.find((record) => record.id === recordId) : undefined;
  const [result, setResult] = useState<{ scope: string; record?: T; error?: string } | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const reload = useCallback(() => setReloadVersion((version) => version + 1), []);

  useEffect(() => {
    if (!recordId || !user || !organizationId || !ready || loadedRecord) return;
    let cancelled = false;
    // Ignore responses from a previous record, user, or workspace.
    queueMicrotask(() => { if (!cancelled) setResult({ scope }); });
    void loadRecord(user, organizationId, recordId).then(
      (record) => { if (!cancelled) setResult({ scope, record }); },
      (error: unknown) => {
        if (!cancelled) setResult({ scope, error: userFacingErrorMessage(error, 'Unable to load this record. Please try again.') });
      },
    );
    return () => { cancelled = true; };
  }, [recordId, user, organizationId, ready, loadedRecord, loadRecord, scope, reloadVersion]);

  const currentResult = ready && user && organizationId && result?.scope === scope ? result : null;
  const record = loadedRecord || currentResult?.record;
  const error = record ? null : currentResult?.error || null;
  return { record, error, loading: Boolean(recordId && !record && !error), reload };
}
