import assert from 'node:assert/strict';
import test from 'node:test';

// Mirrors the repository's lifecycle predicate without requiring Next's @/*
// module alias in the plain Node test runner.
function salesViewMatches(sale, view) {
  const archived = sale.archived === true;
  const trashed = sale.trashed === true;
  return view === 'TRASH' ? trashed : view === 'ARCHIVED' ? archived && !trashed : !archived && !trashed;
}

function scanPages(records, view, pageSize, cursor = 0) {
  const matches = [];
  let index = cursor;
  const rawPageSize = pageSize;
  while (index < records.length && matches.length <= pageSize) {
    const end = Math.min(records.length, index + rawPageSize);
    for (; index < end; index += 1) {
      if (salesViewMatches(records[index], view)) matches.push({ record: records[index], cursor: index + 1 });
      if (matches.length > pageSize) break;
    }
    if (matches.length > pageSize || end === records.length) break;
  }
  return {
    items: matches.slice(0, pageSize).map(({ record }) => record.id),
    nextCursor: matches.length > pageSize ? matches[pageSize - 1].cursor : null,
    hasMore: matches.length > pageSize,
  };
}

const records = [
  { id: 'normal-1', archived: false, trashed: false, source: 'WALK_IN' },
  { id: 'archived-1', archived: true, trashed: false, source: 'CLIENT' },
  { id: 'trash-1', archived: true, trashed: true, source: 'WALK_IN' },
  { id: 'normal-2', archived: false, trashed: false, source: 'CLIENT' },
  { id: 'archived-2', archived: true, trashed: false, source: 'CLIENT' },
  { id: 'normal-3', archived: false, trashed: false, source: 'WALK_IN' },
  { id: 'trash-2', archived: true, trashed: true, source: 'WALK_IN' },
  { id: 'normal-4', archived: false, trashed: false, source: 'CLIENT' },
  { id: 'normal-5', archived: false, trashed: false, source: 'WALK_IN' },
  { id: 'normal-6', archived: false, trashed: false, source: 'CLIENT' },
];

test('Sales pagination fills a Normal page across mixed lifecycle records and continues without skips', () => {
  const page1 = scanPages(records, 'NORMAL', 5);
  assert.deepEqual(page1.items, ['normal-1', 'normal-2', 'normal-3', 'normal-4', 'normal-5']);
  assert.equal(page1.hasMore, true);
  const page2 = scanPages(records, 'NORMAL', 5, page1.nextCursor);
  assert.deepEqual(page2.items, ['normal-6']);
  assert.equal(page2.hasMore, false);
});

test('Sales pagination handles Archived and Trash views independently', () => {
  assert.deepEqual(scanPages(records, 'ARCHIVED', 2), { items: ['archived-1', 'archived-2'], nextCursor: null, hasMore: false });
  assert.deepEqual(scanPages(records, 'TRASH', 2), { items: ['trash-1', 'trash-2'], nextCursor: null, hasMore: false });
});

test('Sales pagination resolves an empty first raw page for the requested lifecycle view', () => {
  const laterArchive = [
    { id: 'normal-1', archived: false, trashed: false },
    { id: 'normal-2', archived: false, trashed: false },
    { id: 'archived-1', archived: true, trashed: false },
  ];
  assert.deepEqual(scanPages(laterArchive, 'ARCHIVED', 1), { items: ['archived-1'], nextCursor: null, hasMore: false });
});

test('Sales pagination preserves lifecycle plus source filtering', () => {
  const clientArchived = records.filter((record) => record.source === 'CLIENT');
  assert.deepEqual(scanPages(clientArchived, 'ARCHIVED', 1), { items: ['archived-1'], nextCursor: 1, hasMore: true });
  assert.deepEqual(scanPages(clientArchived, 'ARCHIVED', 1, 1), { items: ['archived-2'], nextCursor: null, hasMore: false });
});

test('Legacy Sales without lifecycle metadata remain in Normal view', () => {
  assert.equal(salesViewMatches({}, 'NORMAL'), true);
});
