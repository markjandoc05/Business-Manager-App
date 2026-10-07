import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repositoryFixture } from './helpers/repository-fixture.mjs';

test('real Deal repository repeats stage and archive/restore cycles without overwriting SYSTEM events', async () => {
  const f = repositoryFixture(); const repository = f.load('lib/repositories/deals.ts');
  f.records.set(`${f.prefix}/clients/client`, { name: 'Fixture Client', status: 'ACTIVE' });
  f.records.set(`${f.prefix}/deals/deal`, { title: 'Fixture Deal', value: 100, clientId: 'client', stage: 'New', status: 'Active', archived: false });
  for (const stage of ['Qualified', 'New', 'Qualified']) {
    const deal = await repository.getDealById(f.user, f.org, 'deal');
    await repository.updateDealStage(f.user, f.org, deal, stage);
  }
  for (let repeat = 0; repeat < 2; repeat++) { await repository.archiveDeal(f.user, f.org, 'deal'); await repository.restoreDeal(f.user, f.org, 'deal'); }
  const events = [...f.records].filter(([key]) => key.startsWith(`${f.prefix}/deals/deal/timeline/`));
  assert.equal(events.length, 7); assert.equal(new Set(events.map(([key]) => key)).size, 7);
  assert.equal(f.records.get(`${f.prefix}/deals/deal`).archived, false);
  const timeline = f.load('lib/repositories/dealTimeline.ts');
  assert.equal(timeline.dealSystemTimelineRef(f.org, 'deal', 'system-created').id, 'system-system-created');
  assert.equal(timeline.dealSystemTimelineRef(f.org, 'deal', 'created').id, 'system-created');
});

test('real Lead repository can repeat Lost → New → Lost while preserving prior immutable entries', async () => {
  const f = repositoryFixture(); const repository = f.load('lib/repositories/leads.ts');
  f.records.set(`${f.prefix}/leads/lead`, { status: 'New', assignedToUid: f.user.uid });
  for (const status of ['Lost', 'New', 'Lost']) {
    const lead = { id: 'lead', ...f.records.get(`${f.prefix}/leads/lead`) };
    await repository.updateLeadStatus(f.user, f.org, lead, status);
  }
  assert.equal([...f.records.keys()].filter((key) => key.startsWith(`${f.prefix}/leads/lead/timeline/`)).length, 2);
  const timeline = f.load('lib/repositories/leadTimeline.ts');
  assert.equal(timeline.systemTimelineRef(f.org, 'lead', 'converted').id, 'system-converted');
  assert.equal(timeline.systemTimelineRef(f.org, 'lead', 'created').id, 'system-created');
});

test('real Task repository clears linked relation durably and stores an explicit UTC instant', async () => {
  const f = repositoryFixture(); const repository = f.load('lib/repositories/tasks.ts');
  f.records.set(`${f.prefix}/clients/client`, { name: 'Fixture Client', status: 'ACTIVE' });
  const input = { title: 'Task', type: 'Task', dueDate: '2026-10-07T09:00:00+08:00', priority: 'Medium', relatedTo: { type: 'Client', id: 'client' }, assignedToUid: f.user.uid, assignedToName: f.user.name };
  const task = await repository.createTask(f.user, f.org, input);
  assert.equal(f.records.get(`${f.prefix}/tasks/${task.id}`).dueDate, '2026-10-07T01:00:00.000Z');
  await repository.updateTask(f.user, f.org, task.id, { ...input, relatedTo: undefined });
  assert.equal(Object.hasOwn(f.records.get(`${f.prefix}/tasks/${task.id}`), 'relatedTo'), false);
  assert.equal((await repository.getTaskById(f.user, f.org, task.id)).relatedTo, undefined);
  f.records.get(`${f.prefix}/clients/client`).status = 'ARCHIVED';
  await repository.updateTask(f.user, f.org, task.id, { ...input, relatedTo: undefined });
});

test('unchanged timezone-less Task history remains exact during unrelated editing', async () => {
  const f = repositoryFixture(); const repository = f.load('lib/repositories/tasks.ts');
  const previous = '2026-10-07T09:00:12';
  f.records.set(`${f.prefix}/tasks/legacy`, { title: 'Legacy', dueDate: previous, assignedToUid: f.user.uid });
  await repository.updateTask(f.user, f.org, 'legacy', { title: 'Renamed', type: 'Task', dueDate: previous.slice(0, 16), priority: 'Medium', assignedToUid: f.user.uid });
  assert.equal(f.records.get(`${f.prefix}/tasks/legacy`).dueDate, previous);
});

test('changing an existing Client-linked Task to General removes the persisted field after reload', async () => {
  const f = repositoryFixture(); const repository = f.load('lib/repositories/tasks.ts');
  const input = { title: 'General Task', dueDate: '2026-10-07T01:00:00.000Z', type: 'Task', priority: 'Medium', assignedToUid: f.user.uid, relatedTo: undefined };
  f.records.set(`${f.prefix}/tasks/task`, { ...input, relatedTo: { type: 'Client', id: 'client' } });
  await repository.updateTask(f.user, f.org, 'task', input);
  assert.equal(Object.hasOwn(f.records.get(`${f.prefix}/tasks/task`), 'relatedTo'), false);
  assert.equal((await repository.getTaskById(f.user, f.org, 'task')).relatedTo, undefined);
});
