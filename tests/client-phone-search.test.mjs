import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { matchesClientSearch } from '../lib/client-search.ts';
import { repositoryFixture } from './helpers/repository-fixture.mjs';

test('phone-only Client match beyond the first page survives the same UI predicate', async () => {
  const f = repositoryFixture(); const repository = f.load('lib/repositories/clients.ts');
  for (let i = 0; i < 55; i++) f.records.set(`${f.prefix}/clients/client-${String(i).padStart(3, '0')}`, { name: `Client ${i}`, email: 'fixture@example.test', phone: i === 40 ? '09170001234' : 'other', archived: false, status: 'ACTIVE', createdAt: String(1000 - i) });
  const page = await repository.listClientsPage(f.user, f.org, null, 3, '0001234');
  assert.equal(page.items.length, 1); assert.equal(page.items[0].phone, '09170001234');
  assert.equal(page.items.filter((client) => matchesClientSearch(client, '0001234')).length, 1);
  assert.match(fs.readFileSync('app/clients/page.tsx', 'utf8'), /const matchesSearch = matchesClientSearch\(client, query\)/);
});
test('name, company, email and phone retain existing case-insensitive substring behavior', () => {
  const client = { name: 'ANA', company: 'Company', email: 'ana@example.test', phone: '09170001234' };
  for (const term of ['ana', 'COMP', '@example', '0001234', '']) assert.equal(matchesClientSearch(client, term), true);
  assert.equal(matchesClientSearch(client, 'missing'), false);
});
