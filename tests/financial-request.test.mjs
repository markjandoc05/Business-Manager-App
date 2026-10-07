import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { test } from 'node:test';
import ts from 'typescript';

function browserSession(storage, transport) {
  const source = fs.readFileSync('lib/repositories/financialRequest.ts', 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const fixtureModule = { exports: {} };
  const sessionStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  vm.runInNewContext(compiled, { module: fixtureModule, exports: fixtureModule.exports, crypto: webcrypto, TextEncoder, Uint8Array, sessionStorage, Error, Map, require: (name) => { assert.equal(name, '@/lib/repositories/authenticatedRequest'); return { authenticatedFetch: transport }; } });
  return fixtureModule.exports.financialRequest;
}

test('lost response, session reload and temporary access denial retain the operation key until confirmed success', async () => {
  const storage = new Map(); const keys = []; const payload = { amount: 0.2, notes: 'Synthetic private note' };
  let phase = 'lost';
  const transport = async (_path, request) => {
    keys.push(request.headers['Idempotency-Key']);
    if (phase === 'lost') throw new Error('Lost response');
    if (phase === 'denied') return new Response(JSON.stringify({ error: 'Access denied' }), { status: 403 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  await assert.rejects(browserSession(storage, transport)('actor', '/payments', payload), /Lost response/);
  assert.equal(storage.size, 1);
  assert.equal(JSON.stringify([...storage]).includes(payload.notes), false);
  phase = 'denied'; await assert.rejects(browserSession(storage, transport)('actor', '/payments', payload), /Access denied/);
  phase = 'success'; await browserSession(storage, transport)('actor', '/payments', payload);
  assert.equal(new Set(keys).size, 1); assert.equal(storage.size, 0);
  await browserSession(storage, transport)('actor', '/payments', payload);
  assert.notEqual(keys.at(-1), keys[0]);
});

test('different actor, destination or payment details do not share retry identities', async () => {
  const keys = []; const transport = async (_path, request) => { keys.push(request.headers['Idempotency-Key']); return new Response('{}', { status: 500 }); };
  const request = browserSession(new Map(), transport);
  for (const [uid, path, body] of [['a', '/one', { amount: 1 }], ['b', '/one', { amount: 1 }], ['a', '/two', { amount: 1 }], ['a', '/one', { amount: 2 }]]) await assert.rejects(request(uid, path, body));
  assert.equal(new Set(keys).size, 4);
});
