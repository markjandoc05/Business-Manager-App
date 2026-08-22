/*
 * Safe BSM data reset. Default mode is read-only; pass --apply to delete.
 * This script preserves Auth users, global profiles, the organization, members,
 * and organization settings.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const apply = process.argv.includes('--apply');
const expectedProjectId = 'bsm-client-app-web';
const configuredProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
if (configuredProjectId && configuredProjectId !== expectedProjectId) {
  throw new Error(`Refusing to run against project ${configuredProjectId}; expected ${expectedProjectId}.`);
}
const projectId = expectedProjectId;
const canonicalSlug = 'aiph-internal';
const app = initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore(app);

const deleteRefs = [];
const counts = {
  organization: {
    leads: 0,
    clients: 0,
    deals: 0,
    tasks: 0,
    activities: 0,
    leadTimelines: 0,
    dealTimelines: 0,
    clientNotes: 0,
    clientDocumentMetadata: 0,
    otherNested: 0,
  },
  legacy: { leads: 0, clients: 0, deals: 0, tasks: 0, activities: 0, systemSettings: 0 },
};

const protectedData = {
  authUsers: 'preserved by this script; Firebase Auth is not accessed for deletion',
  rootUsers: 'preserved',
  organization: 'preserved',
  members: 'preserved',
  settings: 'preserved',
};

function increment(scope, category) {
  if (category in counts[scope]) counts[scope][category] += 1;
}

async function collectDocumentTree(documentRef, scope, category, childCategories = {}) {
  deleteRefs.push(documentRef);
  increment(scope, category);
  const subcollections = await documentRef.listCollections();
  for (const subcollection of subcollections) {
    const childCategory = childCategories[subcollection.id] || 'otherNested';
    const children = await subcollection.get();
    for (const child of children.docs) await collectDocumentTree(child.ref, scope, childCategory, childCategories);
  }
}

async function collectTopLevel(collectionRef, scope, category, childCategories = {}) {
  const snapshot = await collectionRef.get();
  for (const document of snapshot.docs) await collectDocumentTree(document.ref, scope, category, childCategories);
}

async function verifyProtectedAccess() {
  const organizations = await db.collection('organizations').where('slug', '==', canonicalSlug).limit(2).get();
  if (organizations.size !== 1) throw new Error(`Expected exactly one organization with slug ${canonicalSlug}; found ${organizations.size}.`);
  const organization = organizations.docs[0];
  const settingsRef = organization.ref.collection('settings').doc('settings');
  const [members, settings, admins] = await Promise.all([
    organization.ref.collection('members').get(),
    settingsRef.get(),
    organization.ref.collection('members').where('role', '==', 'ADMIN').where('status', '==', 'active').get(),
  ]);
  if (admins.empty) throw new Error('No active ADMIN membership was found; refusing to reset data.');
  if (!settings.exists) throw new Error('Organization settings are missing; refusing to reset data.');
  const adminProfiles = await Promise.all(admins.docs.map((member) => db.collection('users').doc(member.id).get()));
  const missingProfiles = adminProfiles.filter((profile) => !profile.exists).map((profile) => profile.id);
  if (missingProfiles.length) throw new Error(`Active ADMIN profile is missing from users: ${missingProfiles.join(', ')}; refusing to reset data.`);
  return { organization, members, settings, admins };
}

async function collectPlan(organization) {
  const organizationRoot = organization.ref;
  await collectTopLevel(organizationRoot.collection('leads'), 'organization', 'leads', { timeline: 'leadTimelines' });
  await collectTopLevel(organizationRoot.collection('clients'), 'organization', 'clients', { notes: 'clientNotes', documents: 'clientDocumentMetadata' });
  await collectTopLevel(organizationRoot.collection('deals'), 'organization', 'deals', { timeline: 'dealTimelines' });
  await collectTopLevel(organizationRoot.collection('tasks'), 'organization', 'tasks');
  await collectTopLevel(organizationRoot.collection('activities'), 'organization', 'activities');

  for (const name of ['leads', 'clients', 'deals', 'tasks', 'activities']) {
    await collectTopLevel(db.collection(name), 'legacy', name, { timeline: 'otherNested', notes: 'otherNested', documents: 'otherNested' });
  }
  const legacySettings = db.collection('system').doc('settings');
  if ((await legacySettings.get()).exists) {
    deleteRefs.push(legacySettings);
    counts.legacy.systemSettings += 1;
  }
}

async function inspectStorage(organizationId) {
  const prefix = `organizations/${organizationId}/clients/`;
  try {
    const bucket = getStorage(app).bucket();
    const [files] = await bucket.getFiles({ prefix });
    return { status: 'IN_USE', prefix, count: files.length, paths: files.map((file) => file.name), bucket: bucket.name };
  } catch (error) {
    return { status: 'UNAVAILABLE', prefix, count: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

try {
  const access = await verifyProtectedAccess();
  await collectPlan(access.organization);
  const storage = await inspectStorage(access.organization.id);
  const output = {
    mode: apply ? 'apply' : 'dry-run',
    projectId,
    organization: { slug: canonicalSlug, id: access.organization.id, path: access.organization.ref.path },
    protected: { ...protectedData, adminMemberships: access.admins.docs.map((member) => ({ uid: member.id, role: member.data().role, status: member.data().status })) },
    memberCount: access.members.size,
    settingsPath: access.organization.ref.collection('settings').doc('settings').path,
    deleteCounts: counts,
    storage,
    firestoreDeletesPlanned: deleteRefs.length,
    readOnly: !apply,
  };
  console.log(JSON.stringify(output, null, 2));
  if (!apply) {
    console.log('Dry run only. No Firestore or Storage data was deleted.');
  } else {
    const rechecked = await verifyProtectedAccess();
    if (rechecked.organization.id !== access.organization.id) throw new Error('Organization changed during reset; refusing to delete.');
    for (let index = 0; index < deleteRefs.length; index += 400) {
      const batch = db.batch();
      for (const ref of deleteRefs.slice(index, index + 400)) batch.delete(ref);
      await batch.commit();
    }
    if (storage.status === 'IN_USE' && storage.paths.length) {
      const bucket = getStorage(app).bucket();
      await Promise.all(storage.paths.map((filePath) => bucket.file(filePath).delete()));
    }
    console.log(JSON.stringify({ applied: true, deletedFirestoreDocuments: deleteRefs.length, deletedStorageObjects: storage.status === 'IN_USE' ? storage.paths.length : 0 }));
  }
} catch (error) {
  console.error(`Reset stopped safely: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Required credentials: Firebase Admin Application Default Credentials for project bsm-client-app-web, or GOOGLE_APPLICATION_CREDENTIALS pointing to an authorized service-account JSON file.');
  process.exitCode = 1;
}
