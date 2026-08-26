import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '@/lib/server/firebase-admin';
import { executeBulkLifecycleAction, getBulkLifecycleDecision, type BulkLifecycleAction } from '@/lib/server/bulk-lifecycle';
import type { LifecycleEntity } from '@/lib/record-lifecycle';

export const runtime = 'nodejs';

function validId(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value) && value.length <= 128 && !value.includes('/');
}

function normalizeEntity(value: unknown): LifecycleEntity | null {
  return value === 'Lead' || value === 'lead' ? 'Lead' : value === 'Client' || value === 'client' ? 'Client' : null;
}

function normalizeAction(value: unknown): BulkLifecycleAction | null {
  return value === 'archive' || value === 'trash' || value === 'restore' || value === 'permanent-delete' ? value : null;
}

async function getUid(request: NextRequest) {
  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    return (await adminAuth.verifyIdToken(header.slice(7).trim())).uid;
  } catch {
    return null;
  }
}

async function getAuthorization(organizationId: string, uid: string) {
  const organization = adminDb.doc(`organizations/${organizationId}`);
  const [organizationSnapshot, membershipSnapshot] = await Promise.all([
    organization.get(),
    organization.collection('members').doc(uid).get(),
  ]);
  const membership = membershipSnapshot.data() || {};
  if (!organizationSnapshot.exists || !membershipSnapshot.exists || membership.userId !== uid || membership.status !== 'active') return null;
  return { organization, organizationSnapshot, membership };
}

function matchesLicense(organization: Record<string, unknown>, license: Record<string, unknown>, expiry: Timestamp) {
  return organization.licenseStatus === license.status
    && organization.licenseExpiresAt instanceof Timestamp
    && organization.licenseExpiresAt.toMillis() === expiry.toMillis()
    && ((license.status === 'TRIAL' && organization.status === 'trial') || (license.status === 'ACTIVE' && organization.status === 'active'));
}

function hasWritableLicense(organization: Record<string, unknown>, license: Record<string, unknown>) {
  const expiry = license.status === 'TRIAL' ? license.trialEndsAt : license.subscriptionEndsAt;
  return ['trial', 'active'].includes(String(organization.status))
    && organization.licenseWriteEnabled === true
    && ['TRIAL', 'ACTIVE'].includes(String(organization.licenseStatus))
    && organization.licenseExpiresAt instanceof Timestamp
    && organization.licenseExpiresAt.toMillis() >= Date.now()
    && ['TRIAL', 'STARTER', 'TEAM', 'LEGACY'].includes(String(license.plan))
    && ['TRIAL', 'ACTIVE'].includes(String(license.status))
    && Number.isInteger(license.maxUsers)
    && (license.maxUsers as number) >= 1
    && expiry instanceof Timestamp
    && expiry.toMillis() >= Date.now()
    && matchesLicense(organization, license, expiry);
}

export async function POST(request: NextRequest, context: { params: Promise<{ orgId: string }> }) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: 'Authentication is required.' }, { status: 401 });
  const { orgId } = await context.params;
  if (!validId(orgId)) return NextResponse.json({ error: 'Invalid organization.' }, { status: 400 });

  const authorization = await getAuthorization(orgId, uid);
  if (!authorization || !['ADMIN', 'MANAGER'].includes(String(authorization.membership.role))) {
    return NextResponse.json({ error: 'You are not allowed to perform bulk lifecycle actions.' }, { status: 403 });
  }

  let body: { entity?: unknown; action?: unknown; mode?: unknown; recordIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid bulk lifecycle request.' }, { status: 400 });
  }
  const entity = normalizeEntity(body.entity);
  const action = normalizeAction(body.action);
  const mode = body.mode === 'execute' ? 'execute' : body.mode === 'preview' ? 'preview' : null;
  const recordIds = Array.isArray(body.recordIds) ? [...new Set(body.recordIds.filter(validId))] : [];
  if (!entity || !action || !mode || recordIds.length === 0 || recordIds.length > 100 || recordIds.length !== (Array.isArray(body.recordIds) ? body.recordIds.length : 0)) {
    return NextResponse.json({ error: 'Bulk lifecycle requests must contain 1 to 100 unique record IDs.' }, { status: 400 });
  }

  if (mode === 'preview') {
    const previews = await Promise.all(recordIds.map(async (id) => {
      try {
        return { id, ok: true, decision: await getBulkLifecycleDecision(entity, orgId, id, action) };
      } catch (error) {
        return { id, ok: false, error: error instanceof Error && error.message === 'NOT_FOUND' ? 'The record could not be found.' : 'Unable to evaluate this record.' };
      }
    }));
    return NextResponse.json({ ok: true, mode, entity, action, results: previews });
  }

  const licenseSnapshot = await authorization.organization.collection('license').doc('current').get();
  if (!hasWritableLicense(authorization.organizationSnapshot.data() || {}, licenseSnapshot.data() || {})) {
    return NextResponse.json({ error: 'Bulk lifecycle actions are unavailable for the current workspace license.' }, { status: 409 });
  }
  const results = await executeBulkLifecycleAction(entity, orgId, action, recordIds, uid);
  return NextResponse.json({ ok: true, mode, entity, action, results });
}
