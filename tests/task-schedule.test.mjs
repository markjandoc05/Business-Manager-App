import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { test } from 'node:test';
import { normalizeTaskSchedule } from '../lib/task-schedule.ts';
import { formatTaskDueDate } from '../lib/task-utils.ts';

test('explicit instants normalize and impossible dates are rejected', () => {
  assert.equal(normalizeTaskSchedule('2026-10-07T09:00+08:00'), '2026-10-07T01:00:00.000Z');
  for (const input of ['2026-02-30T09:00Z', '2026-10-07', 'invalid', '2026-10-07T25:00Z']) assert.throws(() => normalizeTaskSchedule(input));
});
test('browser local entry becomes the same instant regardless of later reader timezone', () => {
  for (const [timezone, expected] of [['Asia/Manila', '2026-10-07T01:00:00.000Z'], ['UTC', '2026-10-07T09:00:00.000Z'], ['America/New_York', '2026-10-07T13:00:00.000Z']]) {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', "import { normalizeTaskSchedule } from './lib/task-schedule.ts'; console.log(normalizeTaskSchedule('2026-10-07T09:00'));"], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), expected);
  }
});
test('legacy wall-time history is retained and explicitly identified without guessing a timezone', () => {
  const legacy = '2026-10-07T09:00:12';
  assert.equal(normalizeTaskSchedule(legacy.slice(0, 16), legacy), legacy);
  for (const timezone of ['Asia/Manila', 'America/New_York']) assert.equal(formatTaskDueDate(legacy, timezone), '2026-10-07 09:00:12 (timezone unknown)');
  for (const filename of ['app/tasks/page.tsx', 'app/clients/page.tsx']) assert.match(fs.readFileSync(filename, 'utf8'), /if \((?:value && )?isLegacyTaskSchedule\(value\)\) return value.slice\(0, 16\)/);
  const gapLegacy = '2026-03-08T02:30';
  assert.equal(normalizeTaskSchedule(gapLegacy, gapLegacy), gapLegacy);
});
test('unchanged instant editing preserves seconds hidden by a minute-only form', () => {
  const previous = '2026-10-07T01:00:12.345Z';
  const date = new Date(previous);
  const input = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  assert.equal(normalizeTaskSchedule(input, previous), previous);
});
test('DST gaps and repeated local times require an unambiguous selection', () => {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', "import assert from 'node:assert/strict'; import { normalizeTaskSchedule } from './lib/task-schedule.ts'; for (const value of ['2026-03-08T02:30', '2026-11-01T01:30']) assert.throws(() => normalizeTaskSchedule(value));"], { env: { ...process.env, TZ: 'America/New_York' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
