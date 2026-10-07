import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { test } from 'node:test';
import { getWorkspaceCalendarDate } from '../lib/workspace-calendar.ts';

test('actual Sale form defaults to the workspace calendar rather than operator calendar', () => {
  const source = fs.readFileSync('components/SaleRecordModal.tsx','utf8');
  const block = source.slice(source.indexOf('function emptyForm('), source.indexOf('function paymentLabel('));
  const compiled = ts.transpileModule(`export ${block}`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const fixtureModule = {exports:{}};
  class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-02-28T23:00:00Z'])); } }
  vm.runInNewContext(compiled, {module:fixtureModule,exports:fixtureModule.exports,Date:FixtureDate,getWorkspaceCalendarDate});
  assert.equal(fixtureModule.exports.emptyForm(undefined,undefined,'Asia/Manila').saleDate,'2026-03-01');
  assert.equal(fixtureModule.exports.emptyForm(undefined,undefined,'America/New_York').saleDate,'2026-02-28');
});
test('recorded date-only Sale history validates identically in a zone with a skipped historical day', () => {
  const code = `import {normalizeSaleDate} from './lib/sale-workflow.ts'; console.log(normalizeSaleDate('2011-12-30'));`;
  for (const TZ of ['UTC','Pacific/Apia','Asia/Manila']) assert.equal(execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code], {env:{...process.env,TZ},encoding:'utf8'}).trim(), '2011-12-30');
});
