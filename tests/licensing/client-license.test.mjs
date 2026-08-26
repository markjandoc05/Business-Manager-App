import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Timestamp } from 'firebase/firestore';
import { parseLicense, resolveLicenseState } from '../../lib/licensing/license-evaluator.ts';

const now = Date.now();
const future = Timestamp.fromMillis(now + 86_400_000);
const past = Timestamp.fromMillis(now - 86_400_000);

function license(overrides = {}) {
  return {
    plan: 'TEAM',
    status: 'ACTIVE',
    subscriptionStartedAt: Timestamp.fromMillis(now - 86_400_000),
    subscriptionEndsAt: future,
    maxUsers: 3,
    features: { crm: true },
    ...overrides,
  };
}

test('valid ACTIVE and TRIAL licenses are writable and readable', () => {
  const active = resolveLicenseState(license(), now);
  const trial = resolveLicenseState({
    plan: 'TRIAL',
    status: 'TRIAL',
    trialStartedAt: Timestamp.fromMillis(now - 86_400_000),
    trialEndsAt: future,
    maxUsers: 3,
    features: { crm: true },
  }, now);
  assert.equal(active.status, 'ACTIVE');
  assert.equal(active.canRead, true);
  assert.equal(active.canWrite, true);
  assert.equal(trial.status, 'TRIAL');
  assert.equal(trial.canRead, true);
  assert.equal(trial.canWrite, true);
});

test('EXPIRED and SUSPENDED licenses remain readable but read-only', () => {
  for (const status of ['EXPIRED', 'SUSPENDED']) {
    const state = resolveLicenseState(license({ status, subscriptionEndsAt: past }), now);
    assert.equal(state.status, status);
    assert.equal(state.canRead, true);
    assert.equal(state.canWrite, false);
    assert.equal(state.isReadOnly, true);
  }
});

test('missing, malformed, and unknown canonical licenses resolve to UNKNOWN', () => {
  const malformedPlan = parseLicense(license({ plan: 'UNKNOWN' }));
  const malformedStatus = parseLicense(license({ status: 'PAST_DUE' }));
  const malformedDates = parseLicense(license({ subscriptionEndsAt: 'not-a-timestamp' }));
  const malformedFeatures = parseLicense(license({ features: { crm: 'yes' } }));

  for (const parsed of [null, malformedPlan, malformedStatus, malformedDates, malformedFeatures]) {
    const state = resolveLicenseState(parsed, now);
    assert.equal(state.status, 'UNKNOWN');
    assert.equal(state.canRead, true);
    assert.equal(state.canWrite, false);
    assert.equal(state.isReadOnly, true);
  }
});

test('canonical plan and status combinations remain strict', () => {
  assert.equal(parseLicense(license({ plan: 'TRIAL', status: 'ACTIVE' })), null);
  assert.equal(parseLicense(license({ plan: 'TEAM', status: 'TRIAL', trialStartedAt: Timestamp.now(), trialEndsAt: future })), null);
});
