/* Read-only audit of organization Deal stages. */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'bsm-client-app-web';
const ORGANIZATION_SLUG = 'aiph-internal';
const CANONICAL_STAGES = ['New', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'];
const LEGACY_MAPPING = { Opportunity: 'New' };

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore();

const organizationSnapshot = await db.collection('organizations').where('slug', '==', ORGANIZATION_SLUG).limit(2).get();
if (organizationSnapshot.size !== 1) throw new Error(`Expected exactly one organization with slug ${ORGANIZATION_SLUG}; found ${organizationSnapshot.size}.`);
const organization = organizationSnapshot.docs[0];
const deals = await organization.ref.collection('deals').get();
const invalid = [];
for (const deal of deals.docs) {
  const stage = deal.data().stage;
  if (CANONICAL_STAGES.includes(stage)) continue;
  invalid.push({
    dealId: deal.id,
    stage: stage ?? null,
    proposedStage: typeof stage === 'string' && LEGACY_MAPPING[stage] ? LEGACY_MAPPING[stage] : null,
    deterministic: typeof stage === 'string' && Boolean(LEGACY_MAPPING[stage]),
  });
}

console.log(JSON.stringify({
  mode: 'read-only-dry-run',
  projectId: PROJECT_ID,
  databaseId: '(default)',
  organizationId: organization.id,
  organizationPath: organization.ref.path,
  dealsScanned: deals.size,
  canonicalStages: CANONICAL_STAGES,
  invalidStageCount: invalid.length,
  invalidDeals: invalid,
  writes: 0,
}, null, 2));
