import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG = 'task-workflow-org';
const ORG_B = 'task-workflow-org-b';
const ADMIN = 'task-admin';
const MANAGER = 'task-manager';
const USER = 'task-user';
const OTHER_USER = 'task-other-user';
const now = Timestamp.fromMillis(1_700_000_000_000);
const licenseExpiry = Timestamp.fromMillis(Date.now() + 86_400_000);
let testEnv;

const member = (userId, role) => ({ userId, role, status: 'active' });
const organization = { status: 'active', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: licenseExpiry };
const client = { name: 'Client A', status: 'ACTIVE', archived: false, createdAt: now, createdBy: ADMIN, updatedAt: now, updatedBy: ADMIN };
const deal = { title: 'Deal A', clientId: 'client-a', leadId: null, value: 100, stage: 'New', status: 'Active', expectedCloseDate: '', assignedToUid: ADMIN, assignedToName: 'Admin', archived: false, createdAt: now, createdBy: ADMIN, updatedAt: now, updatedBy: ADMIN, wonAt: null, lostAt: null, lossReason: null };
const orgBClient = { ...client, name: 'Client B', createdBy: 'org-b-admin', updatedBy: 'org-b-admin' };
const orgBDeal = { ...deal, title: 'Deal B', clientId: 'client-b', createdBy: 'org-b-admin', updatedBy: 'org-b-admin' };
const appUser = (uid, role = 'USER') => ({ uid, status: 'active', active: true, role });

function taskData(taskId, assignedToUid = ADMIN, assignedToName = 'Admin', relatedTo = { type: 'Deal', id: 'deal-a' }) {
  return {
    title: `Task ${taskId}`, description: '', type: 'Follow-up', dueDate: '2026-08-30T09:00:00.000Z', status: 'Pending', priority: 'Medium', relatedTo,
    assignedToUid, assignedToName, createdAt: serverTimestamp(), createdBy: assignedToUid, updatedAt: serverTimestamp(), updatedBy: assignedToUid, archived: false,
  };
}

function activityData(taskId, uid, metadata = { clientId: 'client-a', dealId: 'deal-a' }) {
  return { type: 'task_creation', description: `Task created: Task ${taskId}`, entityType: 'Task', entityId: taskId, metadata, createdAt: serverTimestamp(), createdBy: uid };
}

async function commitTaskMutation(db, taskId, uid, update, type, metadata = { clientId: 'client-a', dealId: 'deal-a' }, activityId = type) {
  const batch = writeBatch(db);
  batch.update(doc(db, `organizations/${ORG}/tasks/${taskId}`), { ...update, updatedAt: serverTimestamp(), updatedBy: uid });
  batch.set(doc(db, `organizations/${ORG}/activities/${taskId}-${activityId}`), { type, description: type, entityType: 'Task', entityId: taskId, metadata, createdAt: serverTimestamp(), createdBy: uid });
  await batch.commit();
}

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, `users/${ADMIN}`), appUser(ADMIN, 'ADMIN')),
      setDoc(doc(db, `users/${MANAGER}`), appUser(MANAGER, 'MANAGER')),
      setDoc(doc(db, `users/${USER}`), appUser(USER)),
      setDoc(doc(db, `users/${OTHER_USER}`), appUser(OTHER_USER)),
      setDoc(doc(db, `organizations/${ORG}`), organization),
      setDoc(doc(db, `organizations/${ORG}/members/${ADMIN}`), member(ADMIN, 'ADMIN')),
      setDoc(doc(db, `organizations/${ORG}/members/${MANAGER}`), member(MANAGER, 'MANAGER')),
      setDoc(doc(db, `organizations/${ORG}/members/${USER}`), member(USER, 'USER')),
      setDoc(doc(db, `organizations/${ORG}/members/${OTHER_USER}`), member(OTHER_USER, 'USER')),
      setDoc(doc(db, `organizations/${ORG}/clients/client-a`), client),
      setDoc(doc(db, `organizations/${ORG}/deals/deal-a`), deal),
      setDoc(doc(db, `organizations/${ORG}/license/current`), { status: 'ACTIVE', subscriptionStartedAt: now, subscriptionEndsAt: licenseExpiry }),
      setDoc(doc(db, `organizations/${ORG_B}`), organization),
      setDoc(doc(db, `organizations/${ORG_B}/clients/client-b`), orgBClient),
      setDoc(doc(db, `organizations/${ORG_B}/deals/deal-b`), orgBDeal),
    ]);
  });
}

before(async () => { testEnv = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } }); });
beforeEach(async () => { await testEnv.clearFirestore(); await seed(); });
after(async () => testEnv.cleanup());

