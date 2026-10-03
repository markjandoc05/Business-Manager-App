export type ClientLookupRead<T> =
  | { found: true; value: T | null }
  | { found: false };

export interface OrganizationClientLookupCache<T> {
  clear: () => void;
  prime: (organizationId: string, clientId: string, value: T | null) => void;
  read: (organizationId: string, clientId: string) => ClientLookupRead<T>;
  resolve: (organizationId: string, clientId: string, loader: () => Promise<T | null>) => Promise<T | null>;
}

function lookupKey(organizationId: string, clientId: string) {
  return JSON.stringify([organizationId, clientId]);
}

/**
 * Creates a page-local Client display cache. Values are scoped by organization,
 * simultaneous reads are shared, and clear() prevents older requests from
 * repopulating the cache after a workspace switch.
 */
export function createOrganizationClientLookupCache<T>(): OrganizationClientLookupCache<T> {
  const values = new Map<string, T | null>();
  const inFlight = new Map<string, Promise<T | null>>();
  let generation = 0;

  return {
    clear() {
      generation += 1;
      values.clear();
      inFlight.clear();
    },
    prime(organizationId, clientId, value) {
      values.set(lookupKey(organizationId, clientId), value);
    },
    read(organizationId, clientId) {
      const key = lookupKey(organizationId, clientId);
      return values.has(key) ? { found: true, value: values.get(key) ?? null } : { found: false };
    },
    resolve(organizationId, clientId, loader) {
      const key = lookupKey(organizationId, clientId);
      if (values.has(key)) return Promise.resolve(values.get(key) ?? null);
      const pending = inFlight.get(key);
      if (pending) return pending;

      const requestGeneration = generation;
      const request = Promise.resolve()
        .then(loader)
        .then((value) => {
          if (requestGeneration === generation) values.set(key, value);
          return value;
        })
        .finally(() => {
          if (inFlight.get(key) === request) inFlight.delete(key);
        });
      inFlight.set(key, request);
      return request;
    },
  };
}

export function uniqueRelatedClientIds(records: Array<{ clientId: string }>) {
  return [...new Set(records.map((record) => record.clientId).filter(Boolean))];
}

export function matchesDealLookupSearch(
  values: { dealTitle: string; clientName?: string; productServiceName?: string },
  search: string,
) {
  const term = search.trim().toLowerCase();
  if (!term) return true;
  return [values.dealTitle, values.clientName || '', values.productServiceName || '']
    .some((value) => value.toLowerCase().includes(term));
}
