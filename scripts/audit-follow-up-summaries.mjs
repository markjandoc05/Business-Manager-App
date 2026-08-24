/* Read-only audit of legacy nextFollowUpAt fields against organization Tasks. */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'bsm-client-app-web';
const ORGANIZATION_SLUG = 'aiph-internal';
initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

const organizationSnapshot = await db.collection('organizations').where('slug', '==', ORGANIZATION_SLUG).limit(2).get();
if (organizationSnapshot.size !== 1) throw new Error(`Expected exactly one organization with slug ${ORGANIZATION_SLUG}; found ${organizationSnapshot.size}.`);
const organization = organizationSnapshot.docs[0];
const [leads, clients, tasks] = await Promise.all([
  organization.ref.collection('leads').get(),
  organization.ref.collection('clients').get(),
  organization.ref.collection('tasks').get(),
]);
const records = [...leads.docs.map((doc) => ({ type: 'Lead', doc })), ...clients.docs.map((doc) => ({ type: 'Client', doc }))];
const openFollowUps = tasks.docs.filter((task) => task.data().archived !== true && task.data().status === 'Pending' && task.data().type !== 'Task' && task.data().relatedTo?.type);
const byRecord = new Map();
for (const task of openFollowUps) {
  const related = task.data().relatedTo;
  const key = `${related.type}:${related.id}`;
  const current = byRecord.get(key);
  if (!current || String(task.data().dueDate) < String(current.dueDate)) byRecord.set(key, { dueDate: task.data().dueDate, taskId: task.id });
}
const result = { recordsScanned: records.length, recordsWithNextFollowUpAt: 0, matchingOpenFollowUp: 0, staleNextFollowUpAt: 0, missingNextFollowUpAt: 0, ambiguousRecords: 0, warnings: [] };
for (const record of records) {
  const data = record.doc.data();
  if (data.nextFollowUpAt == null) continue;
  result.recordsWithNextFollowUpAt += 1;
  const expected = byRecord.get(`${record.type}:${record.doc.id}`);
  if (!expected) { result.staleNextFollowUpAt += 1; result.warnings.push(`${record.type}/${record.doc.id} has nextFollowUpAt but no open Follow-up Task.`); }
  else result.matchingOpenFollowUp += 1;
}
for (const [key] of byRecord) {
  if (!records.some((record) => `${record.type}:${record.doc.id}` === key)) result.ambiguousRecords += 1;
}
console.log(JSON.stringify({ mode: 'read-only-dry-run', projectId: PROJECT_ID, databaseId: '(default)', organizationId: organization.id, ...result, writes: 0 }, null, 2));
