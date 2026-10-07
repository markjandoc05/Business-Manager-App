import assert from 'node:assert/strict';import {test} from 'node:test';import {repositoryFixture} from './helpers/repository-fixture.mjs';
for(const child of ['notes','documents'])test(`archived Client ${child} reach older rows beyond newest100 and preserve order`,async()=>{
 const f=repositoryFixture();for(let i=0;i<251;i++)f.records.set(`${f.prefix}/clients/client/${child}/row-${String(i).padStart(4,'0')}`,{content:'History',name:'Document',archived:i<131,createdAt:i,uploadedAt:i});
 const repo=f.load('lib/repositories/clients.ts');const read=child==='notes'?repo.listArchivedClientNotes:repo.listArchivedClientDocuments;
 const rows=await read(f.user,f.org,'client');assert.equal(rows.length,131);assert.equal(rows[0].id,'row-0130');assert.equal(rows.at(-1).id,'row-0000');assert.equal(new Set(rows.map(x=>x.id)).size,131);
 const queries=f.reads.filter(x=>typeof x!=='string');assert.equal(queries.length,3);assert.ok(queries.every(q=>q.constraints.find(c=>c.kind==='limit')?.count===100));await assert.rejects(read(f.user,'foreign-org','client'));
});
