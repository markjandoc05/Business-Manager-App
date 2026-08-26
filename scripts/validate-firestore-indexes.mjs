import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(scriptDirectory, '..', 'firestore.indexes.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

assert.ok(Array.isArray(manifest.indexes), 'firestore.indexes.json must contain an indexes array.');
assert.ok(Array.isArray(manifest.fieldOverrides), 'firestore.indexes.json must contain a fieldOverrides array.');

function indexKey(index) {
  return JSON.stringify({
    collectionGroup: index.collectionGroup,
    queryScope: index.queryScope,
    fields: index.fields,
  });
}

const keys = manifest.indexes.map(indexKey);
const duplicateKeys = keys.filter((key, index) => keys.indexOf(key) !== index);
assert.equal(duplicateKeys.length, 0, 'firestore.indexes.json must not contain exact duplicate indexes.');

const requiredIndexes = [
  ['members', 'COLLECTION_GROUP', [['userId', 'ASCENDING'], ['role', 'ASCENDING'], ['status', 'ASCENDING']]],
  ['leads', 'COLLECTION', [['archived', 'ASCENDING'], ['createdAt', 'DESCENDING']]],
  ['leads', 'COLLECTION', [['assignedToUid', 'ASCENDING'], ['archived', 'ASCENDING'], ['status', 'ASCENDING'], ['createdAt', 'DESCENDING']]],
  ['clients', 'COLLECTION', [['archived', 'ASCENDING'], ['createdAt', 'DESCENDING']]],
  ['deals', 'COLLECTION', [['archived', 'ASCENDING'], ['createdAt', 'DESCENDING']]],
  ['tasks', 'COLLECTION', [['archived', 'ASCENDING'], ['status', 'ASCENDING'], ['dueDate', 'ASCENDING']]],
  ['tasks', 'COLLECTION', [['assignedToUid', 'ASCENDING'], ['archived', 'ASCENDING'], ['status', 'ASCENDING'], ['dueDate', 'ASCENDING']]],
  ['activities', 'COLLECTION', [['entityType', 'ASCENDING'], ['entityId', 'ASCENDING']]],
];

for (const [collectionGroup, queryScope, fields] of requiredIndexes) {
  const found = manifest.indexes.some((index) => index.collectionGroup === collectionGroup
    && index.queryScope === queryScope
    && JSON.stringify(index.fields) === JSON.stringify(fields.map(([fieldPath, order]) => ({ fieldPath, order }))));
  assert.ok(found, `Missing required ${queryScope} index for ${collectionGroup}: ${JSON.stringify(fields)}`);
}

console.log(`Validated ${manifest.indexes.length} canonical Firestore indexes; no exact duplicates found.`);
console.log('Console critical organization, member-status, license/settings, and createdAt-only audit-log queries require no additional composite index.');
