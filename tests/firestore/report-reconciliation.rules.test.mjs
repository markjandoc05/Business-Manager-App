import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as sdk from 'firebase/firestore';
import { repositoryFixture } from '../helpers/repository-fixture.mjs';
import { financialReportRecords } from '../helpers/report-fixture.mjs';
import { workspaceReportRange } from '../../lib/workspace-calendar.ts';
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw new Error('Report tests require a loopback Firestore emulator.');
let environment; const org='fixture-org'; const uid='fixture-user';
before(async () => { environment=await initializeTestEnvironment({projectId:'demo-bsm-client-app',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}}); });
beforeEach(async () => { await environment.clearFirestore(); await environment.withSecurityRulesDisabled(async context => {
  const db=context.firestore(); const expiry=sdk.Timestamp.fromMillis(Date.now()+86400000);
  await db.doc(`users/${uid}`).set({uid,status:'active',active:true});
  await db.doc(`organizations/${org}`).set({status:'active',licenseStatus:'ACTIVE',licenseWriteEnabled:true,licenseExpiresAt:expiry});
  await db.doc(`organizations/${org}/members/${uid}`).set({userId:uid,role:'ADMIN',status:'active'});
  for(const [path,value] of financialReportRecords(uid)) await db.doc(`organizations/${org}/${path}`).set(value);
}); });
after(async () => { await environment?.cleanup(); });
for(const role of ['ADMIN','MANAGER','USER']) test(`native ${role} report/dashboard aggregates retain old open Deals and exact Sale-date cohorts`, async () => {
  await environment.withSecurityRulesDisabled(context => context.firestore().doc(`organizations/${org}/members/${uid}`).update({role}));
  const db=environment.authenticatedContext(uid).firestore(); const f=repositoryFixture(role,{'firebase/firestore':sdk,'@/lib/firebase/client':{db}});
  const reports=f.load('lib/repositories/reports.ts'); const dashboard=f.load('lib/repositories/dashboard.ts');
  for(const zone of ['America/New_York','Asia/Manila']) {
    const range=workspaceReportRange('LastMonth',new Date('2026-04-15T12:00:00Z'),zone);
    const data=await reports.loadReportData(f.user,org,range.start,range.end,['New','Qualified','Won','Lost'],['Website'],zone);
    assert.equal(data.pipelineValue,role==='USER'?300:1000);assert.equal(data.pipelineByStage.New,300);
    assert.equal(data.totalSales,201);assert.equal(data.amountPaid,151);assert.equal(data.outstanding,50);
    const metrics=await dashboard.loadDashboardMetrics(f.user,org,['sales.total','sales.collected','deals.open'],range,zone);
    assert.equal(metrics.values['sales.total'],201);assert.equal(metrics.values['sales.collected'],151);assert.equal(metrics.values['deals.open'],role==='USER'?1:2);assert.equal(metrics.failedKpis.length,0);
  }
});
test('native reporting denies another tenant and an inactive global user', async () => {
  const db=environment.authenticatedContext(uid).firestore();
  await assert.rejects(sdk.getAggregateFromServer(sdk.query(sdk.collection(db,'organizations/other-org/sales'),sdk.where('status','==','ACTIVE')),{count:sdk.count()}));
  await environment.withSecurityRulesDisabled(context => context.firestore().doc(`users/${uid}`).update({status:'inactive',active:false}));
  const f=repositoryFixture('ADMIN',{'firebase/firestore':sdk,'@/lib/firebase/client':{db}});const reports=f.load('lib/repositories/reports.ts');
  const range=workspaceReportRange('LastMonth',new Date('2026-04-15T12:00:00Z'),'Asia/Manila');
  await assert.rejects(reports.loadReportData(f.user,org,range.start,range.end,['New','Qualified','Won','Lost'],[],range.timeZone));
});
