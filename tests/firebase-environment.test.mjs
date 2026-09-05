import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLocalFirebaseEmulatorMode } from '../lib/firebase/environment.ts';

test('Firebase emulator mode requires the explicit flag in development', () => {
  const demo = { NODE_ENV: 'development', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-bsm-client-app' };
  assert.equal(isLocalFirebaseEmulatorMode({ ...demo, NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true' }), true);
  assert.equal(isLocalFirebaseEmulatorMode({ ...demo, NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'false' }), false);
  assert.equal(isLocalFirebaseEmulatorMode({ ...demo }), false);
  assert.equal(isLocalFirebaseEmulatorMode({ ...demo, NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'bsm-client-app-web' }), false);
});

test('production builds never activate Firebase emulator mode', () => {
  assert.equal(isLocalFirebaseEmulatorMode({ NODE_ENV: 'production', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'bsm-client-app-web', NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true', NEXT_PUBLIC_LOCAL_UAT: 'true' }), false);
  assert.equal(isLocalFirebaseEmulatorMode({ NODE_ENV: 'production', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-bsm-client-app', NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true' }), false);
  assert.equal(isLocalFirebaseEmulatorMode({ NODE_ENV: 'production', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-bsm-client-app', NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true', NEXT_PUBLIC_LOCAL_UAT: 'true' }), true);
});
