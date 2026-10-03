import 'server-only';

export const PLATFORM_ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'INVALID_PLAN',
  'PLAN_UNAVAILABLE',
  'FOUNDING_LIMIT_REACHED',
  'TRIAL_ALREADY_EXISTS',
  'WORKSPACE_ALREADY_EXISTS',
  'IDEMPOTENCY_CONFLICT',
  'INVALID_REQUEST',
  'LICENSE_NOT_FOUND',
  'PROVISIONING_FAILED',
  'INTERNAL_ERROR',
] as const;

export type PlatformErrorCode = typeof PLATFORM_ERROR_CODES[number] | 'PLATFORM_UNAVAILABLE' | 'INVALID_RESPONSE';

export type PlatformProxyResult = {
  status: number;
  body: Record<string, unknown>;
};

function errorBody(code: PlatformErrorCode, message: string) {
  return { success: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parsePlatformBaseUrl(value = process.env.VENTALE_PLATFORM_API_BASE_URL) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && loopback)) return null;
    return url;
  } catch {
    return null;
  }
}

function normalizedPlatformError(value: unknown, fallbackStatus: number) {
  if (isRecord(value) && value.success === false && isRecord(value.error) && typeof value.error.code === 'string') {
    const code = PLATFORM_ERROR_CODES.includes(value.error.code as typeof PLATFORM_ERROR_CODES[number])
      ? value.error.code as PlatformErrorCode
      : 'INTERNAL_ERROR';
    const message = typeof value.error.message === 'string' && value.error.message.trim()
      ? value.error.message.trim().slice(0, 300)
      : 'The Platform request could not be completed.';
    return { status: fallbackStatus, body: errorBody(code, message) };
  }
  return { status: fallbackStatus, body: errorBody('INTERNAL_ERROR', 'The Platform request could not be completed.') };
}

export async function proxyPlatformRequest(path: string, options: {
  method: 'GET' | 'POST';
  authorization?: string;
  idempotencyKey?: string;
  body?: Record<string, unknown>;
}): Promise<PlatformProxyResult> {
  const baseUrl = parsePlatformBaseUrl();
  if (!baseUrl) {
    return { status: 503, body: errorBody('PLATFORM_UNAVAILABLE', 'Platform onboarding is not configured.') };
  }

  const endpoint = new URL(path, baseUrl);
  const headers = new Headers({ Accept: 'application/json' });
  if (options.authorization) headers.set('Authorization', options.authorization);
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  if (options.body) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: options.method,
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { status: 503, body: errorBody('PLATFORM_UNAVAILABLE', 'Platform onboarding is temporarily unavailable. Please try again.') };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: 502, body: errorBody('INVALID_RESPONSE', 'The Platform returned an invalid response.') };
  }

  if (!response.ok || !isRecord(body) || body.success !== true) return normalizedPlatformError(body, response.status);
  return { status: response.status, body };
}

export function platformProxyResponse(result: PlatformProxyResult) {
  return Response.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && Boolean(value.trim()) && value.trim().length <= maxLength;
}

export function isValidIdempotencyKey(value: string | null): value is string {
  return Boolean(value && /^[A-Za-z0-9][A-Za-z0-9._~-]{15,127}$/.test(value));
}

export function parseTrialProxyRequest(value: unknown) {
  if (!isRecord(value) || !isRecord(value.workspace)) return null;
  const productCode = value.productCode;
  const workspace = value.workspace;
  const businessName = workspace.businessName;
  const businessType = workspace.businessType;
  const currency = workspace.currency;
  const timezone = workspace.timezone;
  const requestedSlug = workspace.requestedSlug;
  const phone = workspace.phone;
  const website = workspace.website;
  if (!isNonEmptyString(productCode, 128)
    || !isNonEmptyString(businessName, 200)
    || !isNonEmptyString(businessType, 100)
    || !isNonEmptyString(currency, 12)
    || !isNonEmptyString(timezone, 100)) return null;
  if (requestedSlug !== undefined && !isNonEmptyString(requestedSlug, 128)) return null;
  if (phone !== undefined && (typeof phone !== 'string' || phone.length > 64)) return null;
  if (website !== undefined && (typeof website !== 'string' || website.length > 2_048)) return null;
  const normalizedPhone = typeof phone === 'string' ? phone.trim() : undefined;
  const normalizedWebsite = typeof website === 'string' ? website.trim() : undefined;

  return {
    productCode: productCode.trim(),
    workspace: {
      businessName: businessName.trim(),
      businessType: businessType.trim(),
      currency: currency.trim(),
      timezone: timezone.trim(),
      ...(requestedSlug === undefined ? {} : { requestedSlug: requestedSlug.trim() }),
      ...(normalizedPhone ? { phone: normalizedPhone } : {}),
      ...(normalizedWebsite ? { website: normalizedWebsite } : {}),
    },
  };
}
