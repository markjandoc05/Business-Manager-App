import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serverRecordFixture} from './helpers/server-record-fixture.mjs';
import {repositoryFixture} from './helpers/repository-fixture.mjs';
function fixture() {
  let f;const urls=[];
  f=serverRecordFixture('ADMIN',{'@/lib/repositories/authenticatedRequest':{authenticatedFetch:async(url,init)=>{urls.push(url);const request=new Request('http://127.0.0.1'+url,init);return f.load('app/api/organizations/[orgId]/clients/[clientId]/documents/[documentId]/route.ts').PUT(request,{params:Promise.resolve({orgId:f.org,clientId:'client',documentId:url.split('/').at(-1)})});}}});
  return {...f,urls,repository:f.load('lib/repositories/clients.ts')};
}
const file=()=>new File(['Synthetic PDF'],'synthetic.pdf',{type:'application/pdf'});
test('actual repository upload uses authenticated server route and no browser Storage or metadata writes',async()=>{
  const f=fixture();const result=await f.repository.uploadClientDocument(f.user,f.org,'client',file());assert.equal(result.name,'synthetic.pdf');assert.equal(result.downloadURL,undefined);assert.ok(result.uploadedAt.includes('T'));assert.equal(f.objects.size,1);assert.equal(f.deleted.length,0);
});
for(const mode of ['before','commit'])test(`actual ${mode} uncertainty retries reselected identical bytes with the same document identity`,async()=>{
  const f=fixture();f.failSave(mode);await assert.rejects(f.repository.uploadClientDocument(f.user,f.org,'client',file()));assert.equal(f.deleted.length,0);f.failSave(null);const recovered=await f.repository.uploadClientDocument(f.user,f.org,'client',file());assert.equal(f.urls[0],f.urls[1]);assert.equal(f.objects.size,1);assert.ok(f.records.has(`${f.prefix}/clients/client/documents/${recovered.id}`));
});
test('actual lost upload acknowledgement is confirmed without deleting its object',async()=>{
  const f=fixture();f.failSave('after');await f.repository.uploadClientDocument(f.user,f.org,'client',file());assert.equal(f.objects.size,1);assert.equal(f.deleted.length,0);
});
test('actual pending upload recovers after repository/browser restart even without local storage',async()=>{
  const f=fixture();f.failSave('before');await assert.rejects(f.repository.uploadClientDocument(f.user,f.org,'client',file()));f.failSave(null);
  const fresh=repositoryFixture('ADMIN',{'firebase/firestore':f.firestore,'@/lib/repositories/authenticatedRequest':{authenticatedFetch:async(url,init)=>f.load('app/api/organizations/[orgId]/clients/[clientId]/documents/[documentId]/route.ts').PUT(new Request('http://127.0.0.1'+url,init),{params:Promise.resolve({orgId:f.org,clientId:'client',documentId:url.split('/').at(-1)})})}}).load('lib/repositories/clients.ts');
  const result=await fresh.uploadClientDocument(f.user,f.org,'client',file());
  const operations=[...f.records].filter(([path])=>path.includes('/documentOperations/'));assert.equal(operations.length,1);assert.equal(operations[0][1].state,'REGISTERED');assert.equal(operations[0][0].split('/').at(-1),result.id);
  f.records.get(`${f.prefix}/clients/client`).trashed=true;
  await f.load('lib/server/client-document-service.ts').removeClientDocumentFiles(f.org,'client',f.user.uid,[{documentId:result.id,storagePath:result.storagePath}]);assert.equal(f.deleted.length,1);
});
