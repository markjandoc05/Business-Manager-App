import assert from 'node:assert/strict';
import test from 'node:test';

function boundedFilteredPage(records, matches, pageSize, cursor = 0) {
  const items = [];
  let index = cursor;
  while (index < records.length && items.length <= pageSize) {
    const end = Math.min(records.length, index + pageSize);
    for (; index < end; index += 1) {
      if (matches(records[index])) items.push({ record: records[index], cursor: index + 1 });
      if (items.length > pageSize) break;
    }
    if (items.length > pageSize || end === records.length) break;
  }
  return {
    items: items.slice(0, pageSize).map(({ record }) => record.id),
    nextCursor: items.length > pageSize ? items[pageSize - 1].cursor : null,
    hasMore: items.length > pageSize,
  };
}

test('Client Sales History filters are applied across ordered pages', () => {
  const records = [
    { id: 'sale-1', clientId: 'client-a', source: 'WALK_IN', archived: false },
    { id: 'sale-2', clientId: 'client-a', source: 'CLIENT', archived: true },
    { id: 'sale-3', clientId: 'client-a', source: 'CLIENT', archived: false },
    { id: 'sale-4', clientId: 'client-a', source: 'CLIENT', archived: false },
  ];
  const matches = (sale) => sale.clientId === 'client-a' && sale.source === 'CLIENT' && sale.archived === false;
  const page1 = boundedFilteredPage(records, matches, 1);
  const page2 = boundedFilteredPage(records, matches, 1, page1.nextCursor || 0);
  assert.deepEqual(page1, { items: ['sale-3'], nextCursor: 3, hasMore: true });
  assert.deepEqual(page2, { items: ['sale-4'], nextCursor: null, hasMore: false });
});

test('bounded Client child history pagination skips archived rows without duplicates', () => {
  const records = [
    { id: 'note-1', archived: true },
    { id: 'note-2', archived: false },
    { id: 'note-3', archived: true },
    { id: 'note-4', archived: false },
    { id: 'note-5', archived: false },
  ];
  const matches = (record) => record.archived === false;
  const page1 = boundedFilteredPage(records, matches, 2);
  const page2 = boundedFilteredPage(records, matches, 2, page1.nextCursor || 0);
  assert.deepEqual(page1, { items: ['note-2', 'note-4'], nextCursor: 4, hasMore: true });
  assert.deepEqual(page2, { items: ['note-5'], nextCursor: null, hasMore: false });
  assert.deepEqual([...page1.items, ...page2.items], ['note-2', 'note-4', 'note-5']);
});

test('bounded activity history resolves matches after an empty raw page', () => {
  const records = [
    { id: 'activity-other-1', clientId: 'client-b' },
    { id: 'activity-other-2', clientId: 'client-b' },
    { id: 'activity-client-a', clientId: 'client-a' },
  ];
  assert.deepEqual(boundedFilteredPage(records, (record) => record.clientId === 'client-a', 1), {
    items: ['activity-client-a'],
    nextCursor: null,
    hasMore: false,
  });
});
