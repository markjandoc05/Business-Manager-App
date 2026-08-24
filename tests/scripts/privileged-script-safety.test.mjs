import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMutationSafety, requireProductionProject } from '../../scripts/lib/safety.mjs';

const production = { GOOGLE_CLOUD_PROJECT: 'bsm-client-app-web' };
const emulator = {
  GOOGLE_CLOUD_PROJECT: 'demo-bsm-client-app',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
};

test('missing project identity is rejected', () => {
  assert.throws(() => requireProductionProject({ environment: {} }), /explicit target project is required/);
});

test('wrong project is rejected', () => {
  assert.throws(() => requireProductionProject({ environment: { GOOGLE_CLOUD_PROJECT: 'other-project' } }), /expected bsm-client-app-web/);
});

test('contradictory project identities are rejected', () => {
  assert.throws(() => requireProductionProject({
    args: ['--project', 'bsm-client-app-web'],
    environment: { GOOGLE_CLOUD_PROJECT: 'other-project' },
  }), /Contradictory Firebase project identities/);
});

test('emulator configuration is rejected by production mutation guards', () => {
  assert.throws(() => requireProductionProject({ environment: emulator }), /refuse Firebase emulator configuration/);
});

test('dry-run never enables writes', () => {
  const safety = assertMutationSafety({ apply: false, environment: production, scope: 'test' });
  assert.equal(safety.mode, 'dry-run');
  assert.equal(safety.writesAllowed, false);
});

test('apply enables writes only with explicit apply', () => {
  const safety = assertMutationSafety({ apply: true, environment: production, scope: 'test' });
  assert.equal(safety.mode, 'apply');
  assert.equal(safety.writesAllowed, true);
});

test('destructive apply requires explicit confirmation', () => {
  assert.throws(() => assertMutationSafety({ apply: true, destructive: true, environment: production, scope: 'reset' }), /confirm-production-reset/);
  const safety = assertMutationSafety({
    apply: true,
    destructive: true,
    args: ['--confirm-production-reset'],
    environment: production,
    scope: 'reset',
  });
  assert.equal(safety.writesAllowed, true);
});
