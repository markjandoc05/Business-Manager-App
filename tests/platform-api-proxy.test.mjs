import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isValidIdempotencyKey,
  parseTrialProxyRequest,
  proxyPlatformRequest,
} from '../lib/server/platform-api.ts';

test('Platform proxy uses the server-only base URL and forwards only its approved request', async () => {
  const previousFetch = globalThis.fetch;
  const previousBaseUrl = process.env.VENTALE_PLATFORM_API_BASE_URL;
  process.env.VENTALE_PLATFORM_API_BASE_URL = 'http://127.0.0.1:3001';
  let call;
  globalThis.fetch = async (input, init) => {
    call = { input: String(input), init };
    return new Response(JSON.stringify({ success: true, data: { plans: [] } }), { status: 200 });
  };
  try {
    const result = await proxyPlatformRequest('/api/v1/plans', { method: 'GET' });
    assert.equal(result.status, 200);
    assert.equal(call.input, 'http://127.0.0.1:3001/api/v1/plans');
    assert.equal(new Headers(call.init.headers).has('Authorization'), false);

    await proxyPlatformRequest('/api/v1/trials', {
      method: 'POST',
      authorization: 'Bearer firebase-id-token',
      idempotencyKey: 'v1234567-1234-4123-8123-123456789abc',
      body: { productCode: 'standard', workspace: { businessName: 'Acme' } },
    });
    assert.equal(call.input, 'http://127.0.0.1:3001/api/v1/trials');
    assert.equal(new Headers(call.init.headers).get('Authorization'), 'Bearer firebase-id-token');
    assert.equal(new Headers(call.init.headers).get('Idempotency-Key'), 'v1234567-1234-4123-8123-123456789abc');
    assert.deepEqual(JSON.parse(call.init.body), { productCode: 'standard', workspace: { businessName: 'Acme' } });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBaseUrl === undefined) delete process.env.VENTALE_PLATFORM_API_BASE_URL;
    else process.env.VENTALE_PLATFORM_API_BASE_URL = previousBaseUrl;
  }
});

test('Platform proxy fails closed for missing configuration or malformed upstream bodies', async () => {
  const previousFetch = globalThis.fetch;
  const previousBaseUrl = process.env.VENTALE_PLATFORM_API_BASE_URL;
  delete process.env.VENTALE_PLATFORM_API_BASE_URL;
  try {
    const unavailable = await proxyPlatformRequest('/api/v1/plans', { method: 'GET' });
    assert.deepEqual(unavailable.body, { success: false, error: { code: 'PLATFORM_UNAVAILABLE', message: 'Platform onboarding is not configured.' } });

    process.env.VENTALE_PLATFORM_API_BASE_URL = 'http://127.0.0.1:3001';
    globalThis.fetch = async () => new Response('not json', { status: 200 });
    const malformed = await proxyPlatformRequest('/api/v1/plans', { method: 'GET' });
    assert.equal(malformed.status, 502);
    assert.equal(malformed.body.error.code, 'INVALID_RESPONSE');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBaseUrl === undefined) delete process.env.VENTALE_PLATFORM_API_BASE_URL;
    else process.env.VENTALE_PLATFORM_API_BASE_URL = previousBaseUrl;
  }
});

test('Platform proxy rejects cleartext non-loopback URLs in production', async () => {
  const previousBaseUrl = process.env.VENTALE_PLATFORM_API_BASE_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.VENTALE_PLATFORM_API_BASE_URL = 'http://platform.internal.example';
  process.env.NODE_ENV = 'production';
  try {
    const result = await proxyPlatformRequest('/api/v1/plans', { method: 'GET' });
    assert.equal(result.status, 503);
    assert.equal(result.body.error.code, 'PLATFORM_UNAVAILABLE');
  } finally {
    if (previousBaseUrl === undefined) delete process.env.VENTALE_PLATFORM_API_BASE_URL;
    else process.env.VENTALE_PLATFORM_API_BASE_URL = previousBaseUrl;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('trial proxy input strips authority fields and requires the Platform idempotency key format', () => {
  assert.equal(isValidIdempotencyKey('v1234567-1234-4123-8123-123456789abc'), true);
  assert.equal(isValidIdempotencyKey('short'), false);
  assert.deepEqual(parseTrialProxyRequest({
    productCode: 'standard',
    price: 149,
    maxUsers: 999,
    workspace: {
      businessName: 'Acme', requestedSlug: 'acme', businessType: 'Agency', phone: '+63', website: 'https://acme.example', currency: 'USD', timezone: 'Asia/Manila', trialDays: 99,
    },
  }), {
    productCode: 'standard',
    workspace: {
      businessName: 'Acme', requestedSlug: 'acme', businessType: 'Agency', phone: '+63', website: 'https://acme.example', currency: 'USD', timezone: 'Asia/Manila',
    },
  });
  assert.deepEqual(parseTrialProxyRequest({
    productCode: 'founding_100',
    workspace: { businessName: 'Acme', businessType: 'Agency', phone: '  ', website: '', currency: 'USD', timezone: 'Asia/Manila' },
  }), {
    productCode: 'founding_100',
    workspace: { businessName: 'Acme', businessType: 'Agency', currency: 'USD', timezone: 'Asia/Manila' },
  });
});
