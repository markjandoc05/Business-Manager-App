import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIRESTORE_WORKSPACE_INDEX_ERROR,
  firestoreWorkspaceErrorMessage,
  isFirestoreIndexError,
} from '../lib/repositories/pagination.ts';

test('classifies a missing collection-group index error', () => {
  const error = { code: 'failed-precondition', message: 'The query requires an index. You can create it here: https://console.firebase.google.com/project/example/firestore/indexes?create_composite=abc' };
  assert.equal(isFirestoreIndexError(error), true);
  assert.equal(firestoreWorkspaceErrorMessage(error), FIRESTORE_WORKSPACE_INDEX_ERROR);
});

test('classifies an index that is still building', () => {
  const error = { code: 'FAILED-PRECONDITION', message: 'The database index is currently building.' };
  assert.equal(isFirestoreIndexError(error), true);
  assert.equal(firestoreWorkspaceErrorMessage(error), FIRESTORE_WORKSPACE_INDEX_ERROR);
});

test('does not swallow unrelated failed-precondition errors', () => {
  const error = { code: 'failed-precondition', message: 'The write failed because the precondition was not met.' };
  assert.equal(isFirestoreIndexError(error), false);
  assert.equal(firestoreWorkspaceErrorMessage(error), 'Workspace information is not available yet.');
});
