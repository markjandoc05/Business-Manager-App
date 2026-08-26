type CacheEntry<T> = { value: T; expiresAt: number };

const values = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, { promise: Promise<unknown>; generation: number }>();
let generation = 0;

export function cachedRequest<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = values.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value as T);

  const pending = inFlight.get(key);
  if (pending?.generation === generation) return pending.promise as Promise<T>;

  const requestGeneration = generation;
  const request = loader()
    .then((value) => {
      values.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      if (inFlight.get(key)?.promise === request) inFlight.delete(key);
    });
  inFlight.set(key, { promise: request, generation: requestGeneration });
  return request;
}

export function invalidateCachedRequest(keyPrefix: string) {
  for (const key of values.keys()) {
    if (key.startsWith(keyPrefix)) values.delete(key);
  }
}

export function clearCachedRequests() {
  values.clear();
  generation += 1;
}
