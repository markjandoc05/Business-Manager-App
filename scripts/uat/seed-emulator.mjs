#!/usr/bin/env node

/**
 * Seeds a small, repeatable BSM workspace for authenticated browser UAT.
 * This script is intentionally emulator-only and writes generated passwords
 * to a local 0600 file outside the repository. It never prints passwords.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-bsm-client-app';
const ORGANIZATION_ID = 'bsm-uat-org';
const credentialsFile = resolve(process.env.BSM_UAT_CREDENTIALS_FILE || '/private/tmp/bsm-uat-credentials.json');

function assertEmulatorOnly() {
  const projectIds = [process.env.GOOGLE_CLOUD_PROJECT, process.env.GCLOUD_PROJECT, process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID]
    .map((value) => value?.trim()).filter(Boolean);
  if (projectIds.some((value) => value === 'bsm-client-app-web') || projectIds.some((value) => value !== PROJECT_ID)) {
    throw new Error(`Refusing UAT seed outside Firebase project ${PROJECT_ID}.`);
  }
  if (projectIds.length === 0 || !process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error('UAT seed requires GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT plus Firestore and Auth emulator hosts.');
  }
  if (credentialsFile.startsWith(`${resolve(process.cwd())}/`)) {
    throw new Error('UAT credentials must be written outside the repository.');
  }
}

assertEmulatorOnly();
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.GCLOUD_PROJECT = PROJECT_ID;

const app = getApps()[0] || initializeApp({ projectId: PROJECT_ID, credential: applicationDefault(), storageBucket: `${PROJECT_ID}.firebasestorage.app` });
const auth = getAuth(app);
const db = getFirestore(app);
const now = Timestamp.now();
const future = Timestamp.fromMillis(Date.now() + 30 * 86_400_000);

const identities = [
  { key: 'admin', uid: 'bsm-uat-admin', email: 'admin@bsm-uat.local', displayName: 'BSM UAT Admin', role: 'ADMIN' },
  { key: 'manager', uid: 'bsm-uat-manager', email: 'manager@bsm-uat.local', displayName: 'BSM UAT Manager', role: 'MANAGER' },
  { key: 'user', uid: 'bsm-uat-user', email: 'user@bsm-uat.local', displayName: 'BSM UAT User', role: 'USER' },
];

function password() {
  return `Uat-${randomBytes(24).toString('base64url')}`;
}

async function upsertAuthUser(identity) {
  const generatedPassword = password();
  try {
    await auth.updateUser(identity.uid, { email: identity.email, displayName: identity.displayName, password: generatedPassword, emailVerified: true, disabled: false });
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') throw error;
    await auth.createUser({ uid: identity.uid, email: identity.email, displayName: identity.displayName, password: generatedPassword, emailVerified: true, disabled: false });
  }
  return { ...identity, password: generatedPassword };
}

const seededIdentities = await Promise.all(identities.map(upsertAuthUser));
const organizationRef = db.doc(`organizations/${ORGANIZATION_ID}`);
const organizationData = {
  name: 'BSM UAT Workspace', slug: 'bsm-uat-workspace', businessType: 'Small Business', status: 'active', plan: 'TEAM', subscriptionStatus: 'active',
  maxUsers: 3, licenseStatus: 'ACTIVE', licenseWriteEnabled: true, licenseExpiresAt: future, createdAt: now, updatedAt: now, createdByUid: seededIdentities[0].uid,
};
const pipelineStages = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'].map((name) => ({ name, isActive: true }));
const leadSources = ['Website', 'Referral', 'LinkedIn', 'Events'].map((name) => ({ name, isActive: true }));

await organizationRef.set(organizationData, { merge: true });
await organizationRef.collection('license').doc('current').set({
  plan: 'TEAM', status: 'ACTIVE', subscriptionStartedAt: now, subscriptionEndsAt: future, maxUsers: 3,
  features: { crm: true, sales: true, reports: true }, createdAt: now, updatedAt: now, updatedBy: seededIdentities[0].uid,
}, { merge: true });
await organizationRef.collection('settings').doc('settings').set({
  businessName: organizationData.name, businessType: organizationData.businessType, email: 'uat@bsm-uat.local', phone: '+63 900 000 0000', website: '', address: '',
  currency: 'PHP', timezone: 'Asia/Manila', logoUrl: '', accentColor: '#3b82f6', pipelineStages, leadSources,
  salesReferenceMode: 'SYSTEM_GENERATED', salesReferencePrefix: 'SALE-', salesReferenceStartingNumber: 1, salesReferenceDigits: 6,
  salesDefaultPaymentStatus: 'PAID', salesDefaultPaymentMethod: 'CASH', updatedAt: now, updatedBy: seededIdentities[0].uid,
}, { merge: true });

await Promise.all(seededIdentities.map((identity) => Promise.all([
  db.doc(`users/${identity.uid}`).set({ uid: identity.uid, email: identity.email, displayName: identity.displayName, name: identity.displayName, role: identity.role, status: 'active', active: true, createdAt: now, updatedAt: now }, { merge: true }),
  organizationRef.collection('members').doc(identity.uid).set({ userId: identity.uid, email: identity.email, displayName: identity.displayName, role: identity.role, status: 'active', joinedAt: now, activatedAt: now, activatedBy: 'uat-seed', updatedAt: now }, { merge: true }),
])));

const adminUid = seededIdentities[0].uid;
const managerUid = seededIdentities[1].uid;
await db.doc(`workspaceBootstrap/${adminUid}`).set({ organizationId: ORGANIZATION_ID, createdAt: now, createdByUid: adminUid }, { merge: true });
const clientOne = organizationRef.collection('clients').doc('uat-client-001');
const clientTwo = organizationRef.collection('clients').doc('uat-client-002');
await Promise.all([
  clientOne.set({ name: 'UAT Client One', company: 'Example Holdings', email: 'client.one@bsm-uat.local', phone: '09170000001', assignedToUid: managerUid, assignedToName: seededIdentities[1].displayName, status: 'ACTIVE', archived: false, trashed: false, createdAt: now, createdBy: adminUid, updatedAt: now, updatedBy: adminUid }, { merge: true }),
  clientTwo.set({ name: 'UAT Client Two', company: 'Demo Studio', email: 'client.two@bsm-uat.local', phone: '09170000002', assignedToUid: adminUid, assignedToName: seededIdentities[0].displayName, status: 'ACTIVE', archived: false, trashed: false, createdAt: now, createdBy: adminUid, updatedAt: now, updatedBy: adminUid }, { merge: true }),
]);

const lead = organizationRef.collection('leads').doc('uat-lead-001');
await lead.set({ name: 'UAT Prospect', company: 'Example Holdings', email: 'prospect@bsm-uat.local', phone: '09170000003', source: 'Website', status: 'New', assignedToUid: managerUid, assignedToName: seededIdentities[1].displayName, archived: false, trashed: false, createdAt: now, createdBy: adminUid, updatedAt: now, updatedBy: adminUid }, { merge: true });

const item = { source: 'CATALOG', catalogItemId: 'uat-catalog-001', type: 'PRODUCT', name: 'UAT Service Package', code: 'UAT-001', categoryId: null, category: 'Services', unit: 'package', regularPrice: 1000, salePrice: null, quantity: 1, unitPrice: 1000, subtotal: 1000 };
await organizationRef.collection('catalogItems').doc('uat-catalog-001').set({ type: 'PRODUCT', name: item.name, code: item.code, category: item.category, categoryId: null, unit: item.unit, regularPrice: 1000, salePrice: null, effectivePrice: 1000, status: 'ACTIVE', archived: false, createdBy: adminUid, createdAt: now, updatedBy: adminUid, updatedAt: now }, { merge: true });

const openDeal = organizationRef.collection('deals').doc('uat-deal-open-001');
const recordedDeal = organizationRef.collection('deals').doc('uat-deal-recorded-001');
await Promise.all([
  openDeal.set({ title: 'UAT Won Deal - Record Sale', clientId: clientOne.id, value: 1000, stage: 'Won', status: 'Won', expectedCloseDate: new Date().toISOString().slice(0, 10), wonAt: now, items: [item], assignedToUid: managerUid, assignedToName: seededIdentities[1].displayName, archived: false, createdAt: now, createdBy: adminUid, updatedAt: now, updatedBy: adminUid }, { merge: true }),
  recordedDeal.set({ title: 'UAT Won Deal - Existing Sale', clientId: clientTwo.id, value: 2500, stage: 'Won', status: 'Won', expectedCloseDate: new Date().toISOString().slice(0, 10), wonAt: now, items: [item], assignedToUid: adminUid, assignedToName: seededIdentities[0].displayName, archived: false, createdAt: now, createdBy: adminUid, updatedAt: now, updatedBy: adminUid }, { merge: true }),
]);

const saleRef = organizationRef.collection('sales').doc('uat-sale-001');
await saleRef.set({ saleNumber: 'SALE-UAT-001', saleDate: new Date().toISOString().slice(0, 10), customerType: 'CLIENT', source: 'DEAL', customerName: 'UAT Client Two', clientId: clientTwo.id, dealId: recordedDeal.id, items: [item], subtotal: 1000, total: 1000, paymentStatus: 'PAID', paymentMethod: 'CASH', amountPaid: 1000, balance: 0, notes: 'Seeded UAT sale', status: 'ACTIVE', archived: false, archivedAt: null, archivedBy: null, trashed: false, trashedAt: null, trashedBy: null, createdAt: now, createdBy: adminUid, updatedAt: now, updatedBy: adminUid }, { merge: true });
await organizationRef.collection('dealSaleLocks').doc(recordedDeal.id).set({ dealId: recordedDeal.id, saleId: saleRef.id, status: 'ACTIVE', updatedAt: now, updatedBy: adminUid }, { merge: true });

await Promise.all([
  organizationRef.collection('tasks').doc('uat-task-001').set({ title: 'Follow up with UAT Prospect', description: 'Confirm requirements', type: 'Follow-up', dueDate: new Date(Date.now() + 86_400_000).toISOString(), status: 'Pending', priority: 'High', relatedTo: { type: 'Lead', id: lead.id }, assignedToUid: managerUid, assignedToName: seededIdentities[1].displayName, archived: false, createdAt: now, createdBy: managerUid, updatedAt: now, updatedBy: managerUid }, { merge: true }),
  clientOne.collection('notes').doc('uat-note-001').set({ content: 'UAT sample client note.', author: seededIdentities[0].displayName, createdByUid: adminUid, createdByName: seededIdentities[0].displayName, createdAt: now, archived: false, trashed: false }, { merge: true }),
  clientOne.collection('documents').doc('uat-document-001').set({ name: 'UAT brief.pdf', storagePath: `organizations/${ORGANIZATION_ID}/clients/${clientOne.id}/uat-brief.pdf`, mimeType: 'application/pdf', size: 1024, uploadedAt: now, uploadedByUid: adminUid, uploadedByName: seededIdentities[0].displayName, archived: false }, { merge: true }),
  organizationRef.collection('activities').doc('uat-activity-001').set({ type: 'client_creation', description: 'UAT sample client created', entityType: 'Client', entityId: clientOne.id, createdAt: now, createdBy: adminUid, timestamp: now }, { merge: true }),
]);

mkdirSync(dirname(credentialsFile), { recursive: true });
writeFileSync(credentialsFile, `${JSON.stringify({ projectId: PROJECT_ID, organizationId: ORGANIZATION_ID, generatedAt: new Date().toISOString(), users: seededIdentities.map(({ password: generatedPassword, ...identity }) => ({ ...identity, password: generatedPassword })) }, null, 2)}\n`, { mode: 0o600 });
chmodSync(credentialsFile, 0o600);
console.log(`Seeded ${organizationData.name} (${ORGANIZATION_ID}) with ${seededIdentities.length} local UAT identities.`);
console.log(`Credentials written to ${credentialsFile} (passwords are not printed).`);
