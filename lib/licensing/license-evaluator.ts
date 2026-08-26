import { Timestamp } from 'firebase/firestore';
import type { License, LicensePlan, LicenseStatus, ResolvedLicenseState } from '@/types/auth';

function timestamp(value: unknown) {
  return value instanceof Timestamp ? value : undefined;
}

function hasTimestamp(value: unknown) {
  return value instanceof Timestamp && Number.isFinite(value.toMillis());
}

export function parseLicense(data: Record<string, unknown>): License | null {
  const plan = ['TRIAL', 'STARTER', 'TEAM', 'LEGACY'].includes(data.plan as string) ? data.plan as LicensePlan : null;
  const status = ['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED'].includes(data.status as string) ? data.status as LicenseStatus : null;
  const maxUsers = data.maxUsers;
  if (!plan || !status || typeof maxUsers !== 'number' || !Number.isInteger(maxUsers) || maxUsers < 1) return null;
  if (status === 'TRIAL' && plan !== 'TRIAL') return null;
  if (status === 'ACTIVE' && plan === 'TRIAL') return null;
  const requiredTimestamps = status === 'TRIAL'
    ? ['trialStartedAt', 'trialEndsAt']
    : status === 'ACTIVE'
      ? ['subscriptionStartedAt', 'subscriptionEndsAt']
      : [];
  const timestampFields = ['trialStartedAt', 'trialEndsAt', 'subscriptionStartedAt', 'subscriptionEndsAt', 'createdAt', 'updatedAt'];
  if (timestampFields.some((field) => data[field] !== undefined && data[field] !== null && !hasTimestamp(data[field]))) return null;
  if (requiredTimestamps.some((field) => !hasTimestamp(data[field]))) return null;
  if (data.features !== undefined && (data.features === null || typeof data.features !== 'object' || Array.isArray(data.features) || Object.values(data.features as Record<string, unknown>).some((feature) => typeof feature !== 'boolean'))) return null;
  return {
    plan,
    status,
    maxUsers,
    features: data.features && typeof data.features === 'object' ? data.features as Record<string, boolean> : {},
    trialStartedAt: timestamp(data.trialStartedAt),
    trialEndsAt: timestamp(data.trialEndsAt),
    subscriptionStartedAt: timestamp(data.subscriptionStartedAt),
    subscriptionEndsAt: timestamp(data.subscriptionEndsAt),
    createdAt: timestamp(data.createdAt),
    updatedAt: timestamp(data.updatedAt),
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
  };
}

export function resolveLicenseState(license: License | null, now = Date.now()): ResolvedLicenseState {
  if (!license) {
    return { license: null, plan: null, status: 'UNKNOWN', canRead: true, canWrite: false, isReadOnly: true, daysRemaining: null, reason: 'missing' };
  }

  if (license.status === 'SUSPENDED') return { license, plan: license.plan, status: 'SUSPENDED', canRead: true, canWrite: false, isReadOnly: true, daysRemaining: null, reason: 'suspended' };
  if (license.status === 'EXPIRED') return { license, plan: license.plan, status: 'EXPIRED', canRead: true, canWrite: false, isReadOnly: true, daysRemaining: 0, reason: 'expired' };

  if (license.status === 'TRIAL') {
    const endsAt = license.trialEndsAt?.toMillis();
    if (endsAt !== undefined && now > endsAt) return { license, plan: license.plan, status: 'EXPIRED', canRead: true, canWrite: false, isReadOnly: true, daysRemaining: 0, reason: 'expired' };
    const daysRemaining = endsAt === undefined ? null : Math.max(0, Math.ceil((endsAt - now) / 86_400_000));
    return { license, plan: license.plan, status: 'TRIAL', canRead: true, canWrite: true, isReadOnly: false, daysRemaining, reason: 'trial' };
  }

  const endsAt = license.subscriptionEndsAt?.toMillis();
  if (endsAt !== undefined && now > endsAt) return { license, plan: license.plan, status: 'EXPIRED', canRead: true, canWrite: false, isReadOnly: true, daysRemaining: 0, reason: 'expired' };
  const daysRemaining = endsAt === undefined ? null : Math.max(0, Math.ceil((endsAt - now) / 86_400_000));
  return { license, plan: license.plan, status: 'ACTIVE', canRead: true, canWrite: true, isReadOnly: false, daysRemaining, reason: 'active' };
}
