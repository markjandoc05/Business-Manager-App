import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getClientDocumentSizeError, MAX_CLIENT_DOCUMENT_SIZE } from '../lib/client-documents.ts';

test('a file smaller than 1 MB is allowed by application validation', () => {
  assert.equal(getClientDocumentSizeError(MAX_CLIENT_DOCUMENT_SIZE - 1), null);
});

test('a file exactly 1 MB is allowed by application validation', () => {
  assert.equal(getClientDocumentSizeError(MAX_CLIENT_DOCUMENT_SIZE), null);
});

test('a file one byte over 1 MB is rejected by application validation', () => {
  assert.equal(getClientDocumentSizeError(MAX_CLIENT_DOCUMENT_SIZE + 1), 'File is too large. Maximum upload size is 1 MB.');
});
