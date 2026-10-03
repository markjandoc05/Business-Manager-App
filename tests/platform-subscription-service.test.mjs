import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPlatformApiSubscriptionService,
  PlatformSubscriptionError,
} from '../lib/subscriptions/platform-subscription-service.ts';
import {
  clearProvisioningIdempotencyKey,
  getOrCreateProvisioningIdempotencyKey,
  provisioningFingerprint,
} from '../lib/subscriptions/provisioning-idempotency.ts';

const trialLicense = {
  plan: 'TRIAL',
  status: 'TRIAL',
  trialStartedAt: '2026-09-13T00:00:00.000Z',
  trialEndsAt: '2026-09-27T00:00:00.000Z',
  subscriptionStartedAt: null,
  renewalDate: null,
  expirationDate: '2026-09-27T00:00:00.000Z',
  maxUsers: 3,
  billingInterval: 'year',
};

const foundingMarketing = {
  badge: 'Limited to the first 100 customers',
  messages: [
    'Keep your Founding rate for as long as your subscription remains active.',
    'Standard price after the first 100: $149/year',
  ],
};

function success(data, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), { status, headers: { 'Content-Type': 'application/json' } });
}

function serviceFor(responder) {
  const calls = [];
  const service = createPlatformApiSubscriptionService({
    tokenProvider: async () => 'firebase-id-token',
    fetchFn: async (input, init = {}) => {
      calls.push({ input: String(input), init });
      return responder(calls.length, input, init);
    },
  });
  return { service, calls };
}

test('public plans are loaded only from the Platform proxy and render backend availability', async () => {
  const { service, calls } = serviceFor(() => success({ plans: [
    { code: 'founding_100', name: 'Founding 100', price: 99, currency: 'USD', billingInterval: 'year', trialDays: 14, requiresCard: false, available: true, marketing: foundingMarketing },
    { code: 'standard', name: 'Standard', price: 149, currency: 'USD', billingInterval: 'year', trialDays: 14, requiresCard: false, available: false },
  ] }));

  const plans = await service.getAvailableSignupPlans();
  assert.deepEqual(plans, [{ code: 'founding_100', name: 'Founding 100', price: 99, currency: 'USD', billingInterval: 'year', trialDays: 14, noCreditCardRequired: true, marketing: foundingMarketing }]);
  assert.equal(calls[0].input, '/api/platform/plans');
  assert.equal(new Headers(calls[0].init.headers).has('Authorization'), false);
});

test('malformed display-only marketing is omitted without changing plan availability', async () => {
  const { service } = serviceFor(() => success({ plans: [
    {
      code: 'standard', name: 'Standard', price: 149, currency: 'USD', billingInterval: 'year', trialDays: 14, requiresCard: false, available: true,
      marketing: { badge: 'A valid badge', messages: ['A valid message', 42] },
    },
  ] }));

  const [plan] = await service.getAvailableSignupPlans();
  assert.equal(plan.code, 'standard');
  assert.equal(plan.marketing, undefined);
});

test('a Platform plan switch changes Client-visible plans without Client commercial logic', async () => {
  const { service } = serviceFor((call) => success({ plans: call === 1
    ? [{ code: 'founding_100', name: 'Founding 100', price: 99, currency: 'USD', billingInterval: 'year', trialDays: 14, requiresCard: false, available: true }]
    : [{ code: 'standard', name: 'Standard', price: 149, currency: 'USD', billingInterval: 'year', trialDays: 14, requiresCard: false, available: true }],
  }));
  assert.equal((await service.getAvailableSignupPlans())[0].code, 'founding_100');
  assert.equal((await service.getAvailableSignupPlans())[0].code, 'standard');
});

test('trial provisioning forwards a short-lived Firebase token, idempotency key, and only approved fields', async () => {
  const { service, calls } = serviceFor(() => success({
    workspaceId: 'workspace-1', organizationId: 'organization-1', productCode: 'founding_100', legacy: false, idempotent: false, provisioningStatus: 'PROVISIONED', license: trialLicense,
  }));
  const result = await service.startTrial({
    planCode: 'founding_100',
    idempotencyKey: 'v1234567-1234-4123-8123-123456789abc',
    workspace: { name: 'Acme Studio', requestedSlug: 'acme-studio', businessType: 'Agency', phone: '+63 900 000 0000', website: 'https://acme.example', currency: 'USD', timezone: 'Asia/Manila' },
  });

  assert.equal(result.organizationId, 'organization-1');
  assert.equal(result.license.plan, 'TRIAL');
  assert.equal(result.license.status, 'TRIAL');
  const request = calls[0];
  assert.equal(request.input, '/api/platform/trials');
  const headers = new Headers(request.init.headers);
  assert.equal(headers.get('Authorization'), 'Bearer firebase-id-token');
  assert.equal(headers.get('Idempotency-Key'), 'v1234567-1234-4123-8123-123456789abc');
  assert.deepEqual(JSON.parse(request.init.body), {
    productCode: 'founding_100',
    workspace: { businessName: 'Acme Studio', requestedSlug: 'acme-studio', businessType: 'Agency', phone: '+63 900 000 0000', website: 'https://acme.example', currency: 'USD', timezone: 'Asia/Manila' },
  });
  assert.equal(JSON.stringify(request.init.body).includes('maxUsers'), false);
  assert.equal(JSON.stringify(request.init.body).includes('trialDays'), false);
  assert.equal(JSON.stringify(request.init.body).includes('price'), false);
});

