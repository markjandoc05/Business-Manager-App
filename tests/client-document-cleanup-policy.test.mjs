import assert from 'node:assert/strict';
import {test} from 'node:test';
import {serverRecordFixture} from './helpers/server-record-fixture.mjs';
function fixture(role='ADMIN'){const f=serverRecordFixture(role);return {...f,route:f.load('app/api/organizations/[orgId]/clients/[clientId]/documents/[documentId]/route.ts')};}
const request=(f,storagePath=`${f.prefix}/clients/client/documents/document/synthetic.pdf`)=>f.route.POST({headers:new Headers(),json:async()=>({storagePath})},{params:Promise.resolve({orgId:f.org,clientId:'client',documentId:'document'})});
test('actual cleanup refuses registered, unknown, pending and unreadable registration without Storage mutation',async()=>{
  for(const state of ['registered','unknown','pending','unreadable']){const f=fixture();if(state==='registered')f.records.set(`${f.prefix}/clients/client/documents/document`,{archived:true,storagePath:'retained'});if(state==='pending')f.records.set(`${f.prefix}/clients/client/documentOperations/document`,{state:'PREPARED'});if(state==='unreadable')f.db.runTransaction=async()=>{throw new Error('Synthetic read denial');};assert.ok((await request(f)).status>=400);assert.equal(f.deleted.length,0);}
});
test('actual cleanup retains token/global user/tenant/member/client/license/path authorization boundaries',async()=>{
  for(const change of ['token','user','member','client','license','USER']){const f=fixture(change==='USER'?'USER':'ADMIN');if(change==='token')f.setAuthenticated(false);if(change==='user')f.records.get(`users/${f.user.uid}`).active=false;if(change==='member')f.records.get(`${f.prefix}/members/${f.user.uid}`).status='inactive';if(change==='client')f.records.delete(`${f.prefix}/clients/client`);if(change==='license')f.records.get(f.prefix).licenseWriteEnabled=false;assert.ok((await request(f)).status>=400);assert.equal(f.deleted.length,0);}
  const foreign=fixture();assert.ok((await request(foreign,'organizations/other/clients/client/documents/document/synthetic.pdf')).status>=400);assert.equal(foreign.deleted.length,0);
});
