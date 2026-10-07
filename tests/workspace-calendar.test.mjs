import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { addCalendarDays, getWorkspaceCalendarDate, rollingWorkspaceRange, workspaceCalendarRange, workspaceDayStart, workspaceReportRange } from '../lib/workspace-calendar.ts';

test('workspace month/day boundaries are independent of the browser zone', () => {
  const program = `import {workspaceReportRange,rollingWorkspaceRange,getWorkspaceCalendarDate} from './lib/workspace-calendar.ts'; const now=new Date('2026-03-01T01:00:00Z'); console.log(JSON.stringify([workspaceReportRange('ThisMonth',now,'Asia/Manila'),workspaceReportRange('LastMonth',now,'America/New_York'),rollingWorkspaceRange(7,now,'Pacific/Kiritimati'),getWorkspaceCalendarDate(now,'America/New_York')]));`;
  const results = ['UTC', 'Asia/Manila', 'America/Los_Angeles'].map(TZ => execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', program], { env: { ...process.env, TZ }, encoding: 'utf8' }));
  assert.equal(new Set(results).size, 1);
  const [month, last, week, nyDate] = JSON.parse(results[0]);
  assert.equal(month.start, '2026-02-28T16:00:00.000Z'); assert.equal(month.startDay, '2026-03-01');
  assert.equal(last.startDay, '2026-01-01'); assert.equal(last.endDay, '2026-02-01');
  assert.equal(week.startDay, '2026-02-23'); assert.equal(week.endDay, '2026-03-02'); assert.equal(nyDate, '2026-02-28');
});
test('half-open workspace days handle 23-hour, 25-hour and midnight-transition days', () => {
  const spring = workspaceCalendarRange('2026-03-08', '2026-03-09', 'America/New_York');
  const fall = workspaceCalendarRange('2026-11-01', '2026-11-02', 'America/New_York');
  assert.equal((spring.end - spring.start) / 3600000, 23); assert.equal((fall.end - fall.start) / 3600000, 25);
  assert.equal(workspaceDayStart('2018-11-04', 'America/Sao_Paulo').toISOString(), '2018-11-04T03:00:00.000Z');
  assert.throws(() => workspaceDayStart('2011-12-30', 'Pacific/Apia'), /does not exist/);
});
test('calendar math validates dates and supports month/year/leap/quarter boundaries', () => {
  assert.equal(addCalendarDays('2024-02-29', 1), '2024-03-01'); assert.throws(() => addCalendarDays('2026-02-30', 1));
  assert.equal(workspaceReportRange('ThisQuarter', new Date('2026-10-07T00:00:00Z')).startDay, '2026-10-01');
  assert.equal(workspaceReportRange('ThisYear', new Date('2026-10-07T00:00:00Z')).startDay, '2026-01-01');
  assert.equal(rollingWorkspaceRange(28, new Date('2026-01-01T00:00:00Z')).startDay, '2025-12-05');
  assert.equal(getWorkspaceCalendarDate(new Date('2026-01-01T00:00:00Z'), 'Pacific/Pago_Pago'), '2025-12-31');
  assert.throws(() => workspaceCalendarRange('2026-03-02', '2026-03-01')); assert.throws(() => getWorkspaceCalendarDate(new Date(), 'invalid-zone'));
});
