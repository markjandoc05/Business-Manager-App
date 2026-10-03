import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMON_TIMEZONES, isValidTimeZone } from '../lib/timezones.ts';

test('common workspace timezones are valid IANA zones', () => {
  for (const timezone of COMMON_TIMEZONES) assert.equal(isValidTimeZone(timezone), true);
});

test('invalid workspace timezone text is rejected', () => {
  assert.equal(isValidTimeZone('Not/A_Timezone'), false);
  assert.equal(isValidTimeZone(''), false);
});
