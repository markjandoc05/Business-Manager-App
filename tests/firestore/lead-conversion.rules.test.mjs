import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const PROJECT_ID = 'bsm-client-app-web';
const ORGANIZATION_ID = 'rules-test-org';
const OTHER_ORGANIZATION_ID = 'rules-test-other-org';
const ADMIN_UID = 'rules-test-admin';
const USER_UID = 'rules-test-user';
const INACTIVE_UID = 'rules-test-inactive';
const OTHER_ORG_UID = 'rules-test-other-org-user';
const LEAD_ID = 'rules-test-lead';

let testEnv;

function organizationPath(organizationId = ORGANIZATION_ID) {
  return `organizations/${organizationId}`;
}

function leadPath(organizationId = ORGANIZATION_ID, leadId = LEAD_ID) {
  return `${organizationPath(organizationId)}/leads/${leadId}`;
}

function clientPath(clientId, organizationId = ORGANIZATION_ID) {
  return `${organizationPath(organizationId)}/clients/${clientId}`;
}

function timelinePath(organizationId = ORGANIZATION_ID, leadId = LEAD_ID) {
  return `${leadPath(organizationId, leadId)}/timeline/system-converted`;
}

function membershipPath(uid, organizationId = ORGANIZATION_ID) {
  return `${organizationPath(organizationId)}/members/${uid}`;
}

function adminMembership(uid = ADMIN_UID, organizationId = ORGANIZATION_ID) {
  return {
    userId: uid,
    email: `${uid}@example.com`,
    displayName: 'Rules Test Admin',
    role: 'ADMIN',
    status: 'active',
    joinedAt: Timestamp.fromMillis(1_700_000_000_000),
  };
}

function unconvertedLead(leadId = LEAD_ID, assignedToUid = ADMIN_UID) {
  const timestamp = Timestamp.fromMillis(1_700_000_000_000);
  return {
    name: 'Rules Test Lead',
    company: 'Rules Test Company',
    email: 'lead@example.com',
    phone: '555-0100',
    source: 'Website',
    status: 'Opportunity',
    assignedToUid,
    assignedToName: 'Rules Test Admin',
    createdAt: timestamp,
    createdBy: ADMIN_UID,
    updatedAt: timestamp,
    updatedBy: ADMIN_UID,
    archived: false,
    nextScheduledActivityAt: null,
    nextScheduledActivityType: null,
    nextScheduledActivityId: null,
    lastActivityAt: null,
    lastActivityType: null,
  };
}

function conversionClient(clientId) {
  const timestamp = serverTimestamp();
  return {
    name: 'Rules Test Lead',
    company: 'Rules Test Company',
    email: 'lead@example.com',
    phone: '555-0100',
    assignedToUid: ADMIN_UID,
    assignedToName: 'Rules Test Admin',
    status: 'ACTIVE',
    archived: false,
    sourceLeadId: LEAD_ID,
    createdAt: timestamp,
    createdBy: ADMIN_UID,
    updatedAt: timestamp,
    updatedBy: ADMIN_UID,
  };
}

function conversionTimeline() {
  return {
    entryType: 'SYSTEM',
    content: 'Converted to Client.',
    occurredAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    createdByUid: ADMIN_UID,
    createdByName: 'Rules Test Admin',
  };
}

async function seedBase() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const timestamp = Timestamp.fromMillis(1_700_000_000_000);
    await Promise.all([
      setDoc(doc(db, organizationPath()), { status: 'trial', slug: 'rules-test-org', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: null }),
      setDoc(doc(db, membershipPath(ADMIN_UID)), adminMembership()),
      setDoc(doc(db, membershipPath(USER_UID)), { ...adminMembership(USER_UID), role: 'USER' }),
      setDoc(doc(db, membershipPath(INACTIVE_UID)), { ...adminMembership(INACTIVE_UID), status: 'inactive' }),
      setDoc(doc(db, `organizations/${OTHER_ORGANIZATION_ID}`), { status: 'trial', slug: 'rules-test-other-org', licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: null }),
      setDoc(doc(db, membershipPath(OTHER_ORG_UID, OTHER_ORGANIZATION_ID)), adminMembership(OTHER_ORG_UID, OTHER_ORGANIZATION_ID)),
      setDoc(doc(db, leadPath()), unconvertedLead()),
      setDoc(doc(db, `organizations/${OTHER_ORGANIZATION_ID}/leads/${LEAD_ID}`), { ...unconvertedLead(LEAD_ID, OTHER_ORG_UID), createdBy: OTHER_ORG_UID, updatedBy: OTHER_ORG_UID }),
      setDoc(doc(db, `users/${ADMIN_UID}`), { uid: ADMIN_UID, role: 'ADMIN', active: true }),
      setDoc(doc(db, `users/${USER_UID}`), { uid: USER_UID, role: 'USER', active: true }),
      setDoc(doc(db, `users/${INACTIVE_UID}`), { uid: INACTIVE_UID, role: 'ADMIN', active: true }),
      setDoc(doc(db, `users/${OTHER_ORG_UID}`), { uid: OTHER_ORG_UID, role: 'ADMIN', active: true }),
    ]);
    assert.ok(timestamp);
  });
}

