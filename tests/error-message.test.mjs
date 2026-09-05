import assert from 'node:assert/strict';
import test from 'node:test';
import { userFacingErrorMessage } from '../lib/repositories/pagination.ts';

test('sanitizes Firestore permission errors', () => {
  assert.equal(
    userFacingErrorMessage({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }),
    "You don't have permission to perform this action.",
  );
});

test('sanitizes authentication, missing-index, unavailable, and unknown Firebase errors', () => {
  assert.equal(userFacingErrorMessage({ code: 'unauthenticated', message: 'The user must be authenticated.' }), 'Your session has expired. Please sign in again.');
  assert.equal(userFacingErrorMessage({ code: 'failed-precondition', message: 'The query requires an index. Create it here: https://console.firebase.google.com/...' }), 'This information is temporarily unavailable. Please try again.');
  assert.equal(userFacingErrorMessage({ code: 'unavailable', message: 'The service is temporarily unavailable.' }), 'Unable to connect. Please check your connection and try again.');
  assert.equal(userFacingErrorMessage({ name: 'FirebaseError', code: 'internal', message: 'organizations/org-a/sales/sale-1' }), 'Something went wrong. Please try again.');
});

test('preserves intentionally generated application validation errors', () => {
  assert.equal(userFacingErrorMessage(new Error('The start date cannot be after the end date.')), 'The start date cannot be after the end date.');
  assert.equal(userFacingErrorMessage({ code: 'not-found', message: 'Document does not exist.' }), 'The requested record could not be found.');
});
