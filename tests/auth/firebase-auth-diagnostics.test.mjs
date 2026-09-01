import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFirebaseAuthError, describeFirebaseAuthError } from '../../lib/server/firebase-auth-diagnostics.ts';

test('classifies revoked Firebase ID tokens', () => {
  assert.equal(classifyFirebaseAuthError({ code: 'auth/id-token-revoked', message: 'The Firebase ID token has been revoked.' }), 'AUTH_TOKEN_REVOKED');
});

test('classifies expired Firebase ID tokens', () => {
  assert.equal(classifyFirebaseAuthError({ code: 'auth/id-token-expired', message: 'The Firebase ID token has expired.' }), 'AUTH_TOKEN_EXPIRED');
});

test('classifies disabled Firebase users', () => {
  assert.equal(classifyFirebaseAuthError({ code: 'auth/user-disabled', message: 'The user account has been disabled.' }), 'AUTH_USER_DISABLED');
});

test('classifies invalid token and argument failures', () => {
  assert.equal(classifyFirebaseAuthError({ code: 'auth/invalid-id-token', message: 'The provided token is invalid.' }), 'AUTH_TOKEN_INVALID');
  assert.equal(classifyFirebaseAuthError({ code: 'auth/argument-error', message: 'Expected a string.' }), 'AUTH_ARGUMENT_INVALID');
});

test('classifies project and certificate failures', () => {
  assert.equal(classifyFirebaseAuthError({ code: 'auth/id-token-issuer-mismatch', message: 'Issuer mismatch.' }), 'AUTH_PROJECT_MISMATCH');
  assert.equal(classifyFirebaseAuthError({ code: 'auth/certificate-fetch-failed', message: 'Unable to fetch public key.' }), 'AUTH_CERTIFICATE_ERROR');
});

test('classifies internal and unknown failures without throwing', () => {
  assert.equal(classifyFirebaseAuthError({ code: 'auth/internal-error', message: 'Internal error.' }), 'AUTH_INTERNAL');
  assert.equal(classifyFirebaseAuthError({ code: 'something-new', message: 'A new failure.' }), 'AUTH_UNKNOWN');
  assert.equal(classifyFirebaseAuthError(null), 'AUTH_UNKNOWN');
  assert.equal(describeFirebaseAuthError({ code: 'auth/invalid-id-token', message: 'Bearer eyJabc.def.ghi was invalid.' }).message, 'Bearer [redacted] was invalid.');
});
