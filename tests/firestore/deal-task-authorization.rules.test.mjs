import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, where, Timestamp } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG_ID = 'authorization-org';
const OTHER_ORG_ID = 'authorization-other-org';
const ADMIN_UID = 'authorization-admin';
const MANAGER_UID = 'authorization-manager';
const USER_A_UID = 'authorization-user-a';
const USER_B_UID = 'authorization-user-b';
const DEAL_A_ID = 'deal-a';
const DEAL_B_ID = 'deal-b';
const TASK_A_ID = 'task-a';
const TASK_B_ID = 'task-b';
const LEAD_A_ID = 'lead-a';

let testEnv;

const orgPath = (id = ORG_ID) => `organizations/${id}`;
const memberPath = (uid, org = ORG_ID) => `${orgPath(org)}/members/${uid}`;
const dealPath = (id, org = ORG_ID) => `${orgPath(org)}/deals/${id}`;
const taskPath = (id, org = ORG_ID) => `${orgPath(org)}/tasks/${id}`;
const leadPath = (id, org = ORG_ID) => `${orgPath(org)}/leads/${id}`;

function membership(uid, role, status = 'active') {
  return { userId: uid, role, status, joinedAt: Timestamp.fromMillis(1_700_000_000_000) };
}

function deal(id, assignedToUid, org = ORG_ID) {
  return {
    title: id,
    clientId: `client-${org}`,
    value: 100,
    stage: 'New',
    status: 'Active',
    assignedToUid,
    assignedToName: assignedToUid,
    archived: false,
    createdBy: ADMIN_UID,
    updatedBy: ADMIN_UID,
    createdAt: Timestamp.fromMillis(1_700_000_000_000),
    updatedAt: Timestamp.fromMillis(1_700_000_000_000),
  };
}

function task(id, assignedToUid, relatedTo) {
  return {
    title: id,
    dueDate: '2026-08-24T12:00:00.000Z',
    status: 'Pending',
    priority: 'Medium',
    assignedToUid,
    assignedToName: assignedToUid,
    archived: false,
    createdBy: ADMIN_UID,
    updatedBy: ADMIN_UID,
    createdAt: Timestamp.fromMillis(1_700_000_000_000),
    updatedAt: Timestamp.fromMillis(1_700_000_000_000),
    ...(relatedTo ? { relatedTo } : {}),
  };
}

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, orgPath()), { status: 'trial', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: null }),
      setDoc(doc(db, orgPath(OTHER_ORG_ID)), { status: 'trial', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: null }),
      setDoc(doc(db, memberPath(ADMIN_UID)), membership(ADMIN_UID, 'ADMIN')),
      setDoc(doc(db, memberPath(MANAGER_UID)), membership(MANAGER_UID, 'MANAGER')),
      setDoc(doc(db, memberPath(USER_A_UID)), membership(USER_A_UID, 'USER')),
      setDoc(doc(db, memberPath(USER_B_UID)), membership(USER_B_UID, 'USER')),
      setDoc(doc(db, memberPath(USER_A_UID, OTHER_ORG_ID)), membership(USER_A_UID, 'USER')),
      setDoc(doc(db, dealPath(DEAL_A_ID)), deal(DEAL_A_ID, USER_A_UID)),
      setDoc(doc(db, dealPath(DEAL_B_ID)), deal(DEAL_B_ID, USER_B_UID)),
      setDoc(doc(db, leadPath(LEAD_A_ID)), { name: LEAD_A_ID, archived: false }),
      setDoc(doc(db, taskPath(TASK_A_ID)), task(TASK_A_ID, USER_A_UID, { type: 'Lead', id: LEAD_A_ID })),
      setDoc(doc(db, taskPath(TASK_B_ID)), task(TASK_B_ID, USER_B_UID)),
      setDoc(doc(db, dealPath(DEAL_A_ID, OTHER_ORG_ID)), deal(DEAL_A_ID, USER_A_UID, OTHER_ORG_ID)),
      setDoc(doc(db, taskPath(TASK_A_ID, OTHER_ORG_ID)), task(TASK_A_ID, USER_A_UID)),
    ]);
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed();
});

