import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server.js';
import { repositoryFixture } from './repository-fixture.mjs';

// Serialized adapter exercises actual server transactions and their read/write
// invariants. It is not proof of native Firestore isolation or rules behavior.
export function serverRecordFixture(role = 'ADMIN', overrides = {}) {
  let f; let records = new Map(); let tail = Promise.resolve(); let loseCommit = false;
  const doc = path => ({ path, id: path.split('/').at(-1), collection: name => collection(`${path}/${name}`), get: async () => snapshot(path) });
  const collection = (path, filters = []) => ({ path, filters, doc: id => doc(`${path}/${id}`), where: (field, op, value) => { assert.equal(op, '=='); return collection(path, [...filters, [field, value]]); }, get: async () => querySnapshot({path,filters}) });
  const snapshot = path => ({ id: path.split('/').at(-1), ref: doc(path), exists: records.has(path), data: () => records.has(path) ? { ...records.get(path) } : undefined });
  const querySnapshot = ref => { const docs = [...records.keys()].filter(path => path.startsWith(ref.path+'/') && !path.slice(ref.path.length+1).includes('/')).map(snapshot).filter(row => ref.filters.every(([key,value]) => row.data()[key] === value)); return { docs, size: docs.length, empty: !docs.length }; };
  const db = { doc, collection, runTransaction: callback => {
    const run = async () => {
      let writing = false; const writes = [];
      const transaction = {
        get: async ref => { assert.equal(writing, false, 'Read after transaction write'); return ref.filters ? querySnapshot(ref) : snapshot(ref.path); },
        create: (ref, data) => { writing = true; writes.push(() => { assert.equal(records.has(ref.path), false); records.set(ref.path, data); }); },
        set: (ref, data, options) => { writing = true; writes.push(() => records.set(ref.path, options?.merge ? {...records.get(ref.path),...data} : data)); },
        update: (ref, data) => { writing = true; writes.push(() => { assert.ok(records.has(ref.path)); records.set(ref.path, {...records.get(ref.path),...data}); }); },
        delete: ref => { writing = true; writes.push(() => records.delete(ref.path)); },
      };
      const result = await callback(transaction); writes.forEach(write => write());
      if (loseCommit && writes.length) { loseCommit = false; throw new Error('Synthetic committed acknowledgement loss'); }
      return result;
    };
    const pending = tail.then(run, run); tail = pending.catch(() => {}); return pending;
  }};
  const objects = new Map(); const deleted = []; let generation = 0; let failSave = null; let failDelete = false;
  const bucket = { file: (path, options) => ({
    save: async (bytes, config) => { if (config?.preconditionOpts?.ifGenerationMatch === 0 && objects.has(path)) throw Object.assign(new Error('Exists'), {code:412}); if (failSave === 'before') throw new Error('Synthetic upload failure'); objects.set(path, {bytes:Buffer.from(bytes), metadata:{...config?.metadata, size:String(bytes.length),generation:String(++generation)}}); if (failSave === 'after') throw new Error('Synthetic upload acknowledgement loss'); },
    getMetadata: async () => { if (!objects.has(path)) throw Object.assign(new Error('Missing'), {code:404}); return [{...objects.get(path).metadata}]; },
    download: async () => { const object=objects.get(path); if (!object) throw Object.assign(new Error('Missing'), {code:404}); if(options?.generation && String(options.generation)!==object.metadata.generation) throw Object.assign(new Error('Changed'),{code:412}); return [Buffer.from(object.bytes)]; },
    delete: async config => { if (failDelete) throw new Error('Synthetic delete failure'); const object=objects.get(path); if(!object) throw Object.assign(new Error('Missing'),{code:404}); if(config?.ifGenerationMatch && String(config.ifGenerationMatch)!==object.metadata.generation) throw Object.assign(new Error('Changed'),{code:412}); objects.delete(path);deleted.push(path); },
  })};
  let authenticated = true;
  f = repositoryFixture(role, {'node:crypto':crypto,'firebase-admin/firestore':{Timestamp,FieldValue},'next/server':{NextResponse},'@/lib/server/firebase-admin':{adminDb:db,adminStorageBucket:()=>bucket},'@/lib/server/auth':{getAuthenticatedUser:async()=>authenticated?{uid:f.user.uid}:null,isApplicationUserActive:async()=>records.get(`users/${f.user.uid}`)?.status==='active'},...overrides});
  records=f.records; const expiry=Timestamp.fromMillis(Date.now()+86400000);
  records.set(`users/${f.user.uid}`,{uid:f.user.uid,name:f.user.name,status:'active',active:true});
  records.set(f.prefix,{status:'active',licenseStatus:'ACTIVE',licenseWriteEnabled:true,licenseExpiresAt:expiry});
  records.set(`${f.prefix}/members/${f.user.uid}`,{userId:f.user.uid,status:'active',role});
  records.set(`${f.prefix}/license/current`,{plan:'TEAM',status:'ACTIVE',maxUsers:3,subscriptionEndsAt:expiry});
  records.set(`${f.prefix}/clients/client`,{name:'Synthetic Client',status:'ACTIVE',archived:false});
  return {...f,records,db,objects,deleted,loseNextCommit:()=>{loseCommit=true;},setAuthenticated:value=>{authenticated=value;},failSave:mode=>{failSave=mode;},failDelete:()=>{failDelete=true;}};
}
