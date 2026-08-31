import fs from 'node:fs';
import { after, before, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, query, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORG_A = 'console-org-a';
const ORG_B = 'console-org-b';
const SUPER_ADMIN = 'console-super-admin';
const SUPPORT = 'console-support';
const DISABLED_ADMIN = 'console-disabled-admin';
const TENANT_ADMIN = 'console-tenant-admin';
const OTHER_TENANT_ADMIN = 'console-other-tenant-admin';
let testEnv;

const timestamp = Timestamp.fromMillis(1_700_000_000_000);
const organization = (name) => ({
  name,
  slug: name.toLowerCase().replaceAll(' ', '-'),
  status: 'active',
  licenseStatus: 'ACTIVE',
  licenseWriteEnabled: true,
  licenseExpiresAt: null,
});
const member = (userId, role = 'ADMIN') => ({ userId, role, status: 'active' });
const platformAdmin = (role, status = 'ACTIVE') => ({
  email: `${role.toLowerCase()}@example.com`,
  displayName: role,
  role,
  status,
  createdAt: timestamp,
});

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, `organizations/${ORG_A}`), organization('Console Organization A')),
      setDoc(doc(db, `organizations/${ORG_B}`), organization('Console Organization B')),
      setDoc(doc(db, `organizations/${ORG_A}/members/${TENANT_ADMIN}`), member(TENANT_ADMIN)),
      setDoc(doc(db, `organizations/${ORG_B}/members/${OTHER_TENANT_ADMIN}`), member(OTHER_TENANT_ADMIN)),
      setDoc(doc(db, `users/${TENANT_ADMIN}`), { uid: TENANT_ADMIN, status: 'active', active: true }),
      setDoc(doc(db, `users/${OTHER_TENANT_ADMIN}`), { uid: OTHER_TENANT_ADMIN, status: 'active', active: true }),
      setDoc(doc(db, `organizations/${ORG_A}/settings/settings`), { businessName: 'Console Organization A' }),
      setDoc(doc(db, `organizations/${ORG_B}/settings/settings`), { businessName: 'Console Organization B' }),
      setDoc(doc(db, `platformAdmins/${SUPER_ADMIN}`), platformAdmin('SUPER_ADMIN')),
      setDoc(doc(db, `platformAdmins/${SUPPORT}`), platformAdmin('SUPPORT')),
      setDoc(doc(db, `platformAdmins/${DISABLED_ADMIN}`), platformAdmin('SUPER_ADMIN', 'DISABLED')),
      setDoc(doc(db, `platformAdmins/${TENANT_ADMIN}`), platformAdmin('USER', 'INACTIVE')),
      setDoc(doc(db, 'platformAuditLogs/log-a'), { action: 'LICENSE_UPDATED', createdAt: timestamp }),
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

test('active SUPER_ADMIN can perform the Console read set but cannot mutate privileged data from the browser', async () => {
  const db = testEnv.authenticatedContext(SUPER_ADMIN).firestore();

  await assertSucceeds(getDoc(doc(db, `platformAdmins/${SUPER_ADMIN}`)));
  await assertFails(getDocs(query(collection(db, 'platformAdmins'))));
  await assertSucceeds(getDocs(query(collection(db, 'organizations'))));
  await assertSucceeds(getDocs(query(collection(db, `organizations/${ORG_A}/members`))));
  await assertSucceeds(getDoc(doc(db, `organizations/${ORG_A}/settings/settings`)));
  await assertSucceeds(getDocs(query(collection(db, 'platformAuditLogs'))));

  await assertFails(updateDoc(doc(db, `organizations/${ORG_A}`), { licenseStatus: 'EXPIRED' }));
  await assertFails(updateDoc(doc(db, `organizations/${ORG_A}/license/current`), { status: 'EXPIRED' }));
  await assertFails(updateDoc(doc(db, `organizations/${ORG_A}/members/${TENANT_ADMIN}`), { status: 'suspended' }));
  await assertFails(updateDoc(doc(db, `platformAdmins/${SUPER_ADMIN}`), { status: 'DISABLED' }));
  await assertFails(setDoc(doc(db, 'platformAuditLogs/browser-write'), { action: 'FORGED', createdAt: timestamp }));
});

test('active SUPPORT has the same intended Console read-only visibility', async () => {
  const db = testEnv.authenticatedContext(SUPPORT).firestore();

  await assertSucceeds(getDoc(doc(db, `platformAdmins/${SUPPORT}`)));
  await assertSucceeds(getDocs(query(collection(db, 'organizations'))));
  await assertSucceeds(getDocs(query(collection(db, `organizations/${ORG_B}/members`))));
  await assertSucceeds(getDoc(doc(db, `organizations/${ORG_B}/settings/settings`)));
  await assertSucceeds(getDocs(query(collection(db, 'platformAuditLogs'))));
  await assertFails(updateDoc(doc(db, `organizations/${ORG_B}`), { plan: 'enterprise' }));
});

test('tenant administrators keep their tenant access without platform-console access', async () => {
  const db = testEnv.authenticatedContext(TENANT_ADMIN).firestore();

  await assertSucceeds(getDoc(doc(db, `organizations/${ORG_A}`)));
  await assertFails(getDoc(doc(db, `organizations/${ORG_B}`)));
  await assertSucceeds(getDoc(doc(db, `platformAdmins/${TENANT_ADMIN}`)));
  await assertFails(getDoc(doc(db, `platformAdmins/${SUPER_ADMIN}`)));
  await assertFails(getDocs(query(collection(db, 'platformAdmins'))));
  await assertFails(getDocs(query(collection(db, 'platformAuditLogs'))));
  await assertFails(updateDoc(doc(db, `organizations/${ORG_A}/license/current`), { status: 'ACTIVE' }));
});

test('inactive platform-admin records and unauthenticated callers have no Console access', async () => {
  const disabledDb = testEnv.authenticatedContext(DISABLED_ADMIN).firestore();
  const unauthenticatedDb = testEnv.unauthenticatedContext().firestore();

  await assertSucceeds(getDoc(doc(disabledDb, `platformAdmins/${DISABLED_ADMIN}`)));
  await assertFails(getDocs(query(collection(disabledDb, 'organizations'))));
  await assertFails(getDocs(query(collection(disabledDb, 'platformAuditLogs'))));
  await assertFails(getDoc(doc(unauthenticatedDb, `platformAdmins/${SUPER_ADMIN}`)));
  await assertFails(getDocs(query(collection(unauthenticatedDb, 'organizations'))));
  await assertFails(getDocs(query(collection(unauthenticatedDb, 'platformAuditLogs'))));
});
