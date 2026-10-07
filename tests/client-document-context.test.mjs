import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function fixture() {
  const source=fs.readFileSync('context/AppContext.tsx','utf8');const start=source.indexOf('  const uploadDocument = async');const block=source.slice(start,source.indexOf('\n  const archiveClientDocument',start));
  const compiled=ts.transpileModule(`export ${block.trim()}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  let release;const fixtureModule={exports:{}};const state={module:fixtureModule,exports:fixtureModule.exports,user:{uid:'actor'},currentOrganizationId:'org',currentOrganizationRef:{current:'org'},clientDocumentsRequestRef:{current:2},documents:[{id:'existing',clientId:'client'}],organization:null,client:null,archivedLoads:[],requireWritableLicense:()=>{},uploadClientDocument:()=>new Promise(resolve=>{release=resolve;}),setClientDocuments:fn=>{state.documents=fn(state.documents);},setClientDocumentsOrganizationId:value=>{state.organization=value;},setClientDocumentsClientId:value=>{state.client=value;},loadArchivedClientDocuments:async id=>{state.archivedLoads.push(id);}};
  vm.runInNewContext(compiled,state);return{state,upload:()=>fixtureModule.exports.uploadDocument('client',{}),finish:result=>release(result)};
}
test('actual Context upload applies one confirmed row, retains archived replay and ignores changed tenant or Client request',async()=>{
  const f=fixture();const pending=f.upload();f.finish({id:'existing',clientId:'client',name:'Recovered'});await pending;assert.equal(f.state.documents.length,1);assert.equal(f.state.client,'client');
  const archived=fixture();const a=archived.upload();archived.finish({id:'old',clientId:'client',archived:true});await a;assert.equal(archived.state.documents.length,1);assert.deepEqual(archived.state.archivedLoads,['client']);
  for(const changed of ['org','client']){const stale=fixture();const p=stale.upload();if(changed==='org')stale.state.currentOrganizationRef.current='other';else stale.state.clientDocumentsRequestRef.current++;stale.finish({id:'late',clientId:'client'});await p;assert.equal(stale.state.documents.length,1);assert.equal(stale.state.organization,null);}
});