async function productionConversion(db, uid = ADMIN_UID, organizationId = ORGANIZATION_ID, leadId = LEAD_ID) {
  const leadRef = doc(db, leadPath(organizationId, leadId));
  const clientRef = doc(collection(db, `${organizationPath(organizationId)}/clients`));
  const timelineRef = doc(db, timelinePath(organizationId, leadId));
  const now = serverTimestamp();
  const client = conversionClient(clientRef.id);
  client.sourceLeadId = leadId;
  client.createdBy = uid;
  client.updatedBy = uid;
  const timeline = conversionTimeline();
  timeline.createdByUid = uid;

  await runTransaction(db, async (transaction) => {
    const currentLead = await transaction.get(leadRef);
    if (!currentLead.exists()) throw new Error('The lead could not be found.');
    transaction.set(clientRef, client);
    transaction.update(leadRef, {
      status: 'Client',
      convertedClientId: clientRef.id,
      updatedAt: now,
      updatedBy: uid,
    });
    transaction.set(timelineRef, timeline);
  });

  return { leadRef, clientRef, timelineRef };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedBase();
});

after(async () => {
  await testEnv.cleanup();
});

test('active ADMIN allows the exact atomic conversion transaction', async () => {
  const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
  const result = await assertSucceeds(productionConversion(db));
  assert.equal((await getDoc(result.leadRef)).data().status, 'Client');
  assert.equal((await getDoc(result.clientRef)).data().sourceLeadId, LEAD_ID);
  assert.equal((await getDoc(result.timelineRef)).data().entryType, 'SYSTEM');
});

test('each production conversion write is allowed independently for an ADMIN', async () => {
  const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
  const clientRef = doc(collection(db, `${organizationPath()}/clients`));
  const leadRef = doc(db, leadPath());
  const timelineRef = doc(db, timelinePath());
  await assertSucceeds(setDoc(clientRef, conversionClient(clientRef.id)));
  await assertSucceeds(updateDoc(leadRef, { status: 'Client', convertedClientId: clientRef.id, updatedAt: serverTimestamp(), updatedBy: ADMIN_UID }));
  await assertSucceeds(setDoc(timelineRef, conversionTimeline()));
});

test('already-converted Lead cannot be converted a second time', async () => {
  const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), clientPath('existing-client')), { ...conversionClient('existing-client'), sourceLeadId: LEAD_ID });
    await updateDoc(doc(context.firestore(), leadPath()), { status: 'Client', convertedClientId: 'existing-client' });
  });
  await assertFails(productionConversion(db));
});

test('inactive member is denied conversion', async () => {
  const db = testEnv.authenticatedContext(INACTIVE_UID).firestore();
  await assertFails(productionConversion(db));
});

test('member from another organization is denied conversion', async () => {
  const db = testEnv.authenticatedContext(OTHER_ORG_UID).firestore();
  await assertFails(productionConversion(db));
});

test('USER cannot perform the ADMIN-only conversion', async () => {
  const db = testEnv.authenticatedContext(USER_UID).firestore();
  await assertFails(productionConversion(db, USER_UID));
});

test('normal Lead update cannot set Client without a conversion ID', async () => {
  const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
  await assertFails(updateDoc(doc(db, leadPath()), { status: 'Client', updatedAt: serverTimestamp(), updatedBy: ADMIN_UID }));
});
