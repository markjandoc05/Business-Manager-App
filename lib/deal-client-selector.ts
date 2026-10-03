export const DEAL_CLIENT_SEARCH_LIMIT = 8;
export const DEAL_CLIENT_SEARCH_DEBOUNCE_MS = 220;
export const DEAL_CLIENT_SEARCH_MIN_LENGTH = 2;

export function isSelectableDealClient(client: { status?: string; archived?: boolean; trashed?: boolean }) {
  return client.status !== 'ARCHIVED' && client.archived !== true && client.trashed !== true;
}

export function getInitialDealClientOptions<T extends { status?: string; archived?: boolean; trashed?: boolean }>(
  clients: T[],
  limit = DEAL_CLIENT_SEARCH_LIMIT,
) {
  return clients.filter(isSelectableDealClient).slice(0, limit);
}

export interface DealClientSearchCache<T> {
  clear: () => void;
  resolve: (organizationId: string, query: string, loader: () => Promise<T[]>) => Promise<T[]>;
}

/** Page-local cache for bounded Client picker searches. */
export function createDealClientSearchCache<T>(): DealClientSearchCache<T> {
  const results = new Map<string, T[]>();
  const inFlight = new Map<string, Promise<T[]>>();
  let generation = 0;

  return {
    clear() {
      generation += 1;
      results.clear();
      inFlight.clear();
    },
    resolve(organizationId, query, loader) {
      const key = JSON.stringify([organizationId, query.trim()]);
      const cached = results.get(key);
      if (cached) return Promise.resolve(cached);
      const pending = inFlight.get(key);
      if (pending) return pending;

      const requestGeneration = generation;
      const request = Promise.resolve()
        .then(loader)
        .then((clients) => {
          if (requestGeneration === generation) results.set(key, clients);
          return clients;
        })
        .finally(() => {
          if (inFlight.get(key) === request) inFlight.delete(key);
        });
      inFlight.set(key, request);
      return request;
    },
  };
}
