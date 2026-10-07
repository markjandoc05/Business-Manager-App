import { authenticatedFetch } from '@/lib/repositories/authenticatedRequest';

const pendingRequests = new Map<string, string>();

/** Retain only an operation key/digest across uncertain responses, never financial/contact payloads. */
export async function financialRequest<T>(uid: string, path: string, input: unknown): Promise<T> {
  const body = JSON.stringify(input);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${uid}:${path}:${body}`));
  const requestId = `ventale-finance:${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  let key = pendingRequests.get(requestId);
  try { key ||= sessionStorage.getItem(requestId) || undefined; } catch { /* session storage may be unavailable */ }
  key ||= crypto.randomUUID();
  pendingRequests.set(requestId, key);
  try { sessionStorage.setItem(requestId, key); } catch { /* in-memory retry remains available */ }
  const response = await authenticatedFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body });
  // Keep the key until success is confirmed. A retry can lose authorization or
  // license access after the original request committed; a later retry must
  // still identify that original operation.
  const result = await response.json() as T & { error?: string };
  if (response.ok) {
    pendingRequests.delete(requestId);
    try { sessionStorage.removeItem(requestId); } catch { /* no stored payload */ }
  }
  if (!response.ok) throw new Error(result.error || 'Unable to complete the financial transaction.');
  return result;
}
