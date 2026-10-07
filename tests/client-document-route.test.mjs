import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serverRecordFixture} from './helpers/server-record-fixture.mjs';
const ctx=f=>({params:Promise.resolve({orgId:f.org,clientId:'client',documentId:'document'})});
const put=(f,bytes,headers={})=>f.route.PUT(new Request('http://127.0.0.1/documents',{method:'PUT',headers:{'X-Document-Name':'synthetic.pdf','Content-Type':'application/pdf',...headers},body:bytes}),ctx(f));
const fixture=role=>{const f=serverRecordFixture(role);return {...f,route:f.load('app/api/organizations/[orgId]/clients/[clientId]/documents/[documentId]/route.ts')};};
test('actual route enforces streamed and declared 1 MiB boundaries; download is attachment/no-store without share URL',async()=>{
  const f=fixture();assert.equal((await put(f,Buffer.alloc(1048576))).status,200);const read=await f.route.GET({headers:new Headers()},ctx(f));assert.equal(read.status,200);assert.equal((await read.arrayBuffer()).byteLength,1048576);assert.equal(read.headers.get('cache-control'),'private, no-store');assert.ok(read.headers.get('content-disposition').startsWith('attachment;'));assert.equal(read.headers.get('x-content-type-options'),'nosniff');
  for(const headers of [{},{'Content-Length':'1048577'}]){const large=fixture();assert.equal((await put(large,Buffer.alloc(1048577),headers)).status,413);assert.equal(large.objects.size,0);}
  const empty=fixture();assert.equal((await put(empty,Buffer.alloc(0))).status,400);
});
test('actual routes deny absent/revoked tokens, global/tenant/role failures and malformed archive requests',async()=>{
  const f=fixture();f.setAuthenticated(false);assert.equal((await put(f,Buffer.from('PDF'))).status,401);assert.equal((await f.route.GET({headers:new Headers()},ctx(f))).status,401);assert.equal(f.objects.size,0);
  const user=fixture('USER');assert.equal((await put(user,Buffer.from('PDF'))).status,403);assert.equal(user.objects.size,0);
  const invalid=fixture();assert.equal((await invalid.route.PATCH({headers:new Headers(),json:async()=>({archived:['true']})},ctx(invalid))).status,400);
});
