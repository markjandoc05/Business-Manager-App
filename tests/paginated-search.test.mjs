import assert from 'node:assert/strict';
import test from 'node:test';

function boundedSearch(records, term, pageSize, cursor = 0) {
  const needle = term.trim().toLowerCase();
  const matches = [];
  let index = cursor;
  while (index < records.length && matches.length <= pageSize) {
    const end = Math.min(records.length, index + pageSize);
    for (; index < end; index += 1) {
      const record = records[index];
      if (`${record.name} ${record.company || ''} ${record.email || ''} ${record.phone || ''}`.toLowerCase().includes(needle)) matches.push({ record, cursor: index + 1 });
      if (matches.length > pageSize) break;
    }
    if (matches.length > pageSize || end === records.length) break;
  }
  return { items: matches.slice(0, pageSize).map(({ record }) => record.id), nextCursor: matches.length > pageSize ? matches[pageSize - 1].cursor : null, hasMore: matches.length > pageSize };
}

test('global paginated search finds later Leads/Clients without downloading the full collection', () => {
  const records = [
    { id: 'a', name: 'Alpha' },
    { id: 'b', name: 'Beta' },
    { id: 'c', name: 'Maria Santos', company: 'ABC Medical' },
  ];
  assert.deepEqual(boundedSearch(records, 'ABC Medical', 2), { items: ['c'], nextCursor: null, hasMore: false });
});