after(async () => testEnv.cleanup());

for (const [label, uid] of [['ADMIN', ADMIN_UID], ['MANAGER', MANAGER_UID]]) {
  test(`${label} can query all organization Deals and Tasks`, async () => {
    const db = testEnv.authenticatedContext(uid).firestore();
    const deals = await assertSucceeds(getDocs(query(collection(db, `${orgPath()}/deals`), where('archived', '==', false))));
    const tasks = await assertSucceeds(getDocs(query(collection(db, `${orgPath()}/tasks`), where('archived', '==', false))));
    assert.equal(deals.size, 2);
    assert.equal(tasks.size, 2);
  });
}

test('USER can query only assigned Deals and Tasks', async () => {
  const db = testEnv.authenticatedContext(USER_A_UID).firestore();
  const deals = await assertSucceeds(getDocs(query(collection(db, `${orgPath()}/deals`), where('archived', '==', false), where('assignedToUid', '==', USER_A_UID))));
  const tasks = await assertSucceeds(getDocs(query(collection(db, `${orgPath()}/tasks`), where('archived', '==', false), where('assignedToUid', '==', USER_A_UID))));
  assert.deepEqual(deals.docs.map((snapshot) => snapshot.id), [DEAL_A_ID]);
  assert.deepEqual(tasks.docs.map((snapshot) => snapshot.id), [TASK_A_ID]);
});

test('USER cannot query unassigned Deals or Tasks', async () => {
  const db = testEnv.authenticatedContext(USER_A_UID).firestore();
  await assertFails(getDocs(query(collection(db, `${orgPath()}/deals`), where('archived', '==', false))));
  await assertFails(getDocs(query(collection(db, `${orgPath()}/tasks`), where('archived', '==', false))));
});

test('USER cannot directly read another USER Deal or Task', async () => {
  const db = testEnv.authenticatedContext(USER_A_UID).firestore();
  await assertSucceeds(getDoc(doc(db, dealPath(DEAL_A_ID))));
  await assertSucceeds(getDoc(doc(db, taskPath(TASK_A_ID))));
  await assertFails(getDoc(doc(db, dealPath(DEAL_B_ID))));
  await assertFails(getDoc(doc(db, taskPath(TASK_B_ID))));
});

test('USER cannot access another organization Deal or Task', async () => {
  const db = testEnv.authenticatedContext(USER_B_UID).firestore();
  await assertFails(getDoc(doc(db, dealPath(DEAL_A_ID, OTHER_ORG_ID))));
  await assertFails(getDoc(doc(db, taskPath(TASK_A_ID, OTHER_ORG_ID))));
});

test('Lead Details task query is scoped by Lead and assigned user', async () => {
  const adminDb = testEnv.authenticatedContext(ADMIN_UID).firestore();
  const adminTasks = await assertSucceeds(getDocs(query(
    collection(adminDb, `${orgPath()}/tasks`),
    where('relatedTo.id', '==', LEAD_A_ID),
  )));
  assert.deepEqual(adminTasks.docs.map((snapshot) => snapshot.id), [TASK_A_ID]);

  const userDb = testEnv.authenticatedContext(USER_A_UID).firestore();
  const userTasks = await assertSucceeds(getDocs(query(
    collection(userDb, `${orgPath()}/tasks`),
    where('relatedTo.id', '==', LEAD_A_ID),
    where('assignedToUid', '==', USER_A_UID),
  )));
  assert.deepEqual(userTasks.docs.map((snapshot) => snapshot.id), [TASK_A_ID]);

  await assertFails(getDocs(query(
    collection(userDb, `${orgPath()}/tasks`),
    where('relatedTo.id', '==', LEAD_A_ID),
  )));
});
