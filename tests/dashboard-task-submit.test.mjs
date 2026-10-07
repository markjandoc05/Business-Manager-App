import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import {repositoryFixture} from './helpers/repository-fixture.mjs';
import {userFacingErrorMessage} from '../lib/repositories/pagination.ts';
function submitFixture(write) {
  const baseline=process.env.VENTALE_REPOSITORY_BASELINE;
  const source=baseline?execFileSync('git',['show',`${baseline}:app/page.tsx`],{encoding:'utf8'}):fs.readFileSync('app/page.tsx','utf8');
  const block=source.slice(source.indexOf('  const handleCreateTask ='),source.indexOf('\n  return (',source.indexOf('  const handleCreateTask =')));
  const compiled=ts.transpileModule(`export ${block.trim()}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const fixtureModule={exports:{}};const state={module:fixtureModule,exports:fixtureModule.exports,taskForm:{title:'Synthetic follow-up',description:'Fixture',dueDate:'2026-10-07T09:00',priority:'Medium'},taskSaving:false,saving:false,taskSaveRef:{current:false},canManageTasksAction:true,addTask:write,userFacingErrorMessage,Date,closed:false,error:null,setTaskSaving:value=>{state.saving=value;},setTaskError:value=>{state.error=value;},setTaskForm:value=>{state.taskForm=value;},setActiveModal:value=>{state.closed=value===null;}};
  vm.runInNewContext(compiled,state);return{state,submit:()=>fixtureModule.exports.handleCreateTask({preventDefault(){}})};
}
test('actual Dashboard Task submission awaits real repository persistence and blocks a second in-flight click',async()=>{
  const f=repositoryFixture();const repository=f.load('lib/repositories/tasks.ts');let release;let calls=0;
  const fixture=submitFixture(async input=>{calls++;await new Promise(resolve=>{release=resolve;});return repository.createTask(f.user,f.org,input);});
  const pending=fixture.submit();
  try {
    assert.equal(fixture.state.closed,false);assert.equal(fixture.state.saving,true);
    await fixture.submit();assert.equal(calls,1);
  } finally {release?.();await pending;}
  const task=[...f.records].find(([path])=>path.startsWith(`${f.prefix}/tasks/`));
  assert.ok(task);assert.ok(task[1].dueDate.endsWith('Z'));assert.equal(task[1].title,'Synthetic follow-up');assert.equal(fixture.state.closed,true);assert.equal(fixture.state.saving,false);
});
test('actual Dashboard Task submission keeps failed input open, exposes error and respects write permission',async()=>{
  const fixture=submitFixture(async()=>{throw new Error('Synthetic write denial');});const original=fixture.state.taskForm;
  await fixture.submit();assert.equal(fixture.state.closed,false);assert.equal(fixture.state.taskForm,original);assert.ok(fixture.state.error);assert.equal(fixture.state.saving,false);
  let calls=0;const denied=submitFixture(async()=>{calls++;});denied.state.canManageTasksAction=false;await denied.submit();assert.equal(calls,0);assert.equal(denied.state.closed,false);
});