test('trial provisioning omits blank optional contact fields', async () => {
  const { service, calls } = serviceFor(() => success({
    workspaceId: 'workspace-1', organizationId: 'organization-1', productCode: 'founding_100', legacy: false, idempotent: false, provisioningStatus: 'PROVISIONED', license: trialLicense,
  }));
  await service.startTrial({
    planCode: 'founding_100', idempotencyKey: 'v1234567-1234-4123-8123-123456789abc',
    workspace: { name: 'Acme Studio', businessType: 'Agency', phone: '  ', website: '', currency: 'USD', timezone: 'Asia/Manila' },
  });
  assert.deepEqual(JSON.parse(calls[0].init.body).workspace, {
    businessName: 'Acme Studio', businessType: 'Agency', currency: 'USD', timezone: 'Asia/Manila',
  });
});

test('the same attempt key is reused across retries and idempotent Platform success remains successful', async () => {
  const key = 'v1234567-1234-4123-8123-123456789abc';
  const { service, calls } = serviceFor(() => success({
    workspaceId: 'workspace-1', organizationId: 'organization-1', productCode: 'standard', legacy: false, idempotent: true, provisioningStatus: 'PROVISIONED', license: trialLicense,
  }));
  const request = { planCode: 'standard', idempotencyKey: key, workspace: { name: 'Acme', businessType: 'Agency', phone: '', website: '', currency: 'USD', timezone: 'UTC' } };
  assert.equal((await service.startTrial(request)).idempotent, true);
  assert.equal((await service.startTrial(request)).idempotent, true);
  assert.equal(new Headers(calls[0].init.headers).get('Idempotency-Key'), key);
  assert.equal(new Headers(calls[1].init.headers).get('Idempotency-Key'), key);
});

test('malformed successes and Platform errors fail closed', async () => {
  const malformed = serviceFor(() => success({ workspaceId: 'workspace-1' })).service;
  await assert.rejects(malformed.startTrial({ planCode: 'standard', idempotencyKey: 'v1234567-1234-4123-8123-123456789abc', workspace: { name: 'Acme', businessType: 'Agency', phone: '', website: '', currency: 'USD', timezone: 'UTC' } }), (error) => error instanceof PlatformSubscriptionError && error.code === 'INVALID_RESPONSE');

  const unavailable = serviceFor(() => new Response(JSON.stringify({ success: false, error: { code: 'PLAN_UNAVAILABLE', message: 'not public' } }), { status: 409 })).service;
  await assert.rejects(unavailable.startTrial({ planCode: 'founding_100', idempotencyKey: 'v1234567-1234-4123-8123-123456789abc', workspace: { name: 'Acme', businessType: 'Agency', phone: '', website: '', currency: 'USD', timezone: 'UTC' } }), (error) => error instanceof PlatformSubscriptionError && error.code === 'PLAN_UNAVAILABLE');
});

test('trusted subscription refresh only confirms a successful Platform refresh and never creates Client entitlement authority', async () => {
  const { service, calls } = serviceFor(() => success({}));
  await service.refreshSubscription('organization-1');
  assert.equal(calls[0].input, '/api/platform/subscription?workspaceId=organization-1');
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer firebase-id-token');
});

test('idempotency state survives retry and is replaced only for a changed reviewed attempt', () => {
  const values = new Map();
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  } } });
  try {
    const first = provisioningFingerprint({ planCode: 'founding_100', workspace: { name: 'Acme', businessType: 'Agency', phone: '', website: '', currency: 'USD', timezone: 'UTC' } });
    const sameKey = getOrCreateProvisioningIdempotencyKey('user-1', first);
    assert.match(sameKey, /^[A-Za-z0-9][A-Za-z0-9._~-]{15,127}$/);
    assert.equal(getOrCreateProvisioningIdempotencyKey('user-1', first), sameKey);
    const changed = provisioningFingerprint({ planCode: 'standard', workspace: { name: 'Acme', businessType: 'Agency', phone: '', website: '', currency: 'USD', timezone: 'UTC' } });
    const nextKey = getOrCreateProvisioningIdempotencyKey('user-1', changed);
    assert.notEqual(nextKey, sameKey);
    clearProvisioningIdempotencyKey('user-1', nextKey);
    assert.notEqual(getOrCreateProvisioningIdempotencyKey('user-1', changed), nextKey);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});
