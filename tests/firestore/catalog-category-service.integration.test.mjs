import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {after, before, test} from 'node:test';
import {getApps, initializeApp} from 'firebase-admin/app';
import {getFirestore, Timestamp} from 'firebase-admin/firestore';

const projectId='demo-bsm-client-app';
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw new Error('Loopback Firestore emulator required.');
if(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID && process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!==projectId)throw new Error('Demo project required.');
const app=getApps()[0]||initializeApp({projectId});if(app.options.projectId!==projectId)throw new Error('Demo project required.');
const db=getFirestore(app);const org=`category-${randomUUID()}`;const uid=`actor-${randomUUID()}`;let service;
before(async()=>{
  const expiry=Timestamp.fromMillis(Date.now()+86400000);
  await Promise.all([db.doc(`users/${uid}`).set({uid,status:'active',active:true}),db.doc(`organizations/${org}`).set({status:'active',licenseStatus:'ACTIVE',licenseWriteEnabled:true,licenseExpiresAt:expiry}),db.doc(`organizations/${org}/members/${uid}`).set({userId:uid,status:'active',role:'ADMIN'})]);
  service=await import('../../lib/server/catalog-category-service.ts');
});
after(async()=>{await db.recursiveDelete(db.doc(`organizations/${org}`));await db.doc(`users/${uid}`).delete();});
test('native transactions serialize competing creates/renames and immutable replay never reverts a later rename',async()=>{
  const create=(name,key)=>service.saveCatalogCategory(org,uid,{name,type:'PRODUCT',status:'ACTIVE'},key);
  const competing=await Promise.allSettled([create('Same','native-create-one'),create('Same','native-create-two')]);assert.equal(competing.filter(v=>v.status==='fulfilled').length,1);
  const a=await create('A','native-create-a');const b=await create('B','native-create-b');
  const rename=(id,name,key)=>service.saveCatalogCategory(org,uid,{name,status:'ACTIVE'},key,id);
  const renames=await Promise.allSettled([rename(a,'Shared','native-rename-a'),rename(b,'Shared','native-rename-b')]);assert.equal(renames.filter(v=>v.status==='fulfilled').length,1);
  await rename(a,'Second','native-second');await rename(a,'Third','native-third');await rename(a,'Second','native-second');assert.equal((await db.doc(`organizations/${org}/catalogCategories/${a}`).get()).data().name,'Third');
});
