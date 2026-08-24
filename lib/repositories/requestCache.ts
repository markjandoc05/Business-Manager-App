type CacheEntry<T> = { value: T; expiresAt: number };

const values = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

export function cachedRequest<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = values.get(key);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value as T);

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const request = loader()
    .then((value) => {
      values.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export function invalidateCachedRequest(keyPrefix: string) {
  for (const key of values.keys()) {
    if (key.startsWith(keyPrefix)) values.delete(key);
  }
}