test('ADMIN atomic Deal-linked Task creation succeeds with its Activity', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const taskRef = doc(db, `organizations/${ORG}/tasks/task-admin`);
  const batch = writeBatch(db);
  batch.set(taskRef, taskData('task-admin'));
  batch.set(doc(db, `organizations/${ORG}/activities/activity-admin`), activityData('task-admin', ADMIN));
  await assertSucceeds(batch.commit());
  if (!(await getDoc(taskRef)).exists()) throw new Error('Task was not persisted.');
});

test('MANAGER atomic Client-linked Task creation succeeds with its Activity', async () => {
  const db = testEnv.authenticatedContext(MANAGER).firestore();
  const taskRef = doc(db, `organizations/${ORG}/tasks/task-manager`);
  const batch = writeBatch(db);
  batch.set(taskRef, taskData('task-manager', MANAGER, 'Manager', { type: 'Client', id: 'client-a' }));
  batch.set(doc(db, `organizations/${ORG}/activities/activity-manager`), activityData('task-manager', MANAGER, { clientId: 'client-a' }));
  await assertSucceeds(batch.commit());
});

test('USER can create a self-assigned Task but cannot assign it to another USER', async () => {
  const db = testEnv.authenticatedContext(USER).firestore();
  const selfAssigned = writeBatch(db);
  selfAssigned.set(doc(db, `organizations/${ORG}/tasks/task-user`), taskData('task-user', USER, 'User'));
  selfAssigned.set(doc(db, `organizations/${ORG}/activities/activity-user`), activityData('task-user', USER));
  await assertSucceeds(selfAssigned.commit());

  const otherAssignment = writeBatch(db);
  otherAssignment.set(doc(db, `organizations/${ORG}/tasks/task-other`), taskData('task-other', OTHER_USER, 'Other'));
  otherAssignment.set(doc(db, `organizations/${ORG}/activities/activity-other`), activityData('task-other', USER));
  await assertFails(otherAssignment.commit());
});

test('Task creation cannot reference another organization Deal', async () => {
  const db = testEnv.authenticatedContext(ADMIN).firestore();
  const taskRef = doc(db, `organizations/${ORG}/tasks/task-cross-org`);
  const batch = writeBatch(db);
  batch.set(taskRef, taskData('task-cross-org', ADMIN, 'Admin', { type: 'Deal', id: 'deal-b' }));
  batch.set(doc(db, `organizations/${ORG}/activities/activity-cross-org`), activityData('task-cross-org', ADMIN));
  await assertFails(batch.commit());
});

test('MANAGER Task workflow is atomic from edit through restore, then delete remains allowed', async () => {
  const db = testEnv.authenticatedContext(MANAGER).firestore();
  const taskId = 'task-lifecycle';
  const create = writeBatch(db);
  create.set(doc(db, `organizations/${ORG}/tasks/${taskId}`), taskData(taskId, MANAGER, 'Manager', { type: 'Client', id: 'client-a' }));
  create.set(doc(db, `organizations/${ORG}/activities/${taskId}-task_creation`), activityData(taskId, MANAGER, { clientId: 'client-a' }));
  await assertSucceeds(create.commit());
  await assertSucceeds(commitTaskMutation(db, taskId, MANAGER, { title: 'Edited task', description: 'Updated', priority: 'High' }, 'task_update', { clientId: 'client-a' }));
  await assertSucceeds(commitTaskMutation(db, taskId, MANAGER, { status: 'Completed' }, 'task_completion', { clientId: 'client-a' }));
  await assertSucceeds(commitTaskMutation(db, taskId, MANAGER, { status: 'Pending' }, 'task_reopened', { clientId: 'client-a' }));
  await assertSucceeds(commitTaskMutation(db, taskId, MANAGER, { archived: true, archivedAt: serverTimestamp(), archivedBy: MANAGER }, 'task_archive', { clientId: 'client-a' }));
  await assertSucceeds(commitTaskMutation(db, taskId, MANAGER, { archived: false, archivedAt: null, archivedBy: null }, 'task_restore', { clientId: 'client-a' }));
  const activities = await getDocs(collection(db, `organizations/${ORG}/activities`));
  if (activities.size !== 6) throw new Error(`Expected 6 Task activities, received ${activities.size}.`);
  await assertSucceeds(commitTaskMutation(db, taskId, MANAGER, { archived: true, archivedAt: serverTimestamp(), archivedBy: MANAGER }, 'task_archive', { clientId: 'client-a' }, 'task_archive-final'));
  const deleteBatch = writeBatch(db);
  deleteBatch.delete(doc(db, `organizations/${ORG}/tasks/${taskId}`));
  await assertSucceeds(deleteBatch.commit());
});
