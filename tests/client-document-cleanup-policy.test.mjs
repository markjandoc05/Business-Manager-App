import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextResponse } from 'next/server.js';
import { Timestamp } from 'firebase-admin/firestore';
import { repositoryFixture } from './helpers/repository-fixture.mjs';
function cleanupFixture(role='ADMIN') {
  let f;let authenticated=true;let active=true;let failMetadata=false;const deleted=[];
  const ref=path=>({path,id:path.split('/').at(-1),collection:name=>({doc:id=>ref(`${path}/${name}/${id}`)}),get:async()=>{if(failMetadata&&path.includes('/documents/'))throw new Error('Synthetic metadata read failure');f.reads.push(path);const data=f.records.get(path);return {exists:data!==undefined,data:()=>data};}});
  f=repositoryFixture(role,{'next/server':{NextResponse},'firebase-admin/firestore':{Timestamp},'@/lib/server/firebase-admin':{adminDb:{doc:ref},adminStorageBucket:()=>({file:path=>({delete:async()=>deleted.push(path)})})},'@/lib/server/auth':{getAuthenticatedUser:async()=>authenticated?{uid:f.user.uid}:null,isApplicationUserActive:async()=>active}});
  f.records.set(f.prefix,{status:'active'});f.records.set(`${f.prefix}/members/${f.user.uid}`,{userId:f.user.uid,role,status:'active'});f.records.set(`${f.prefix}/clients/client`,{archived:false});
  return {...f,deleted,setAuthenticated:value=>{authenticated=value;},setActive:value=>{active=value;},failMetadata:()=>{failMetadata=true;},route:f.load('app/api/organizations/[orgId]/clients/[clientId]/documents/[documentId]/route.ts')};
}
function request(f,path=`${f.prefix}/clients/client/documents/document/synthetic.pdf`,org=f.org) {return f.route.POST({json:async()=>({storagePath:path})},{params:Promise.resolve({orgId:org,clientId:'client',documentId:'document'})});}
test('actual cleanup refuses all registered lifecycle states and uncertain metadata reads without Storage mutation',async()=>{
  for(const archived of [false,true]) {const f=cleanupFixture();f.records.set(`${f.prefix}/clients/client/documents/document`,{archived,storagePath:'some-other-path'});assert.equal((await request(f)).status,409);assert.equal(f.deleted.length,0);}
  const failed=cleanupFixture();failed.failMetadata();assert.equal((await request(failed)).status,503);assert.equal(failed.deleted.length,0);
});
test('actual cleanup retains user, tenant, member-role, Client and path boundaries and allows proven unregistered orphans',async()=>{
  for(const role of ['ADMIN','MANAGER']) {const f=cleanupFixture(role);assert.equal((await request(f)).status,200);assert.equal(f.deleted.length,1);}
  const cases=[f=>f.setAuthenticated(false),f=>f.setActive(false),f=>f.records.get(`${f.prefix}/members/${f.user.uid}`).status='inactive',f=>f.records.delete(`${f.prefix}/clients/client`)];
  for(const prepare of cases) {const f=cleanupFixture();prepare(f);assert.ok((await request(f)).status>=400);assert.equal(f.deleted.length,0);}
  const user=cleanupFixture('USER');assert.equal((await request(user)).status,403);assert.equal(user.deleted.length,0);
  const tenant=cleanupFixture();assert.equal((await request(tenant,'organizations/other-org/clients/client/documents/document/synthetic.pdf')).status,400);assert.equal(tenant.deleted.length,0);
});
