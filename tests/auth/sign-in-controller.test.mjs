import assert from 'node:assert/strict';
import test from 'node:test';
import { createSignInController } from '../../lib/auth/signInController.ts';
import { getNoMembershipDestination } from '../../lib/auth/entryFlow.ts';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup({ popup, currentUser = false } = {}) {
  const states = [];
  const errors = [];
  const logs = [];
  const controller = createSignInController({
    signInWithPopup: popup || (() => Promise.resolve({ user: { uid: 'user-1' } })),
    hasCurrentUser: () => currentUser,
    setAuthenticating: (value) => states.push(value),
    clearError: () => errors.push(null),
    setError: (message) => errors.push(message),
    logError: (error) => logs.push(error),
  });
  return { controller, states, errors, logs };
}

test('simultaneous sign-in attempts invoke one popup request', async () => {
  const pending = deferred();
  let popupCalls = 0;
  const { controller, states } = setup({ popup: () => { popupCalls += 1; return pending.promise; } });

  const first = controller.signIn();
  const second = controller.signIn();
  assert.strictEqual(first, second);
  assert.equal(popupCalls, 1);
  assert.deepEqual(states, [true]);

  pending.resolve();
  await first;
  assert.deepEqual(states, [true, false]);
});

test('successful authentication resets in-flight state', async () => {
  const { controller, states, errors, logs } = setup();
  await controller.signIn();
  assert.deepEqual(states, [true, false]);
  assert.deepEqual(errors, [null]);
  assert.deepEqual(logs, []);
});

for (const code of ['auth/popup-closed-by-user', 'auth/cancelled-popup-request']) {
  test(`${code} is recoverable and can be retried`, async () => {
    let popupCalls = 0;
    const { controller, states, errors, logs } = setup({ popup: () => {
      popupCalls += 1;
      return Promise.reject({ code });
    } });

    await controller.signIn();
    await controller.signIn();
    assert.equal(popupCalls, 2);
    assert.deepEqual(states, [true, false, true, false]);
    assert.deepEqual(errors, [null, null]);
    assert.deepEqual(logs, []);
  });
}

test('unexpected authentication failures expose a friendly error', async () => {
  const rawError = { code: 'auth/network-request-failed', message: 'private Firebase detail' };
  const { controller, states, errors, logs } = setup({ popup: () => Promise.reject(rawError) });
  await controller.signIn();
  assert.deepEqual(states, [true, false]);
  assert.deepEqual(errors, [null, "We couldn't sign you in. Please try again."]);
  assert.deepEqual(logs, [rawError]);
  assert.doesNotMatch(errors.at(-1), /private Firebase detail/);
});

test('an already authenticated user does not open another popup', async () => {
  let popupCalls = 0;
  const { controller, states } = setup({ currentUser: true, popup: () => { popupCalls += 1; return Promise.resolve(); } });
  await controller.signIn();
  assert.equal(popupCalls, 0);
  assert.deepEqual(states, []);
});

test('entry intent preserves sign-in versus create-workspace routing', () => {
  assert.equal(getNoMembershipDestination('signin'), 'no-workspace');
  assert.equal(getNoMembershipDestination('create'), 'onboarding');
  assert.equal(getNoMembershipDestination(null), 'no-workspace');
});
