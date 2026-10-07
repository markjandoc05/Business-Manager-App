import assert from 'node:assert/strict';
import {test} from 'node:test';
import {repositoryFixture} from './helpers/repository-fixture.mjs';

test('legacy linked-Sale discovery reaches ACTIVE beyond25 VOIDED records',async()=>{
 const f=repositoryFixture();
 for(let i=0;i<81;i++)f.records.set(`${f.prefix}/sales/a-${String(i).padStart(3,'0')}`,{dealId:'deal',status:'VOIDED'});
 f.records.set(`${f.prefix}/sales/z-active`,{dealId:'deal',status:'ACTIVE',total:20});
 f.records.set(`${f.prefix}/sales/foreign`,{dealId:'other-deal',status:'ACTIVE'});
 const found=await f.load('lib/repositories/sales.ts').getActiveSaleForDeal(f.user,f.org,'deal');
 assert.equal(found.id,'z-active');assert.equal(found.total,20);
 const queries=f.reads.filter(x=>typeof x!=='string');assert.equal(queries.length,1);assert.ok(queries.every(q=>q.constraints.find(x=>x.kind==='limit')?.count===1));
 assert.ok(queries[0].constraints.some(c=>c.kind==='where'&&c.name==='status'&&c.value==='ACTIVE'));
 await assert.rejects(f.load('lib/repositories/sales.ts').getActiveSaleForDeal(f.user,'other-org','deal'));
});

test('legacy linked-Sale discovery exhausts VOIDED/missing-status history without changing its meaning',async()=>{
 const f=repositoryFixture();
 for(let i=0;i<80;i++)f.records.set(`${f.prefix}/sales/a-${i}`,{dealId:'deal',status:'VOIDED'});
 f.records.set(`${f.prefix}/sales/missing-status`,{dealId:'deal',total:99});
 assert.equal(await f.load('lib/repositories/sales.ts').getActiveSaleForDeal(f.user,f.org,'deal'),null);
 assert.equal(f.reads.filter(x=>typeof x!=='string').length,1);
});

test('canonical linked-Sale lock remains the fast path',async()=>{
 const f=repositoryFixture();f.records.set(`${f.prefix}/dealSaleLocks/deal`,{status:'ACTIVE',saleId:'canonical'});f.records.set(`${f.prefix}/sales/canonical`,{status:'ACTIVE',dealId:'deal'});
 assert.equal((await f.load('lib/repositories/sales.ts').getActiveSaleForDeal(f.user,f.org,'deal')).id,'canonical');
 assert.equal(f.reads.filter(x=>typeof x!=='string').length,0);
});
