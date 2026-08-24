import { doc, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import type { AppUser, License, LicensePlan, LicenseStatus, ResolvedLicenseState } from '@/types/auth';
import { requireOrganizationAccess } from '@/lib/permissions';
import { organizationDocumentInCollection } from '@/lib/organizations/paths';
import { DEFAULT_LEGACY_MAX_USERS, DEFAULT_LICENSE_FEATURES } from '@/lib/licensing/config';

export function licenseDocument(organizationId: string) {
  return organizationDocumentInCollection(db, organizationId, 'license', 'current');
}

function timestamp(value: unknown) {
  return value instanceof Timestamp ? value : undefined;
}

function mapLicense(data: Record<string, unknown>): License | null {
  const plan = ['TRIAL', 'STARTER', 'TEAM', 'LEGACY'].includes(data.plan as string) ? data.plan as LicensePlan : null;
  const status = ['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED'].includes(data.status as string) ? data.status as LicenseStatus : null;
  if (!plan || !status || typeof data.maxUsers !== 'number') return null;
  return {
    plan,
    status,
    maxUsers: data.maxUsers,
    features: data.features && typeof data.features === 'object' ? data.features as Record<string, boolean> : { ...DEFAULT_LICENSE_FEATURES },
    trialStartedAt: timestamp(data.trialStartedAt),
    trialEndsAt: timestamp(data.trialEndsAt),
    subscriptionStartedAt: timestamp(data.subscriptionStartedAt),
    subscriptionEndsAt: timestamp(data.subscriptionEndsAt),
    createdAt: timestamp(data.createdAt),
    updatedAt: timestamp(data.updatedAt),
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
  };
}

export async function getOrganizationLicense(organizationId: string) {
  const snapshot = await getDoc(licenseDocument(organizationId));
  return snapshot.exists() ? mapLicense(snapshot.data()) : null;
}

export async function loadOrganizationLicense(user: AppUser | null, organizationId: string) {
  await requireOrganizationAccess(user, organizationId);
  try {
    return await getOrganizationLicense(organizationId);
  } catch (error) {
    console.error('Unable to load organization license', error);
    throw new Error('Unable to load subscription status. Please try again.');
  }
}

export function resolveLicenseState(license: License | null, now = Date.now()): ResolvedLicenseState {
  if (!license) {
    return { license: null, plan: 'LEGACY', status: 'ACTIVE', canWrite: true, isReadOnly: false, daysRemaining: null, reason: 'legacy' };
  }

  if (license.status === 'SUSPENDED') return { license, plan: license.plan, status: 'SUSPENDED', canWrite: false, isReadOnly: true, daysRemaining: null, reason: 'suspended' };
  if (license.status === 'EXPIRED') return { license, plan: license.plan, status: 'EXPIRED', canWrite: false, isReadOnly: true, daysRemaining: 0, reason: 'expired' };

  if (license.status === 'TRIAL') {
    const endsAt = license.trialEndsAt?.toMillis();
    if (endsAt !== undefined && now > endsAt) return { license, plan: license.plan, status: 'EXPIRED', canWrite: false, isReadOnly: true, daysRemaining: 0, reason: 'expired' };
    const daysRemaining = endsAt === undefined ? null : Math.max(0, Math.ceil((endsAt - now) / 86_400_000));
    return { license, plan: license.plan, status: 'TRIAL', canWrite: true, isReadOnly: false, daysRemaining, reason: 'trial' };
  }

  const endsAt = license.subscriptionEndsAt?.toMillis();
  if (endsAt !== undefined && now > endsAt) return { license, plan: license.plan, status: 'EXPIRED', canWrite: false, isReadOnly: true, daysRemaining: 0, reason: 'expired' };
  const daysRemaining = endsAt === undefined ? null : Math.max(0, Math.ceil((endsAt - now) / 86_400_000));
  return { license, plan: license.plan, status: 'ACTIVE', canWrite: true, isReadOnly: false, daysRemaining, reason: 'active' };
}

export const legacyMaxUsers = DEFAULT_LEGACY_MAX_USERS;
