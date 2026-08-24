/*
 * Backfill organization Lead activity summaries from each Lead's timeline.
 * Dry-run by default. Pass --apply to update only the five summary fields.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'bsm-client-app-web';
const ORGANIZATION_SLUG = 'aiph-internal';
const BATCH_SIZE = 400;
const apply = process.argv.includes('--apply');

initializeApp({
  credential: applicationDefault(),
  projectId: PROJECT_ID,
});
const db = getFirestore();

const SUMMARY_FIELDS = [
  'nextScheduledActivityAt',
  'nextScheduledActivityType',
  'nextScheduledActivityId',
  'lastActivityAt',
  'lastActivityType',
];

function timestampMillis(value) {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  return Number.NaN;
}

function isValidTimestamp(value) {
  return Number.isFinite(timestampMillis(value));
}

function isActivityType(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function activityTypeOrOther(value) {
  return isActivityType(value) ? value : 'Other';
}

function sameTimestamp(left, right) {
  const leftMillis = timestampMillis(left);
  const rightMillis = timestampMillis(right);
  return Number.isFinite(leftMillis) && Number.isFinite(rightMillis) && leftMillis === rightMillis;
}

function sameValue(left, right, field) {
  if (field.endsWith('At')) {
    if (right === null) return left === undefined || left === null;
    return left instanceof Timestamp && sameTimestamp(left, right);
  }
  return left === right || (right === null && (left === undefined || left === null));
}

function compareTimelineEntries(left, right) {
  return timestampMillis(left.data().occurredAt) - timestampMillis(right.data().occurredAt);
}

function analyzeLead(leadDoc, timelineSnapshot, nowMillis) {
  const warnings = [];
  const activities = [];

  for (const entryDoc of timelineSnapshot.docs) {
    const data = entryDoc.data();
    if (data.entryType !== 'ACTIVITY') continue;

    const occurredAtMillis = timestampMillis(data.occurredAt);
    if (!Number.isFinite(occurredAtMillis)) {
      warnings.push(`${leadDoc.id}: activity ${entryDoc.id} has an invalid or missing occurredAt`);
      continue;
    }

    if (data.activityStatus !== 'SCHEDULED' && data.activityStatus !== 'COMPLETED') {
      warnings.push(`${leadDoc.id}: activity ${entryDoc.id} has an invalid or missing activityStatus`);
      continue;
    }

    if (!isActivityType(data.activityType)) {
      warnings.push(`${leadDoc.id}: activity ${entryDoc.id} has no activityType; using Other`);
    }

    activities.push({ entryDoc, data, occurredAtMillis });
    if (data.activityStatus === 'SCHEDULED' && occurredAtMillis <= nowMillis) {
      warnings.push(`${leadDoc.id}: scheduled activity ${entryDoc.id} is not in the future and was excluded from next activity`);
    }
  }

  const futureScheduled = activities
    .filter(({ data, occurredAtMillis }) => data.activityStatus === 'SCHEDULED' && occurredAtMillis > nowMillis)
    .sort((left, right) => left.occurredAtMillis - right.occurredAtMillis);
  const next = futureScheduled[0];

  const completed = activities
    .filter(({ data }) => data.activityStatus === 'COMPLETED')
    .sort((left, right) => right.occurredAtMillis - left.occurredAtMillis);
  const last = completed[0];

  const desired = {
    nextScheduledActivityAt: next ? next.data.occurredAt : null,
    nextScheduledActivityType: next ? activityTypeOrOther(next.data.activityType) : null,
    nextScheduledActivityId: next ? next.entryDoc.id : null,
    lastActivityAt: last ? last.data.occurredAt : null,
    lastActivityType: last ? activityTypeOrOther(last.data.activityType) : null,
  };

  const current = leadDoc.data();
  const changes = {};
  for (const field of SUMMARY_FIELDS) {
    if (!sameValue(current[field], desired[field], field)) changes[field] = desired[field];
  }

  return {
    desired,
    changes,
    warnings,
    hasTimeline: timelineSnapshot.size > 0,
    hasNext: Boolean(next),
    hasLast: Boolean(last),
  };
}

function serializeValue(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return value;
}

function serializeChanges(changes) {
  return Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, serializeValue(value)]));
}

async function resolveOrganization() {
  const snapshot = await db.collection('organizations')
    .where('slug', '==', ORGANIZATION_SLUG)
    .limit(2)
    .get();
  if (snapshot.size !== 1) {
    throw new Error(`Expected exactly one organization with slug ${ORGANIZATION_SLUG}; found ${snapshot.size}.`);
  }
  return snapshot.docs[0];
}

async function readLeadPlans(organization) {
  const leadsSnapshot = await organization.ref.collection('leads').get();
  const plans = [];
  const warnings = [];
  const counts = {
    leadsScanned: leadsSnapshot.size,
    leadsRequiringUpdates: 0,
    leadsAlreadyCorrect: 0,
    leadsWithNoTimeline: 0,
    leadsWithNoScheduledActivity: 0,
    leadsWithNoLastActivity: 0,
  };
  const nowMillis = Date.now();

  for (const leadDoc of leadsSnapshot.docs) {
    try {
      const timelineSnapshot = await leadDoc.ref.collection('timeline').get();
      const analysis = analyzeLead(leadDoc, timelineSnapshot, nowMillis);
      warnings.push(...analysis.warnings);
      if (!analysis.hasTimeline) counts.leadsWithNoTimeline += 1;
      if (!analysis.hasNext) counts.leadsWithNoScheduledActivity += 1;
      if (!analysis.hasLast) counts.leadsWithNoLastActivity += 1;
      if (Object.keys(analysis.changes).length > 0) {
        counts.leadsRequiringUpdates += 1;
        plans.push({ ref: leadDoc.ref, leadId: leadDoc.id, changes: analysis.changes });
      } else {
        counts.leadsAlreadyCorrect += 1;
      }
    } catch (error) {
      warnings.push(`${leadDoc.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { plans, warnings, counts, nowMillis };
}

async function applyPlans(plans) {
  for (let index = 0; index < plans.length; index += BATCH_SIZE) {
    const batch = db.batch();
    for (const plan of plans.slice(index, index + BATCH_SIZE)) batch.update(plan.ref, plan.changes);
    await batch.commit();
  }
}

async function verifyApplied(organization) {
  const { plans, warnings, counts } = await readLeadPlans(organization);
  return { mismatches: plans.map((plan) => plan.leadId), warnings, counts };
}

const organization = await resolveOrganization();
const { plans, warnings, counts } = await readLeadPlans(organization);

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  projectId: PROJECT_ID,
  databaseId: '(default)',
  organizationSlug: ORGANIZATION_SLUG,
  organizationId: organization.id,
  organizationPath: organization.ref.path,
  ...counts,
  samplePlannedChanges: plans.slice(0, 10).map((plan) => ({ leadId: plan.leadId, changes: serializeChanges(plan.changes) })),
  warnings,
}, null, 2));

if (!apply) {
  console.log('Dry run only. No Firestore documents were written.');
} else {
  await applyPlans(plans);
  const verification = await verifyApplied(organization);
  console.log(JSON.stringify({
    appliedLeads: plans.length,
    verification,
  }, null, 2));
  if (verification.mismatches.length > 0) throw new Error(`Verification found mismatched Leads: ${verification.mismatches.join(', ')}`);
}
