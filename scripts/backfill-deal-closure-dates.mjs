/*
 * Recover Deal closure timestamps from reliable Deal timeline events.
 * Dry-run by default. Pass --apply to update only wonAt/lostAt.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const PROJECT_ID = 'bsm-client-app-web';
const ORGANIZATION_SLUG = 'aiph-internal';
const BATCH_SIZE = 400;
const apply = process.argv.includes('--apply');

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

function timestampMillis(value) {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  return Number.NaN;
}

function serializeTimestamp(value) {
  return value instanceof Timestamp ? value.toDate().toISOString() : value;
}

function isClosureEvent(data, status) {
  if (data.entryType !== 'SYSTEM' || typeof data.content !== 'string') return false;
  const content = data.content.trim();
  return status === 'Won' ? content === 'Deal won.' : content.startsWith('Deal lost. Reason:');
}

async function resolveOrganization() {
  const snapshot = await db.collection('organizations').where('slug', '==', ORGANIZATION_SLUG).limit(2).get();
  if (snapshot.size !== 1) throw new Error(`Expected exactly one organization with slug ${ORGANIZATION_SLUG}; found ${snapshot.size}.`);
  return snapshot.docs[0];
}

async function analyzeDeal(dealDoc) {
  const data = dealDoc.data();
  const status = data.status;
  const targetField = status === 'Won' ? 'wonAt' : status === 'Lost' ? 'lostAt' : null;
  if (!targetField || data[targetField] != null) return { changes: {}, reason: targetField ? 'already-present' : 'active' };

  const oppositeField = targetField === 'wonAt' ? 'lostAt' : 'wonAt';
  if (data[oppositeField] != null) {
    return { changes: {}, reason: 'conflict', warning: `${dealDoc.id}: ${status} Deal has contradictory ${oppositeField}.` };
  }

  const timeline = await dealDoc.ref.collection('timeline').get();
  const candidates = [];
  for (const entry of timeline.docs) {
    const entryData = entry.data();
    if (!isClosureEvent(entryData, status)) continue;
    const millis = timestampMillis(entryData.occurredAt);
    if (Number.isFinite(millis)) candidates.push({ entryId: entry.id, occurredAt: entryData.occurredAt, millis });
  }
  candidates.sort((left, right) => right.millis - left.millis);
  const event = candidates[0];
  if (!event) {
    return { changes: {}, reason: 'ambiguous', warning: `${dealDoc.id}: ${status} Deal has no reliable closure timeline event.` };
  }
  return {
    changes: { [targetField]: event.occurredAt },
    reason: 'recoverable',
    source: { entryId: event.entryId, occurredAt: event.occurredAt },
  };
}

async function buildPlans(organization) {
  const snapshot = await organization.ref.collection('deals').get();
  const plans = [];
  const warnings = [];
  const counts = {
    dealsScanned: snapshot.size,
    wonMissingWonAt: 0,
    lostMissingLostAt: 0,
    reliableTimestampsRecoverable: 0,
    ambiguousHistoricalRecords: 0,
    alreadyCompleteOrActive: 0,
    conflicts: 0,
  };

  for (const dealDoc of snapshot.docs) {
    const status = dealDoc.data().status;
    if (status === 'Won' && dealDoc.data().wonAt == null) counts.wonMissingWonAt += 1;
    if (status === 'Lost' && dealDoc.data().lostAt == null) counts.lostMissingLostAt += 1;
    const analysis = await analyzeDeal(dealDoc);
    if (analysis.reason === 'recoverable') {
      counts.reliableTimestampsRecoverable += 1;
      plans.push({ ref: dealDoc.ref, dealId: dealDoc.id, changes: analysis.changes, source: analysis.source });
    } else if (analysis.reason === 'ambiguous') {
      counts.ambiguousHistoricalRecords += 1;
      warnings.push(analysis.warning);
    } else if (analysis.reason === 'conflict') {
      counts.conflicts += 1;
      warnings.push(analysis.warning);
    } else {
      counts.alreadyCompleteOrActive += 1;
    }
  }
  return { plans, warnings, counts };
}

async function applyPlans(plans) {
  for (let index = 0; index < plans.length; index += BATCH_SIZE) {
    const batch = db.batch();
    for (const plan of plans.slice(index, index + BATCH_SIZE)) batch.update(plan.ref, plan.changes);
    await batch.commit();
  }
}

async function verifyApplied(organization) {
  const { plans, warnings, counts } = await buildPlans(organization);
  return { remainingPlans: plans.map((plan) => plan.dealId), warnings, counts };
}

const organization = await resolveOrganization();
const result = await buildPlans(organization);

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  projectId: PROJECT_ID,
  databaseId: '(default)',
  organizationSlug: ORGANIZATION_SLUG,
  organizationId: organization.id,
  organizationPath: organization.ref.path,
  ...result.counts,
  samplePlannedUpdates: result.plans.slice(0, 10).map((plan) => ({
    dealId: plan.dealId,
    changes: Object.fromEntries(Object.entries(plan.changes).map(([key, value]) => [key, serializeTimestamp(value)])),
    source: plan.source,
  })),
  warnings: result.warnings,
}, null, 2));

if (!apply) {
  console.log('Dry run only. No Firestore documents were written.');
} else {
  await applyPlans(result.plans);
  const verification = await verifyApplied(organization);
  console.log(JSON.stringify({ appliedDeals: result.plans.length, verification }, null, 2));
  if (verification.remainingPlans.length > 0) throw new Error(`Verification found remaining Deal closure plans: ${verification.remainingPlans.join(', ')}`);
}
