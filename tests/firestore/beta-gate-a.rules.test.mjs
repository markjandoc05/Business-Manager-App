import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'bsm-client-app-web';
const ORG_A = 'gate-a-org-a';
const ORG_B = 'gate-a-org-b';
const ADMIN = 'gate-a-admin';
const USER_A = 'gate-a-user-a';
const USER_B = 'gate-a-user-b';
let testEnv;

const now = Timestamp.fromMillis(1_700_000_000_000);
const organization = { status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: null };
const member = (userId, role) => ({ userId, role, status: 'active' });
const client = (uid = ADMIN) => ({ name: 'Client', status: 'ACTIVE', archived: false, assignedToUid: uid, assignedToName: uid, createdAt: now, createdBy: uid, updatedAt: now, updatedBy: uid });
const deal = () => ({ title: 'Deal', clientId: 'client-a', leadId: null, value: 100, stage: 'New', status: 'Active', expectedCloseDate: '', assignedToUid: ADMIN, assignedToName: 'Admin', archived: false, createdAt: now, createdBy: ADMIN, updatedAt: now, updatedBy: ADMIN, wonAt: null, lostAt: null, lossReason: null });
const task = () => ({ title: 'Task', description: '', type: 'Task', dueDate: '2026-08-30T09:00:00.000Z', status: 'Pending', priority: 'Medium', assignedToUid: USER_A, assignedToName: 'User A', createdAt: now, createdBy: ADMIN, updatedAt: now, updatedBy: ADMIN, archived: false });

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, `organizations/${ORG_A}`), organization),
      setDoc(doc(db, `organizations/${ORG_B}`), organization),
      setDoc(doc(db, `organizations/${ORG_A}/members/${ADMIN}`), member(ADMIN, 'ADMIN')),
      setDoc(doc(db, `organizations/${ORG_A}/members/${USER_A}`), member(USER_A, 'USER')),
      setDoc(doc(db, `organizations/${ORG_B}/members/${USER_B}`), member(USER_B, 'USER')),
      setDoc(doc(db, `organizations/${ORG_A}/clients/client-a`), client()),
      setDoc(doc(db, `organizations/${ORG_B}/clients/client-b`), client(USER_B)),
      setDoc(doc(db, `organizations/${ORG_A}/leads/lead-a`), { name: 'Lead A', status: 'New', assignedToUid: USER_A, assignedToName: 'User A', archived: false, createdAt: now, createdBy: ADMIN, updatedAt: now, updatedBy: ADMIN }),
      setDoc(doc(db, `organizations/${ORG_B}/leads/lead-b`), { name: 'Lead B', status: 'New', assignedToUid: USER_B, assignedToName: 'User B', archived: false, createdAt: now, createdBy: USER_B, updatedAt: now, updatedBy: USER_B }),
      setDoc(doc(db, `organizations/${ORG_A}/deals/deal-a`), deal()),
      setDoc(doc(db, `organizations/${ORG_B}/deals/deal-b`), { ...deal(), clientId: 'client-b', assignedToUid: USER_B, assignedToName: 'User B', createdBy: USER_B, updatedBy: USER_B }),
      setDoc(doc(db, `organizations/${ORG_A}/tasks/task-a`), task()),
      setDoc(doc(db, `organizations/${ORG_B}/tasks/task-b`), { ...task(), assignedToUid: USER_B, assignedToName: 'User B', createdBy: USER_B, updatedBy: USER_B }),
      setDoc(doc(db, `organizations/${ORG_A}/settings/settings`), { businessName: 'A' }),
      setDoc(doc(db, `organizations/${ORG_B}/settings/settings`), { businessName: 'B' }),
    ]);
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
});
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => testEnv.cleanup());

test('legacy root business data is denied to authenticated organization users', async () => {
  const db = testEnv.authenticatedContext(USER_A).firestore();
  await assertFails(getDoc(doc(db, 'leads/legacy-lead')));
  await assertFails(setDoc(doc(db, 'clients/legacy-client'), { name: 'Legacy' }));
  await assertFails(getDoc(doc(db, 'deals/legacy-deal')));
  await assertFails(getDoc(doc(db, 'tasks/legacy-task')));
  await assertFails(getDoc(doc(db, 'activities/legacy-activity')));
  await assertFails(getDoc(doc(db, 'system/settings')));
});

test('an organization user cannot read another tenant data', async () => {
  const db = testEnv.authenticatedContext(USER_A).firestore();
  await assertFails(getDoc(doc(db, `organizations/${ORG_B}/leads/lead-b`)));
  await assertFails(getDoc(doc(db, `organizations/${ORG_B}/clients/client-b`)));
  await assertFails(getDoc(doc(db, `organizations/${ORG_B}/deals/deal-b`)));
  await assertFails(getDoc(doc(db, `organizations/${ORG_B}/tasks/task-b`)));
  await assertFails(getDoc(doc(db, `organizations/${ORG_B}/activities/activity-b`)));
  await assertFails(getDoc(doc(db, `organizations/${ORG_B}/settings/settings`)));
});

test('USER cannot fabricate a system activity or impersonate another actor', async () => {
  const db = testEnv.authenticatedContext(USER_A).firestore();
  await assertFails(setDoc(doc(db, `organizations/${ORG_A}/activities/fake-system`), {
    type: 'deal_won', description: 'Deal won.', entityType: 'Deal', entityId: 'deal-a', createdAt: now, createdBy: USER_A,
  }));
  await assertFails(setDoc(doc(db, `organizations/${ORG_A}/activities/fake-author`), {
    type: 'task_completion', description: 'Task completed.', entityType: 'Task', entityId: 'task-a', createdAt: now, createdBy: ADMIN,
  }));
});

test('matching atomic Deal transition and system activity is allowed', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, `organizations/${ORG_A}/deals/deal-a`), { stage: 'Won', status: 'Won', wonAt: serverTimestamp(), lostAt: null, lossReason: null, updatedAt: serverTimestamp(), updatedBy: ADMIN });
  batch.set(doc(db, `organizations/${ORG_A}/activities/deal-won`), {
    type: 'deal_won', description: 'Deal won.', entityType: 'Deal', entityId: 'deal-a', createdAt: serverTimestamp(), createdBy: ADMIN,
  });
  await assertSucceeds(batch.commit());
});

test('normal settings creation requires a writable license while onboarding remains separately tested', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(doc(context.firestore(), `organizations/${ORG_A}/settings/settings`));
  });
  await assertSucceeds(setDoc(doc(db, `organizations/${ORG_A}/settings/settings`), { businessName: 'Allowed' }));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `organizations/${ORG_A}`), { ...organization, licenseStatus: 'EXPIRED', licenseWriteEnabled: false });
    await deleteDoc(doc(context.firestore(), `organizations/${ORG_A}/settings/settings`));
  });
  await assertFails(setDoc(doc(db, `organizations/${ORG_A}/settings/settings`), { businessName: 'Blocked' }));
});
