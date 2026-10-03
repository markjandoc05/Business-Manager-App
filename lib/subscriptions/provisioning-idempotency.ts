export class ProvisioningIdempotencyStorageError extends Error {
  constructor() {
    super('Secure provisioning retry state is not available in this browser.');
    this.name = 'ProvisioningIdempotencyStorageError';
  }
}

type Attempt = { key: string; fingerprint: string };

function storageKey(uid: string) {
  return `ventale.platform-onboarding.v1:${encodeURIComponent(uid)}`;
}

function browserStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function secureKey() {
  if (!globalThis.crypto?.randomUUID) throw new ProvisioningIdempotencyStorageError();
  // The prefix makes the first character alphanumeric; UUID randomness is
  // cryptographic and its remaining characters satisfy the Platform contract.
  return `v${globalThis.crypto.randomUUID()}`;
}

function validAttempt(value: unknown): value is Attempt {
  return Boolean(value) && typeof value === 'object'
    && typeof (value as Attempt).fingerprint === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._~-]{15,127}$/.test((value as Attempt).key);
}

export function provisioningFingerprint(input: {
  planCode: string;
  workspace: { name: string; requestedSlug?: string; businessType: string; phone: string; website: string; currency: string; timezone: string };
}) {
  return JSON.stringify({
    planCode: input.planCode,
    workspace: {
      name: input.workspace.name,
      ...(input.workspace.requestedSlug ? { requestedSlug: input.workspace.requestedSlug } : {}),
      businessType: input.workspace.businessType,
      phone: input.workspace.phone,
      website: input.workspace.website,
      currency: input.workspace.currency,
      timezone: input.workspace.timezone,
    },
  });
}

export function getOrCreateProvisioningIdempotencyKey(uid: string, fingerprint: string) {
  const storage = browserStorage();
  if (!storage) throw new ProvisioningIdempotencyStorageError();
  let existing: unknown = null;
  try {
    const raw = storage.getItem(storageKey(uid));
    existing = raw ? JSON.parse(raw) : null;
  } catch {
    throw new ProvisioningIdempotencyStorageError();
  }
  if (validAttempt(existing) && existing.fingerprint === fingerprint) return existing.key;
  const attempt: Attempt = { key: secureKey(), fingerprint };
  try {
    storage.setItem(storageKey(uid), JSON.stringify(attempt));
  } catch {
    throw new ProvisioningIdempotencyStorageError();
  }
  return attempt.key;
}

export function clearProvisioningIdempotencyKey(uid: string, key?: string) {
  const storage = browserStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(storageKey(uid));
    const existing = raw ? JSON.parse(raw) : null;
    if (!key || (validAttempt(existing) && existing.key === key)) storage.removeItem(storageKey(uid));
  } catch {
    // A corrupt retry record must not affect a successfully provisioned workspace.
    storage.removeItem(storageKey(uid));
  }
}
