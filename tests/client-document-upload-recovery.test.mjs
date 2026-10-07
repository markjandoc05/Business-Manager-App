import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repositoryFixture } from './helpers/repository-fixture.mjs';
function uploadFixture(mode) {
  let f; const objects = new Set(); const cleanups = []; let reads=0; let writes=0;
  f=repositoryFixture('ADMIN', {
    'firebase/storage': {
      ref: (_storage,path) => ({path}),
      uploadBytes: async ref => {if(mode==='upload-before')throw new Error('Synthetic failure before object creation');objects.add(ref.path);if(mode==='upload-ack')throw new Error('Synthetic upload acknowledgment loss');},
      getDownloadURL: async () => {if(mode==='url')throw new Error('Synthetic URL failure');return 'https://files.example.test/synthetic.pdf';},
    },
    '@/lib/repositories/authenticatedRequest': {authenticatedFetch: async (...args)=>{cleanups.push(args);return new Response('{}');}},
  });
  Object.assign(f.firestore, {
    setDoc: async (ref,data) => {writes++;if(mode!=='missing'&&mode!=='denied')f.records.set(ref.path,mode==='mismatch'?{...data,storagePath:'other/path'}:data);if(mode!=='success')throw new Error('Synthetic metadata acknowledgment loss');},
    getDocFromServer: async ref => {reads++;if(mode==='denied')throw new Error('Synthetic read denied');return f.firestore.getDoc(ref);},
  });
  f.records.set(`${f.prefix}/clients/client`,{name:'Fixture Client',archived:false});
  return {...f,objects,cleanups,reads:()=>reads,writes:()=>writes,repository:f.load('lib/repositories/clients.ts')};
}
const file={name:'synthetic.pdf',type:'application/pdf',size:128};
test('actual upload reconciles a committed matching metadata write after its acknowledgment is lost', async()=>{
  for(const mode of ['success','committed']) {
    const f=uploadFixture(mode);const result=await f.repository.uploadClientDocument(f.user,f.org,'client',file);
    assert.equal(result.name,file.name);assert.equal(result.size,file.size);assert.equal(result.uploadedByUid,f.user.uid);
    assert.equal(f.objects.has(result.storagePath),true);assert.equal(f.cleanups.length,0);assert.equal(f.writes(),1);assert.equal(f.reads(),mode==='committed'?1:0);
  }
});
for(const mode of ['missing','denied','mismatch','url','upload-ack','upload-before']) test(`actual ${mode} uncertainty preserves any uploaded file without automatic destructive cleanup`,async()=>{
  const f=uploadFixture(mode);
  await assert.rejects(f.repository.uploadClientDocument(f.user,f.org,'client',file),/could not be confirmed.*preserved for recovery/);
  assert.equal(f.objects.size,mode==='upload-before'?0:1);assert.equal(f.cleanups.length,0);
  assert.equal(f.writes(),['url','upload-ack','upload-before'].includes(mode)?0:1);
});
