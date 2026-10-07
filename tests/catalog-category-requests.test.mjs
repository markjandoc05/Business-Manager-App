import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serverRecordFixture} from './helpers/server-record-fixture.mjs';
test('actual category repository retries uncertain same-details requests with one key through real route/service',async()=>{
  let f;const keys=[];
  f=serverRecordFixture('ADMIN',{'@/lib/repositories/authenticatedRequest':{authenticatedFetch:async(url,init)=>{keys.push(init.headers['Idempotency-Key']);return f.load('lib/server/catalog-category-route.ts').handleCatalogCategoryRequest({headers:new Headers(init.headers),json:async()=>JSON.parse(init.body)},f.org,url.endsWith('/categories')?undefined:url.split('/').at(-1));}}});
  const repo=f.load('lib/repositories/catalogCategories.ts');const input={name:'Synthetic category',type:'PRODUCT'};
  f.loseNextCommit();await assert.rejects(repo.createCatalogCategory(f.user,f.org,input),/could not be confirmed/);
  const created=await repo.createCatalogCategory(f.user,f.org,input);assert.equal(keys[0],keys[1]);assert.equal(created.name,input.name);assert.equal([...f.records.keys()].filter(p=>p.includes('/catalogCategories/')).length,1);
  f.loseNextCommit();await assert.rejects(repo.updateCatalogCategory(f.user,f.org,created.id,{name:'Renamed',status:'INACTIVE'}));
  await repo.updateCatalogCategory(f.user,f.org,created.id,{name:'Renamed',status:'INACTIVE'});assert.equal(keys[2],keys[3]);assert.equal(f.records.get(`${f.prefix}/catalogCategories/${created.id}`).status,'INACTIVE');
});
test('actual category list flags canonical legacy conflicts without mutating retained records',async()=>{
  const f=serverRecordFixture();const before=[];
  for(const id of ['one','two']){const row={name:id==='one'?' Same ':'same',normalizedName:id,type:'PRODUCT',status:'ACTIVE',createdAt:'old'};f.records.set(`${f.prefix}/catalogCategories/${id}`,row);before.push(row);}
  const rows=await f.load('lib/repositories/catalogCategories.ts').listCatalogCategories(f.user,f.org);assert.equal(rows.length,2);assert.ok(rows.every(row=>row.nameConflict));assert.deepEqual([...f.records].filter(([p])=>p.includes('/catalogCategories/')).map(([,v])=>v),before);
});
