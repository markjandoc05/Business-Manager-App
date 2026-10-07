import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serverRecordFixture} from '../helpers/server-record-fixture.mjs';
const input=(name='Same category',type='PRODUCT',status='ACTIVE')=>({name,type,status});
const fixture=role=>{const f=serverRecordFixture(role);return {...f,service:f.load('lib/server/catalog-category-service.ts')};};
const save=(f,body,key,id)=>f.service.saveCatalogCategory(f.org,f.user.uid,body,key,id);
test('actual service serializes concurrent creates, renames and mixed creates/renames; type keys are separate',async()=>{
  const f=fixture();const attempts=await Promise.allSettled([save(f,input(),'create-key-1'),save(f,input(),'create-key-2')]);assert.equal(attempts.filter(v=>v.status==='fulfilled').length,1);
  await save(f,input('Same category','SERVICE'),'service-key');
  const a=await save(f,input('Alpha'),'alpha-key');const b=await save(f,input('Beta'),'beta-key');
  const rename=await Promise.allSettled([save(f,{name:'Shared',status:'ACTIVE'},'rename-key-1',a),save(f,{name:'Shared',status:'ACTIVE'},'rename-key-2',b)]);assert.equal(rename.filter(v=>v.status==='fulfilled').length,1);
  const mixed=await Promise.allSettled([save(f,{name:'Mixed',status:'ACTIVE'},'mixed-rename',b),save(f,input('Mixed'),'mixed-create')]);assert.equal(mixed.filter(v=>v.status==='fulfilled').length,1);
});
test('legacy duplicates/inconsistent normalized fields remain readable and retain snapshots; status and unique rename allowed',async()=>{
  const f=fixture();for(const id of ['legacy-a','legacy-b'])f.records.set(`${f.prefix}/catalogCategories/${id}`,{...input(' Legacy   Name '),normalizedName:id,createdBy:'legacy',createdAt:'retained'});
  const snapshot={categoryId:'legacy-a',category:' Legacy   Name '};f.records.set(`${f.prefix}/sales/sale`,{items:[snapshot]});
  await assert.rejects(save(f,input('legacy name'),'legacy-conflict'),/already exists/);
  await save(f,{name:' Legacy Name ',status:'INACTIVE'},'legacy-disable','legacy-a');
  await save(f,{name:' Legacy Name ',status:'ACTIVE'},'legacy-enable','legacy-a');
  await save(f,{name:'Unique',status:'ACTIVE'},'legacy-rename','legacy-a');
  await assert.rejects(save(f,input('legacy name'),'remaining-conflict'),/already exists/);
  assert.equal(f.records.get(`${f.prefix}/catalogCategories/legacy-a`).createdAt,'retained');assert.equal(f.records.get(`${f.prefix}/catalogCategories/legacy-b`).name,' Legacy   Name ');assert.deepEqual(f.records.get(`${f.prefix}/sales/sale`).items,[snapshot]);
});
test('inactive names stay occupied; unique rename releases old key and replay never reverses later changes',async()=>{
  const f=fixture();const id=await save(f,input('First'),'first-key');await save(f,{name:'First',status:'INACTIVE'},'disable-key',id);
  await assert.rejects(save(f,input('First'),'occupied-key'),/inactive/);
  await save(f,{name:'Second',status:'ACTIVE'},'rename-second',id);await save(f,input('First'),'released-key');
  await save(f,{name:'Third',status:'ACTIVE'},'rename-third',id);await save(f,{name:'Second',status:'ACTIVE'},'rename-second',id);
  assert.equal(f.records.get(`${f.prefix}/catalogCategories/${id}`).name,'Third');assert.equal(await save(f,input('First'),'first-key'),id);
  await assert.rejects(save(f,input('Different'),'first-key'),/different category details/);
});
test('lost committed acknowledgement retries one category; current user/tenant/role/license remain authoritative',async()=>{
  const f=fixture();f.loseNextCommit();await assert.rejects(save(f,input(),'uncertain-key'));const id=await save(f,input(),'uncertain-key');assert.ok(f.records.has(`${f.prefix}/catalogCategories/${id}`));assert.equal([...f.records.keys()].filter(p=>p.includes('/catalogCategories/')).length,1);
  for(const change of ['USER','inactive','uid','member','license']){const blocked=fixture(change==='USER'?'USER':'ADMIN');if(change==='inactive')blocked.records.get(`users/${blocked.user.uid}`).active=false;if(change==='uid')blocked.records.get(`users/${blocked.user.uid}`).uid='other';if(change==='member')blocked.records.get(`${blocked.prefix}/members/${blocked.user.uid}`).status='inactive';if(change==='license')blocked.records.get(blocked.prefix).licenseWriteEnabled=false;await assert.rejects(save(blocked,input(),'blocked-key'));}
  await assert.rejects(f.service.saveCatalogCategory('other-org',f.user.uid,input(),'other-key'));
});
test('direct API representations cannot coerce invalid status values into stored category state',async()=>{
  const f=fixture();const id=await save(f,input('Valid'),'valid-key');
  for(const status of [['INACTIVE'],false,null,0,{toString:'ACTIVE'}]) {
    await assert.rejects(save(f,{name:'Valid',status},'invalid-update',id));
    await assert.rejects(save(f,input('Invalid','PRODUCT',status),'invalid-create'));
  }
  assert.equal(f.records.get(`${f.prefix}/catalogCategories/${id}`).status,'ACTIVE');
});
