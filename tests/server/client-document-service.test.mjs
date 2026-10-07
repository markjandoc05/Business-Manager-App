import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Timestamp} from 'firebase-admin/firestore';
import {serverRecordFixture} from '../helpers/server-record-fixture.mjs';
const fixture=role=>{const f=serverRecordFixture(role);return {...f,service:f.load('lib/server/client-document-service.ts')};};
const upload=(f,id='document',bytes=Buffer.from('Synthetic PDF'))=>f.service.uploadClientDocumentOnServer(f.org,'client',id,f.user.uid,'synthetic.pdf','application/pdf',bytes);
const archive=(f,id='document',value=true)=>f.service.changeClientDocumentArchive(f.org,'client',id,f.user.uid,value);
const remove=(f,id='document')=>f.service.deleteClientDocumentOnServer(f.org,'client',id,f.user.uid);
const path=f=>`${f.prefix}/clients/client/documents/document/synthetic.pdf`;
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('new upload registration is atomic and replayable, with private objects and no token URL',async()=>{
  const f=fixture();const [a,b]=await Promise.all([upload(f),upload(f)]);assert.equal(a.id,b.id);assert.equal(f.objects.size,1);assert.equal(f.records.get(`${f.prefix}/clients/client/documentOperations/document`).state,'REGISTERED');assert.equal(a.downloadURL,undefined);assert.equal(f.objects.get(path(f)).metadata.metadata.firebaseStorageDownloadTokens,undefined);
  await assert.rejects(upload(f,'document',Buffer.from('Different')),/different file details/);assert.equal(f.deleted.length,0);
});
test('upload and registration acknowledgement loss recover without destructive compensation',async()=>{
  for(const mode of ['after','commit','before']){const f=fixture();f.failSave(mode);if(mode==='after')await upload(f);else await assert.rejects(upload(f));assert.equal(f.deleted.length,0);f.failSave(null);await upload(f);assert.equal(f.objects.size,1);assert.equal(f.records.get(`${f.prefix}/clients/client/documentOperations/document`).state,'REGISTERED');}
});
test('read policy permits all member roles after expiry and archived records while current global/tenant/member checks deny',async()=>{
  const f=fixture();await upload(f);await archive(f);const legacy=f.records.get(`${f.prefix}/clients/client/documents/document`);legacy.downloadURL='https://legacy.example.test/unchanged-token';
  f.records.get(f.prefix).status='expired';f.records.get(f.prefix).licenseWriteEnabled=false;f.records.get(`${f.prefix}/license/current`).subscriptionEndsAt=Timestamp.fromMillis(1);f.records.get(`${f.prefix}/clients/client`).archived=true;
  for(const role of ['ADMIN','MANAGER','USER']){f.records.get(`${f.prefix}/members/${f.user.uid}`).role=role;assert.equal((await f.service.readClientDocumentOnServer(f.org,'client','document',f.user.uid)).bytes.toString(),'Synthetic PDF');}
  assert.equal(legacy.downloadURL,'https://legacy.example.test/unchanged-token');await assert.rejects(upload(f,'another'));f.records.get(`users/${f.user.uid}`).active=false;await assert.rejects(f.service.readClientDocumentOnServer(f.org,'client','document',f.user.uid));
});
test('unknown/pending cleanup never deletes; pending upload blocks Client deletion and registration recovers after retry',async()=>{
  const f=fixture();const release=f.holdSave();const pending=upload(f);await tick();
  await assert.rejects(f.service.refuseUnknownDocumentCleanup(f.org,'client','document',f.user.uid,path(f)),/pending/);
  f.records.get(`${f.prefix}/clients/client`).trashed=true;
  await assert.rejects(f.service.removeClientDocumentFiles(f.org,'client',f.user.uid,[]),/pending/);assert.equal(f.deleted.length,0);assert.equal(f.records.has(`${f.prefix}/clientDocumentGuards/client`),false);
  f.records.get(`${f.prefix}/clients/client`).trashed=false;release();await pending;
  const unknown=fixture();await assert.rejects(unknown.service.refuseUnknownDocumentCleanup(unknown.org,'client','unknown',unknown.user.uid,`${unknown.prefix}/clients/client/documents/unknown/file.pdf`),/retained/);assert.equal(unknown.deleted.length,0);
});
test('delete reserves an archived document against restore and upload; failed Storage deletion retries the same generation',async()=>{
  const f=fixture();await upload(f);await archive(f);const release=f.holdDelete();const pending=remove(f);await tick();
  await assert.rejects(archive(f,'document',false),/deletion/);await assert.rejects(upload(f),/unavailable|already exists/);release();await pending;await remove(f);assert.equal(f.deleted.length,1);assert.equal(f.records.has(`${f.prefix}/clients/client/documents/document`),false);
  const failed=fixture();await upload(failed);await archive(failed);failed.failDelete();await assert.rejects(remove(failed),/remains reserved/);assert.equal(failed.objects.size,1);await assert.rejects(archive(failed,'document',false));failed.failDelete(false);await remove(failed);assert.equal(failed.objects.size,0);
});
test('generation replacement, active metadata and unscoped legacy paths fail closed without rewriting history',async()=>{
  const f=fixture();await upload(f);await assert.rejects(remove(f),/archived/);await archive(f);f.failDelete();await assert.rejects(remove(f));f.failDelete(false);f.objects.get(path(f)).metadata.generation='999';await assert.rejects(remove(f));assert.equal(f.objects.size,1);
  const old=fixture();const metadata={name:'Old',storagePath:'clients/root/documents/document/file.pdf',downloadURL:'old-token',size:'10',uploadedBy:'legacy',archived:true};old.records.set(`${old.prefix}/clients/client/documents/document`,metadata);
  await assert.rejects(old.service.readClientDocumentOnServer(old.org,'client','document',old.user.uid),/namespace/);await assert.rejects(remove(old),/namespace/);assert.deepEqual(old.records.get(`${old.prefix}/clients/client/documents/document`),metadata);assert.equal(old.deleted.length,0);
});
test('parent cleanup freezes document transitions before Storage mutation and blocks financial/pending references',async()=>{
  const f=fixture();await upload(f);f.records.get(`${f.prefix}/clients/client`).trashed=true;const release=f.holdDelete();const pending=f.service.removeClientDocumentFiles(f.org,'client',f.user.uid,[{documentId:'document',storagePath:path(f)}]);await tick();
  await assert.rejects(archive(f),/in progress/);await assert.rejects(upload(f,'new'),/in progress/);release();await pending;assert.equal(f.deleted.length,1);assert.equal(f.records.get(`${f.prefix}/clientDocumentGuards/client`).state,'DELETING');
  const blocked=fixture();blocked.records.get(`${blocked.prefix}/clients/client`).trashed=true;blocked.records.set(`${blocked.prefix}/sales/sale`,{clientId:'client',status:'VOIDED'});await assert.rejects(blocked.service.removeClientDocumentFiles(blocked.org,'client',blocked.user.uid,[]),/FINANCIAL_REFERENCES/);assert.equal(blocked.records.has(`${blocked.prefix}/clientDocumentGuards/client`),false);
});
test('supported extension fallbacks and MIME aliases retain one-file namespaces; invalid types, roles and license mirrors deny',async()=>{
  for(const extension of ['pdf','doc','docx','xls','xlsx','jpg','jpeg','png']){const f=fixture();const data=await f.service.uploadClientDocumentOnServer(f.org,'client','document',f.user.uid,`synthetic.${extension}`,'',Buffer.from('Fixture'));assert.ok(data.mimeType);assert.equal(f.objects.size,1);}
  const dotted=fixture();await dotted.service.uploadClientDocumentOnServer(dotted.org,'client','document',dotted.user.uid,'..','application/pdf',Buffer.from('Fixture'));assert.ok((await dotted.service.readClientDocumentOnServer(dotted.org,'client','document',dotted.user.uid)).bytes);
  for(const change of ['USER','inactive','identity','member','foreign','canonical','mirror','archive']){const f=fixture(change==='USER'?'USER':'ADMIN');if(change==='inactive')f.records.get(`users/${f.user.uid}`).active=false;if(change==='identity')f.records.get(`users/${f.user.uid}`).uid='other';if(change==='member')f.records.get(`${f.prefix}/members/${f.user.uid}`).userId='other';if(change==='canonical')f.records.get(`${f.prefix}/license/current`).status='EXPIRED';if(change==='mirror')f.records.get(f.prefix).licenseWriteEnabled=false;if(change==='archive')f.records.get(`${f.prefix}/clients/client`).archived=true;await assert.rejects(f.service.uploadClientDocumentOnServer(change==='foreign'?'other-org':f.org,'client','document',f.user.uid,'synthetic.pdf','application/pdf',Buffer.from('Fixture')));assert.equal(f.objects.size,0);}
  const invalid=fixture();await assert.rejects(invalid.service.uploadClientDocumentOnServer(invalid.org,'client','document',invalid.user.uid,'file.txt','text/plain',Buffer.from('Fixture')));assert.equal(invalid.objects.size,0);
});
