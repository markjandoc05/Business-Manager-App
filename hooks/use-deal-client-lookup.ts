'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createOrganizationClientLookupCache, uniqueRelatedClientIds } from '@/lib/client-lookup';
import { getClientDisplayById, type ClientDisplay } from '@/lib/repositories/clients';
import type { Client, Deal } from '@/types';
import type { AppUser } from '@/types/auth';

const LOOKUP_CONCURRENCY = 6;

type LookupState = {
  scopeKey: string;
  clientsById: Map<string, ClientDisplay>;
  unavailableClientIds: Set<string>;
  pendingClientIds: Set<string>;
  failed: boolean;
};

function toClientDisplay(client: Client): ClientDisplay {
  return {
    id: client.id,
    name: client.name,
    company: client.company,
    status: client.status,
    archived: client.archived,
  };
}

export function useDealClientLookup({
  user,
  organizationId,
  deals,
  loadedClients,
}: {
  user: AppUser | null;
  organizationId: string | null;
  deals: Deal[];
  loadedClients: Client[];
}) {
  const cacheRef = useRef(createOrganizationClientLookupCache<ClientDisplay>());
  const cacheScopeRef = useRef('');
  const requestRef = useRef(0);
  const [retryVersion, setRetryVersion] = useState(0);
  const [state, setState] = useState<LookupState>({
    scopeKey: '',
    clientsById: new Map(),
    unavailableClientIds: new Set(),
    pendingClientIds: new Set(),
    failed: false,
  });
  const scopeKey = user && organizationId ? JSON.stringify([user.uid, organizationId]) : '';
  const clientIds = useMemo(() => uniqueRelatedClientIds(deals), [deals]);
  const clientIdsKey = JSON.stringify(clientIds);

  useEffect(() => {
    const requestId = ++requestRef.current;
    let cancelled = false;
    const cache = cacheRef.current;

    if (cacheScopeRef.current !== scopeKey) {
      cache.clear();
      cacheScopeRef.current = scopeKey;
    }

    if (!scopeKey || !user || !organizationId) {
      setState({ scopeKey, clientsById: new Map(), unavailableClientIds: new Set(), pendingClientIds: new Set(), failed: false });
      return () => { cancelled = true; };
    }

    for (const client of loadedClients) cache.prime(organizationId, client.id, toClientDisplay(client));

    const clientsById = new Map<string, ClientDisplay>();
    const unavailableClientIds = new Set<string>();
    const unresolvedClientIds: string[] = [];
    for (const clientId of clientIds) {
      const cached = cache.read(organizationId, clientId);
      if (!cached.found) unresolvedClientIds.push(clientId);
      else if (cached.value) clientsById.set(clientId, cached.value);
      else unavailableClientIds.add(clientId);
    }
    const pendingClientIds = new Set(unresolvedClientIds);
    setState({ scopeKey, clientsById, unavailableClientIds, pendingClientIds, failed: false });

    if (unresolvedClientIds.length === 0) return () => { cancelled = true; };

    void (async () => {
      let failed = false;
      for (let index = 0; index < unresolvedClientIds.length; index += LOOKUP_CONCURRENCY) {
        const batch = unresolvedClientIds.slice(index, index + LOOKUP_CONCURRENCY);
        const results = await Promise.allSettled(batch.map((clientId) => cache.resolve(
          organizationId,
          clientId,
          () => getClientDisplayById(user, organizationId, clientId),
        )));
        if (cancelled || requestId !== requestRef.current || cacheScopeRef.current !== scopeKey) return;

        results.forEach((result, resultIndex) => {
          const clientId = batch[resultIndex];
          pendingClientIds.delete(clientId);
          if (result.status === 'rejected') {
            failed = true;
          } else if (result.value) {
            clientsById.set(clientId, result.value);
          } else {
            unavailableClientIds.add(clientId);
          }
        });
        setState({
          scopeKey,
          clientsById: new Map(clientsById),
          unavailableClientIds: new Set(unavailableClientIds),
          pendingClientIds: new Set(pendingClientIds),
          failed,
        });
      }
    })();

    return () => { cancelled = true; };
  }, [clientIdsKey, loadedClients, organizationId, retryVersion, scopeKey, user]);

  const visibleState = state.scopeKey === scopeKey
    ? state
    : { scopeKey, clientsById: new Map<string, ClientDisplay>(), unavailableClientIds: new Set<string>(), pendingClientIds: new Set<string>(), failed: false };
  const retry = useCallback(() => setRetryVersion((current) => current + 1), []);

  return {
    ...visibleState,
    loading: visibleState.pendingClientIds.size > 0,
    retry,
  };
}
